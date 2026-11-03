import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/boost'
import { PrefetchEngine, resolvePrefetchOptions } from '../src/prefetch/engine'

function htmlResponse(path = '/prefetched'): Response {
  return new Response(
    `<!doctype html><html><head><title>Prefetched</title></head><body><h1>${path}</h1></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

function makeEngine(
  options: Parameters<typeof resolvePrefetchOptions>[0] = { enabled: true },
): PrefetchEngine {
  return new PrefetchEngine(resolvePrefetchOptions(options), async () => ({}))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'connection')
  document.body.innerHTML = ''
})

describe('prefetch engine', () => {
  it('is disabled by default and does not issue requests', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const engine = makeEngine({ enabled: false })
    engine.start()
    expect(await engine.prefetch('/disabled')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    engine.stop()
  })

  it('prefetches after the configured hover delay', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse())
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/hover">Hover</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'hover', delay: 100 })
    engine.start()
    document.querySelector('a')!.dispatchEvent(new Event('pointerover', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(99)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    engine.stop()
  })

  it('prefetches on primary pointer-down, including touch pointers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse())
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/down">Down</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'pointerdown' })
    engine.start()
    const event = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    document.querySelector('a')!.dispatchEvent(event)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    engine.stop()
  })

  it('prefetches links when they enter the viewport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse())
    vi.stubGlobal('fetch', fetchMock)
    let callback: IntersectionObserverCallback | undefined
    class ObserverMock {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('IntersectionObserver', ObserverMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/visible">Visible</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'viewport' })
    engine.start()
    const link = document.querySelector('a')!
    expect(callback).toBeDefined()
    callback!(
      [{ target: link, isIntersecting: true } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    engine.stop()
  })

  it('deduplicates concurrent prefetch requests and reuses the response', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const engine = makeEngine({ enabled: true })
    const first = engine.prefetch('/duplicate')
    const second = engine.prefetch('/duplicate')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolveFetch(htmlResponse())
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    const cached = await engine.take(new URL('/duplicate', location.href))
    expect(await cached?.text()).toContain('<h1>/prefetched</h1>')
    engine.stop()
  })

  it('respects the configured concurrency limit', async () => {
    const resolvers: Array<(response: Response) => void> = []
    let active = 0
    let maximum = 0
    const fetchMock = vi.fn(() => {
      active++
      maximum = Math.max(maximum, active)
      return new Promise<Response>((resolve) => {
        resolvers.push((response) => {
          active--
          resolve(response)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const engine = makeEngine({ enabled: true, maxConcurrent: 1 })
    const first = engine.prefetch('/one')
    const second = engine.prefetch('/two')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolvers.shift()!(htmlResponse('/one'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    resolvers.shift()!(htmlResponse('/two'))
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(maximum).toBe(1)
    engine.stop()
  })

  it('cancels a delayed hover when the pointer leaves', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/cancel">Cancel</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'hover', delay: 50 })
    engine.start()
    const link = document.querySelector('a')!
    link.dispatchEvent(new Event('pointerover', { bubbles: true }))
    link.dispatchEvent(new Event('pointerout', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(60)
    expect(fetchMock).not.toHaveBeenCalled()
    engine.stop()
  })

  it('aborts an unclaimed pointer-down prefetch when the pointer leaves', async () => {
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/pointer-cancel">Cancel</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'pointerdown' })
    engine.start()
    const link = document.querySelector('a')!
    link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    link.dispatchEvent(new Event('pointerout', { bubbles: true }))
    expect(signal?.aborted).toBe(true)
    engine.stop()
  })

  it('clears pending hover timers when the engine stops', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/stop-timer">Stop</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'hover', delay: 100 })
    engine.start()
    document.querySelector('a')!.dispatchEvent(new Event('pointerover', { bubbles: true }))
    engine.stop()
    await vi.advanceTimersByTimeAsync(150)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts an active hover prefetch when the pointer leaves', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div data-boost="true"><a href="/active-cancel">Cancel</a></div>'
    const engine = makeEngine({ enabled: true, strategy: 'hover', delay: 0 })
    engine.start()
    const link = document.querySelector('a')!
    link.dispatchEvent(new Event('pointerover', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    link.dispatchEvent(new Event('pointerout', { bubbles: true }))
    expect(signal?.aborted).toBe(true)
    engine.stop()
  })

  it('does not reuse a prefetched response when request headers change', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse('/auth')))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = ''
    const boost = createBoost({
      progress: false,
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      headers: { Authorization: 'prefetched-token' },
      prefetch: { enabled: true },
    })
    let navigationError: unknown
    document.addEventListener('boost:error', (event) => {
      navigationError = (event as CustomEvent).detail?.error
    })
    boost.start()
    await expect(boost.prefetch('/auth')).resolves.toBe(true)
    const navigated = await boost.navigate('/auth', {
      headers: { Authorization: 'current-token' },
    })
    expect(navigated, String(navigationError)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    boost.stop()
  })

  it('rejects responses that vary on untracked headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><body>private</body></html>', {
        headers: { 'content-type': 'text/html', vary: 'Cookie' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const engine = makeEngine({ enabled: true })
    await expect(engine.prefetch('/vary-cookie')).resolves.toBe(false)
    await expect(engine.take(new URL('/vary-cookie', location.href))).resolves.toBeNull()
    engine.stop()
  })

  it('bounds streamed prefetch response bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('/too-large'))
    vi.stubGlobal('fetch', fetchMock)
    const engine = new PrefetchEngine(
      resolvePrefetchOptions({ enabled: true }),
      async () => ({}),
      undefined,
      undefined,
      16,
    )
    await expect(engine.prefetch('/too-large')).resolves.toBe(false)
    await expect(engine.take(new URL('/too-large', location.href))).resolves.toBeNull()
    engine.stop()
  })

  it('respects the browser Save-Data preference', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true, effectiveType: '4g', downlink: 10 },
    })
    const engine = makeEngine({ enabled: true })
    await expect(engine.prefetch('/save-data')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    engine.stop()
  })

  it('does not prefetch cross-origin, destructive, sensitive or excluded links', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = `
      <div data-boost="true">
        <a id="external" href="https://other.example/path">External</a>
        <a id="delete" href="/delete" data-method="DELETE">Delete</a>
        <a id="sensitive" href="/account" data-boost-sensitive>Account</a>
        <a id="excluded-attribute" href="/no-prefetch" data-boost-prefetch="false">Excluded</a>
        <div data-no-prefetch><a id="excluded-ancestor" href="/no-prefetch-ancestor">Excluded</a></div>
        <a id="excluded" href="/logout">Logout</a>
      </div>
    `
    const engine = makeEngine({ enabled: true, strategy: 'pointerdown', exclude: ['/logout'] })
    engine.start()
    for (const link of document.querySelectorAll('a')) {
      link.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    }
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(engine.prefetch('https://other.example/path')).resolves.toBe(false)
    engine.stop()
  })

  it('uses prefetched response for normal navigation without a second request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('/cached'))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="target"></div>'
    const boost = createBoost({
      progress: false,
      target: 'body',
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      prefetch: { enabled: true },
    })
    boost.start()
    await expect(boost.prefetch('/cached')).resolves.toBe(true)
    await expect(boost.navigate('/cached')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector('body h1')?.textContent).toBe('/cached')
    boost.stop()
  })
})
