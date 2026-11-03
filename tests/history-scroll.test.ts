import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/boost'

function html(body: string, title = 'Next'): Response {
  return new Response(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

describe('history, scroll and accessibility', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let scrollTo: ReturnType<typeof vi.fn>
  let boost: ReturnType<typeof createBoost>
  const originalScrollTo = window.scrollTo
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    document.body.innerHTML = '<main><h1>Start</h1></main>'
    document.title = 'Start'
    history.replaceState({ appState: 'preserved' }, '', '/start')
    Object.defineProperty(history, 'scrollRestoration', {
      configurable: true,
      writable: true,
      value: 'auto',
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    scrollTo = vi.fn()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    boost = createBoost({ progress: false })
    boost.start()
  })

  afterEach(() => {
    boost.stop()
    vi.unstubAllGlobals()
    window.scrollTo = originalScrollTo
    Element.prototype.scrollIntoView = originalScrollIntoView
    document.body.innerHTML = ''
    history.replaceState({}, '', '/')
    Reflect.deleteProperty(history, 'scrollRestoration')
  })

  it('pushes one entry and preserves application history state', async () => {
    fetchMock.mockResolvedValue(html('<main><h1>Next</h1></main>'))
    const push = vi.spyOn(history, 'pushState')

    await expect(boost.navigate('/next')).resolves.toBe(true)

    expect(push).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/next')
    expect(history.state.appState).toBe('preserved')
    expect(history.state.__boostHtml).toEqual({ version: 1, scrollY: 0 })
  })

  it('uses replaceState for replace navigation and avoids duplicate URLs', async () => {
    fetchMock.mockResolvedValue(html('<main><h1>Replaced</h1></main>'))
    const push = vi.spyOn(history, 'pushState')
    const replace = vi.spyOn(history, 'replaceState')

    await expect(boost.navigate('/replaced', { push: 'replace' })).resolves.toBe(true)
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ __boostHtml: { version: 1, scrollY: 0 } }),
      '',
      'http://localhost/replaced',
    )
    expect(history.state.appState).toBe('preserved')

    fetchMock.mockResolvedValue(html('<main><h1>Same URL</h1></main>'))
    await expect(boost.navigate('/replaced')).resolves.toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('restores saved scroll position on popstate without pushing', async () => {
    fetchMock.mockResolvedValue(html('<main><h1>Previous</h1></main>'))
    const push = vi.spyOn(history, 'pushState')

    window.dispatchEvent(
      new PopStateEvent('popstate', {
        state: { __boostHtml: { version: 1, scrollY: 245 } },
      }),
    )
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Previous'))

    expect(scrollTo).toHaveBeenCalledWith(0, 245)
    expect(push).not.toHaveBeenCalled()
  })

  it('scrolls to a decoded hash target after a successful navigation', async () => {
    document.body.innerHTML = '<main><h1>Start</h1></main>'
    fetchMock.mockResolvedValue(html('<main><h2 id="section one">Section</h2></main>'))
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    await expect(boost.navigate('/docs#section%20one')).resolves.toBe(true)

    expect(window.location.hash).toBe('#section%20one')
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
  })

  it('focuses the new main landmark and announces the page politely', async () => {
    fetchMock.mockResolvedValue(html('<main><h1>Accessible page</h1></main>', 'Accessible page'))

    await expect(boost.navigate('/accessible')).resolves.toBe(true)

    expect(document.activeElement).toBe(document.querySelector('main'))
    expect(document.querySelector('main')?.getAttribute('tabindex')).toBe('-1')
    const announcement = document.querySelector('[role="status"][aria-live="polite"]')
    expect(announcement?.textContent).toBe('Navigated to Accessible page')
  })

  it('restores the previous focus target from the history entry', async () => {
    document.body.innerHTML = '<main><button id="return-focus">Return</button></main>'
    const button = document.getElementById('return-focus') as HTMLButtonElement
    button.focus()
    fetchMock.mockResolvedValue(html('<main><h1>Next</h1></main>'))
    const replace = vi.spyOn(history, 'replaceState')

    await boost.navigate('/next')
    const outgoingState = replace.mock.calls[0]?.[0] as {
      __boostHtml?: { focusId?: string; scrollY?: number }
    }
    expect(outgoingState.__boostHtml?.focusId).toBe('return-focus')

    fetchMock.mockResolvedValue(html('<main><button id="return-focus">Return</button></main>'))
    window.dispatchEvent(new PopStateEvent('popstate', { state: outgoingState }))
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('return-focus'))
  })

  it('does not steal focus from persistent navigation controls', async () => {
    document.body.innerHTML = `
      <nav data-boost="true"><a id="persistent-link" href="/next">Next</a></nav>
      <main id="content"><p>Before</p></main>
    `
    boost.stop()
    boost = createBoost({ progress: false, target: '#content' })
    boost.start()
    const link = document.getElementById('persistent-link') as HTMLAnchorElement
    link.focus()
    fetchMock.mockResolvedValue(html('<main id="content"><p>After</p></main>'))

    link.click()
    await vi.waitFor(() => expect(document.querySelector('#content p')?.textContent).toBe('After'))

    expect(document.activeElement).toBe(link)
  })

  it('falls back to native navigation if the History API commit fails', async () => {
    fetchMock.mockResolvedValue(html('<main><h1>Next</h1></main>'))
    const hardNavigate = vi
      .spyOn(boost as unknown as { hardNavigate: (url: string) => void }, 'hardNavigate')
      .mockImplementation(() => {})
    vi.spyOn(history, 'pushState').mockImplementation(() => {
      throw new DOMException('Blocked by host', 'SecurityError')
    })

    await expect(boost.navigate('/next')).resolves.toBe(false)

    expect(hardNavigate).toHaveBeenCalledWith('http://localhost/next')
  })

  it('leaves popstate entries owned by other routers to the browser', () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: { router: 'other' } }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores native scroll restoration and removes listeners and announcements on stop', async () => {
    expect(history.scrollRestoration).toBe('manual')
    fetchMock.mockResolvedValue(html('<main><h1>Next</h1></main>'))
    await boost.navigate('/next')
    expect(document.querySelector('[role="status"]')).not.toBeNull()

    boost.stop()
    expect(history.scrollRestoration).toBe('auto')
    expect(document.querySelector('[role="status"]')).toBeNull()

    const calls = fetchMock.mock.calls.length
    window.dispatchEvent(
      new PopStateEvent('popstate', {
        state: { __boostHtml: { version: 1, scrollY: 50 } },
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })

  it('keeps scroll restoration native when scroll management is disabled', () => {
    boost.stop()
    boost = createBoost({ progress: false, scroll: false })
    boost.start()
    expect(history.scrollRestoration).toBe('auto')
  })
})
