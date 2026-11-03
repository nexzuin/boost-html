import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/boost'
import { encodeUrlEncoded, executeScripts, replaceContent } from '../src/dom'
import type { Boost, BoostOptions } from '../src/types'

const PAGE = `
  <div data-boost="true">
    <a id="about" href="/about">About</a>
    <a id="hash" href="#section">In page</a>
    <a id="hash-page" href="/docs#target">Docs</a>
    <a id="external" href="https://example.com/page">External</a>
    <a id="blank" href="/blank" target="_blank">Blank</a>
    <a id="download" href="/file.pdf" download>Download</a>
    <a id="aria-disabled" href="/disabled" aria-disabled="true">Unavailable</a>
    <a id="disabled" href="/disabled" data-boost="false">Disabled</a>
    <form id="search" action="/search" method="get">
      <input name="q" value="boost" />
      <button id="search-submit" name="btn" value="go">Search</button>
    </form>
    <form id="create" action="/create" method="post" enctype="multipart/form-data">
      <input name="name" value="Ada" />
      <button id="create-submit" name="action" value="save">Save</button>
    </form>
  </div>
  <a id="outside" href="/outside">Outside</a>
`

function respond(
  body: string,
  options: {
    title?: string
    status?: number
    url?: string
    contentType?: string | null
  } = {},
): Response {
  const title = options.title ?? 'Boosted'
  const html = `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
  const headers = new Headers()
  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'text/html; charset=utf-8')
  }

  return {
    ok: (options.status ?? 200) < 400,
    status: options.status ?? 200,
    url: options.url ?? '',
    headers,
    text: () => Promise.resolve(html),
  } as unknown as Response
}

function click(element: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  element.dispatchEvent(event)
  return event
}

function submit(form: HTMLFormElement, submitter?: HTMLElement): SubmitEvent {
  const event = new SubmitEvent('submit', {
    bubbles: true,
    cancelable: true,
    submitter: submitter ?? null,
  })
  form.dispatchEvent(event)
  return event
}

describe('boost-html', () => {
  let boost: Boost
  let fetchMock: ReturnType<typeof vi.fn>
  let scrollTo: ReturnType<typeof vi.fn>
  const originalScrollTo = window.scrollTo
  const originalScrollIntoView = Element.prototype.scrollIntoView

  function useBoost(options: BoostOptions = {}): void {
    boost.stop()
    boost = createBoost({ progress: false, ...options })
    boost.start()
  }

  function fallbackSpy(): ReturnType<typeof vi.spyOn> {
    return vi
      .spyOn(
        boost as unknown as { fallback: (url: string, method: string, init: unknown) => void },
        'fallback',
      )
      .mockImplementation(() => {})
  }

  beforeEach(() => {
    document.body.innerHTML = PAGE
    document.title = 'Home'
    history.replaceState({}, '', '/start')

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
  })

  it('uses secure defaults', () => {
    expect(boost.options.executeScripts).toBe(false)
    expect(boost.options.fallbackToNativeForm).toBe(false)
    expect(boost.options.nonce).toBe('')
    expect(boost.options.maxResponseBytes).toBe(2 * 1024 * 1024)
  })

  it('intercepts boosted links, swaps the body, title and history', async () => {
    fetchMock.mockResolvedValue(respond('<h1>About</h1>', { title: 'About page' }))

    const event = click(document.getElementById('about')!)
    expect(event.defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('About'))

    expect(document.title).toBe('About page')
    expect(window.location.pathname).toBe('/about')
    expect(scrollTo).toHaveBeenCalledWith(0, 0)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost/about')
    expect(init.method).toBe('GET')
    expect(init.headers['HX-Request']).toBe('true')
    expect(init.headers['HX-Boosted']).toBe('true')
    expect(init.headers['X-Requested-With']).toBe('XMLHttpRequest')
  })

  it('leaves links outside a boosted subtree alone', () => {
    const event = click(document.getElementById('outside')!)

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honours data-boost="false"', () => {
    const event = click(document.getElementById('disabled')!)

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['external', {}],
    ['blank', {}],
    ['download', {}],
    ['aria-disabled', {}],
    ['about', { ctrlKey: true }],
    ['about', { metaKey: true }],
    ['about', { shiftKey: true }],
    ['about', { button: 1 }],
  ])('ignores %s link clicks (%o)', (id, init) => {
    const event = click(document.getElementById(id)!, init)

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores same-page anchors', () => {
    const event = click(document.getElementById('hash')!)

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('boosts GET forms and encodes the fields in the query string', async () => {
    fetchMock.mockResolvedValue(respond('<h1>Results</h1>'))

    const event = submit(
      document.getElementById('search') as HTMLFormElement,
      document.getElementById('search-submit') as HTMLButtonElement,
    )
    expect(event.defaultPrevented).toBe(true)

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Results'))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost/search?q=boost&btn=go')
    expect(init.method).toBe('GET')
    expect(init.body).toBeNull()
  })

  it('boosts POST forms with the form data and the submitter value', async () => {
    fetchMock.mockResolvedValue(respond('<h1>Created</h1>'))

    submit(
      document.getElementById('create') as HTMLFormElement,
      document.getElementById('create-submit') as HTMLButtonElement,
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Created'))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost/create')
    expect(init.method).toBe('POST')

    const body = init.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('name')).toBe('Ada')
    expect(body.get('action')).toBe('save')
  })

  it('honours submitter formaction and formmethod', async () => {
    document.body.innerHTML = `
      <div data-boost="true">
        <form id="override" action="/a" method="post">
          <input name="x" value="1" />
          <button id="override-submit" formaction="/b" formmethod="get" name="go" value="1">Go</button>
        </form>
      </div>
    `
    fetchMock.mockResolvedValue(respond('<h1>Override</h1>'))

    submit(
      document.getElementById('override') as HTMLFormElement,
      document.getElementById('override-submit') as HTMLButtonElement,
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Override'))

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost/b?x=1&go=1')
    expect(init.method).toBe('GET')
  })

  it('encodes urlencoded forms like the browser', async () => {
    document.body.innerHTML = `
      <div data-boost="true">
        <form id="encoded" action="/encoded" method="post" enctype="application/x-www-form-urlencoded">
          <input name="name" value="Ada" />
          <button id="encoded-submit" name="action" value="save">Save</button>
        </form>
      </div>
    `
    fetchMock.mockResolvedValue(respond('<h1>Encoded</h1>'))

    submit(
      document.getElementById('encoded') as HTMLFormElement,
      document.getElementById('encoded-submit') as HTMLButtonElement,
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Encoded'))

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.body).toBe('name=Ada&action=save')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
  })

  it('encodes text/plain forms like the browser', async () => {
    document.body.innerHTML = `
      <div data-boost="true">
        <form id="plain" action="/plain" method="post" enctype="text/plain">
          <input name="name" value="Ada" />
          <button id="plain-submit" name="action" value="save">Save</button>
        </form>
      </div>
    `
    fetchMock.mockResolvedValue(respond('<h1>Plain</h1>'))

    submit(
      document.getElementById('plain') as HTMLFormElement,
      document.getElementById('plain-submit') as HTMLButtonElement,
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Plain'))

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.body).toBe('name=Ada\r\naction=save\r\n')
    expect(init.headers['Content-Type']).toBe('text/plain;charset=UTF-8')
  })

  it('submits image button coordinates', async () => {
    document.body.innerHTML = `
      <div data-boost="true">
        <form id="image" action="/image" method="post">
          <input id="image-submit" type="image" name="go" alt="Go" />
        </form>
      </div>
    `
    fetchMock.mockResolvedValue(respond('<h1>Image</h1>'))

    submit(
      document.getElementById('image') as HTMLFormElement,
      document.getElementById('image-submit') as HTMLInputElement,
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Image'))

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.body).toBe('go.x=0&go.y=0')
  })

  it('uses file names in GET query encoding', () => {
    const formData = new FormData()
    formData.append('file', new File(['x'], 'a.txt', { type: 'text/plain' }))

    expect(encodeUrlEncoded(formData)).toBe('file=a.txt')
  })

  it('leaves forms with a target alone', () => {
    document.body.innerHTML = `
      <div data-boost="true">
        <form id="targeted" action="/target" method="post" target="_blank"></form>
      </div>
    `

    const event = submit(document.getElementById('targeted') as HTMLFormElement)

    expect(event.defaultPrevented).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a failed non-idempotent form by default', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})

    submit(document.getElementById('create') as HTMLFormElement)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nativeSubmit).not.toHaveBeenCalled()
  })

  it('can opt in to a native form fallback', async () => {
    useBoost({ fallbackToNativeForm: true })
    fetchMock.mockRejectedValue(new Error('offline'))
    const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})

    submit(document.getElementById('create') as HTMLFormElement)

    await vi.waitFor(() => expect(nativeSubmit).toHaveBeenCalledTimes(1))
  })

  it('falls back to a hard navigation when a link request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const fallback = fallbackSpy()

    click(document.getElementById('about')!)

    await vi.waitFor(() => expect(fallback.mock.calls[0]?.[0]).toBe('http://localhost/about'))
  })

  it('supports skipping the fallback by handling the error event', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const fallback = fallbackSpy()
    const onError = (event: Event) => event.preventDefault()
    document.addEventListener('boost:error', onError)

    click(document.getElementById('about')!)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.removeEventListener('boost:error', onError)

    expect(fallback).not.toHaveBeenCalled()
  })

  it('allows listeners to cancel a request', async () => {
    const onBeforeRequest = (event: Event) => event.preventDefault()
    document.addEventListener('boost:before-request', onBeforeRequest)

    click(document.getElementById('about')!)
    await new Promise((resolve) => setTimeout(resolve, 0))

    document.removeEventListener('boost:before-request', onBeforeRequest)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not execute scripts from the response by default', async () => {
    fetchMock.mockResolvedValue(
      respond("<h1>Scripts</h1><script>document.body.dataset.ran = 'yes'</script>"),
    )

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Scripts'))

    expect(document.body.dataset.ran).toBeUndefined()
    expect(document.querySelectorAll('script')).toHaveLength(0)
  })

  it('never executes inline scripts, including with the deprecated executeScripts option', async () => {
    useBoost({ executeScripts: true })
    fetchMock.mockResolvedValue(
      respond("<h1>Scripts</h1><script>document.body.dataset.ran = 'yes'</script>"),
    )

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Scripts'))

    expect(document.body.dataset.ran).toBeUndefined()
    expect(document.querySelector('script')).toBeNull()
  })

  it('passes inert script nodes and the CSP nonce to an explicit script handler', async () => {
    const handler = vi.fn((scripts, context) => {
      document.body.dataset.handled = scripts[0]?.textContent ?? ''
      document.body.dataset.nonce = context.nonce
    })
    useBoost({ scriptHandler: handler, nonce: 'script-nonce' })
    fetchMock.mockResolvedValue(
      respond("<h1>Scripts</h1><script>document.body.dataset.ran = 'yes'</script>"),
    )

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Scripts'))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(document.body.dataset.handled).toContain("document.body.dataset.ran = 'yes'")
    expect(document.body.dataset.nonce).toBe('script-nonce')
    expect(document.body.dataset.ran).toBeUndefined()
    expect(document.querySelector('script')).toBeNull()
  })

  it('never inserts external scripts from a response', async () => {
    useBoost({ executeScripts: true })
    document.body.insertAdjacentHTML('beforeend', '<script src="/app.js"></script>')
    fetchMock.mockResolvedValue(respond('<h1>Scripts</h1><script src="/app.js"></script>'))

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Scripts'))

    expect(document.querySelectorAll('script[src="/app.js"]')).toHaveLength(0)
  })

  it('replaces history with a same-origin redirect target', async () => {
    fetchMock.mockResolvedValue(respond('<h1>Final</h1>', { url: 'http://localhost/final' }))

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Final'))

    expect(window.location.pathname).toBe('/final')
  })

  it('refuses to swap a cross-origin redirect response', async () => {
    fetchMock.mockResolvedValue(
      respond('<h1 id="pwn">external</h1>', { url: 'https://evil.example/pwn' }),
    )
    const fallback = fallbackSpy()

    click(document.getElementById('about')!)

    await vi.waitFor(() => expect(fallback).toHaveBeenCalled())
    expect(document.querySelector('#pwn')).toBeNull()
    expect(window.location.pathname).toBe('/start')
    expect(fallback.mock.calls[0]?.[0]).toBe('http://localhost/about')
  })

  it('refuses to swap a non-http(s) redirect response', async () => {
    fetchMock.mockResolvedValue(
      respond('<h1 id="pwn">external</h1>', { url: 'data:text/html,<h1>pwn</h1>' }),
    )
    const fallback = fallbackSpy()

    click(document.getElementById('about')!)

    await vi.waitFor(() => expect(fallback).toHaveBeenCalled())
    expect(document.querySelector('#pwn')).toBeNull()
  })

  it('does not push history on popstate and restores the scroll position', async () => {
    fetchMock.mockResolvedValueOnce(respond('<h1>About</h1>'))
    fetchMock.mockResolvedValueOnce(respond('<h1>Home</h1>'))

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('About'))

    const pushState = vi.spyOn(history, 'pushState')
    scrollTo.mockClear()

    window.dispatchEvent(
      new PopStateEvent('popstate', { state: { __boostHtml: { version: 1, scrollY: 120 } } }),
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Home'))

    expect(pushState).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/about')
    expect(scrollTo).toHaveBeenCalledWith(0, 120)
  })

  it('replaces history when a popstate response redirects', async () => {
    history.replaceState({}, '', '/from')
    fetchMock.mockResolvedValue(respond('<h1>Final</h1>', { url: 'http://localhost/final' }))
    const replaceState = vi.spyOn(history, 'replaceState')

    window.dispatchEvent(
      new PopStateEvent('popstate', { state: { __boostHtml: { version: 1, scrollY: 0 } } }),
    )

    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Final'))

    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining({ __boostHtml: { version: 1, scrollY: 0 } }),
      '',
      'http://localhost/final',
    )
  })

  it('does not scroll when the scroll option is disabled', async () => {
    useBoost({ scroll: false })
    fetchMock.mockResolvedValue(respond('<h1>No scroll</h1>'))

    await expect(boost.navigate('/no-scroll')).resolves.toBe(true)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('allows listeners to cancel a swap', async () => {
    fetchMock.mockResolvedValue(respond('<h1>Cancelled</h1>'))
    const onBeforeSwap = (event: Event) => event.preventDefault()
    document.addEventListener('boost:before-swap', onBeforeSwap)

    await expect(boost.navigate('/cancel')).resolves.toBe(false)

    document.removeEventListener('boost:before-swap', onBeforeSwap)
    expect(document.querySelector('h1')).toBeNull()
  })

  it('can disable the response size limit', async () => {
    useBoost({ maxResponseBytes: 0 })
    fetchMock.mockResolvedValue(
      new Response('<h1>Unlimited</h1>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    await expect(boost.navigate('/unlimited')).resolves.toBe(true)

    expect(document.querySelector('h1')?.textContent).toBe('Unlimited')
  })

  it('waits for external scripts when execution is enabled', async () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><body><h1>External</h1><script src="/ext.js"></script></body></html>',
      'text/html',
    )
    const placeholders = replaceContent(document.body, doc)
    const loaded = new Set<string>()

    const pending = executeScripts(placeholders, loaded, 'http://localhost/', 'ext-nonce')
    const script = document.querySelector('script[src="/ext.js"]')
    expect(script).not.toBeNull()
    expect(script?.getAttribute('nonce')).toBe('ext-nonce')

    script?.dispatchEvent(new Event('load'))
    await pending

    expect(loaded.has('http://localhost/ext.js')).toBe(true)
    expect(document.querySelector('h1')?.textContent).toBe('External')
  })

  it('scrolls to the hash target and keeps the hash in history', async () => {
    // Browsers and Node fetch strip the fragment from Response.url.
    fetchMock.mockResolvedValue(
      respond('<h1 id="target">Docs</h1>', { url: 'http://localhost/docs' }),
    )
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    click(document.getElementById('hash-page')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Docs'))

    expect(scrollIntoView).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/docs')
    expect(window.location.hash).toBe('#target')
  })

  it('navigates programmatically', async () => {
    fetchMock.mockResolvedValue(respond('<h1>Programmatic</h1>', { title: 'Programmatic' }))

    await expect(boost.navigate('/programmatic', { push: 'replace' })).resolves.toBe(true)

    expect(document.querySelector('h1')?.textContent).toBe('Programmatic')
    expect(document.title).toBe('Programmatic')
    expect(window.location.pathname).toBe('/programmatic')
  })

  it('keeps the current page for 204 responses', async () => {
    fetchMock.mockResolvedValue(respond('', { status: 204 }))

    await expect(boost.navigate('/no-content')).resolves.toBe(true)

    expect(document.querySelector('h1')).toBeNull()
    expect(window.location.pathname).toBe('/start')
  })

  it('aborts the in-flight request on stop', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init.signal ?? undefined
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    )

    const navigation = boost.navigate('/hang')
    await vi.waitFor(() => expect(signal).toBeDefined())
    boost.stop()

    expect(signal?.aborted).toBe(true)
    await expect(navigation).resolves.toBe(false)
  })

  it('does not swap a response that is not HTML', async () => {
    fetchMock.mockResolvedValue(respond('{"ok":true}', { contentType: 'application/json' }))
    const fallback = fallbackSpy()

    await expect(boost.navigate('/data')).resolves.toBe(false)

    expect(fallback.mock.calls[0]?.[0]).toBe('http://localhost/data')
    expect(document.querySelector('h1')).toBeNull()
  })

  it('does not swap a response without a content type', async () => {
    fetchMock.mockResolvedValue(respond('<h1>No type</h1>', { contentType: null }))
    const fallback = fallbackSpy()

    await expect(boost.navigate('/no-type')).resolves.toBe(false)

    expect(fallback.mock.calls[0]?.[0]).toBe('http://localhost/no-type')
    expect(document.querySelector('h1')).toBeNull()
  })

  it('refuses to navigate to cross-origin or non-http(s) URLs programmatically', async () => {
    const fallback = fallbackSpy()

    await expect(boost.navigate('https://example.com/page')).resolves.toBe(false)
    await expect(boost.navigate('javascript:alert(1)')).resolves.toBe(false)
    await expect(boost.navigate('data:text/html,<h1>x</h1>')).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rejects responses larger than maxResponseBytes', async () => {
    useBoost({ maxResponseBytes: 64 })
    fetchMock.mockResolvedValue(
      new Response(`<h1>${'x'.repeat(200)}</h1>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
    const fallback = fallbackSpy()

    await expect(boost.navigate('/too-large')).resolves.toBe(false)

    expect(fallback).toHaveBeenCalled()
    expect(document.querySelector('h1')).toBeNull()
  })

  it('injects the progress styles and keeps NProgress out of the DOM when disabled', async () => {
    fetchMock.mockResolvedValue(respond('<h1>About</h1>'))

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('About'))

    expect(document.getElementById('boost-html-progress-style')).toBeNull()

    boost.stop()
    const withProgress = createBoost({ progress: { showSpinner: false } })
    withProgress.start()
    fetchMock.mockResolvedValue(respond('<h1>Progress</h1>'))
    document.body.innerHTML = PAGE

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Progress'))

    expect(document.getElementById('boost-html-progress-style')).not.toBeNull()
    withProgress.stop()
  })

  it('applies a nonce to injected progress styles', async () => {
    useBoost({ progress: { showSpinner: false }, nonce: 'style-nonce' })
    fetchMock.mockResolvedValue(respond('<h1>Nonce</h1>'))

    click(document.getElementById('about')!)
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Nonce'))

    expect(document.getElementById('boost-html-progress-style')?.getAttribute('nonce')).toBe(
      'style-nonce',
    )
  })
})
