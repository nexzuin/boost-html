import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/boost'
import { NavigationCache } from '../src/cache/navigation-cache'
import type { NavigationCacheOptions } from '../src/types'

function response(
  body = '<!doctype html><html><head><title>Cached</title></head><body><h1>cached</h1></body></html>',
  headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=30',
  },
): Response {
  return new Response(body, { status: 200, headers })
}

function makeCache(options: NavigationCacheOptions = { enabled: false }) {
  const resolved = createBoost({ progress: false, cache: options }).options.cache
  return new NavigationCache(resolved, location.origin)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('navigation cache', () => {
  it('resolves conservative defaults and stays disabled', () => {
    const boost = createBoost({ progress: false })
    expect(boost.options.cache).toEqual({
      enabled: false,
      maxEntries: 20,
      maxAge: 30_000,
      exclude: [],
    })
    boost.stop()
  })

  it('is disabled by default', () => {
    const cache = makeCache()
    expect(cache.isEligible(new URL('/public', location.href))).toBe(false)
    expect(cache.set(new URL('/public', location.href), response(), '/public', {})).toBe(false)
    expect(cache.size).toBe(0)
  })

  it('stores and returns a cloned public HTML response', async () => {
    const cache = makeCache({ enabled: true })
    const url = new URL('/public', location.href)
    expect(cache.set(url, response(), url.href, { Accept: 'text/html' })).toBe(true)
    const hit = cache.get(url, { Accept: 'text/html' })
    expect(hit).not.toBeNull()
    expect(await hit?.text()).toContain('<h1>cached</h1>')
    expect(cache.size).toBe(1)
  })

  it('rejects a cache write when the final response URL is cross-origin', () => {
    const cache = makeCache({ enabled: true })
    const url = new URL('/redirected', location.href)
    expect(cache.set(url, response(), 'https://other.example/redirected', {})).toBe(false)
  })

  it('normalizes URL fragments because fragments are not sent in GET requests', () => {
    const cache = makeCache({ enabled: true })
    const first = new URL('/article#summary', location.href)
    const second = new URL('/article#comments', location.href)
    cache.set(first, response(), first.href, {})
    expect(cache.get(second, {})).not.toBeNull()
    expect(cache.getFinalUrl(second, {})).toBe(new URL('/article', location.href).href)
    cache.clear(second)
    expect(cache.size).toBe(0)
  })

  it('uses LRU eviction when maxEntries is reached', () => {
    const cache = makeCache({ enabled: true, maxEntries: 2 })
    const headers = { Accept: 'text/html' }
    const first = new URL('/first', location.href)
    const second = new URL('/second', location.href)
    const third = new URL('/third', location.href)
    cache.set(first, response(), first.href, headers)
    cache.set(second, response(), second.href, headers)
    cache.get(first, headers)
    cache.set(third, response(), third.href, headers)
    expect(cache.get(first, headers)).not.toBeNull()
    expect(cache.get(second, headers)).toBeNull()
    expect(cache.get(third, headers)).not.toBeNull()
  })

  it('expires entries at the configured maxAge', () => {
    vi.useFakeTimers()
    const cache = makeCache({ enabled: true, maxAge: 100 })
    const url = new URL('/short-lived', location.href)
    cache.set(url, response(), url.href, {})
    vi.advanceTimersByTime(101)
    expect(cache.get(url, {})).toBeNull()
    expect(cache.size).toBe(0)
  })

  it.each(['no-store', 'no-cache', 'private', 'public, no-store', 'public, no-cache'])(
    'never stores Cache-Control: %s',
    (cacheControl) => {
      const cache = makeCache({ enabled: true })
      const url = new URL('/directives', location.href)
      expect(
        cache.set(
          url,
          response(undefined, {
            'content-type': 'text/html',
            'cache-control': cacheControl,
          }),
          url.href,
          {},
        ),
      ).toBe(false)
    },
  )

  it('caps freshness using the server max-age and Age headers', () => {
    vi.useFakeTimers()
    const cache = makeCache({ enabled: true, maxAge: 10_000 })
    const url = new URL('/server-freshness', location.href)
    cache.set(
      url,
      response(undefined, {
        'content-type': 'text/html',
        'cache-control': 'public, max-age=5',
        age: '3',
      }),
      url.href,
      {},
    )
    vi.advanceTimersByTime(2_100)
    expect(cache.get(url, {})).toBeNull()
  })

  it('does not cache max-age=0 or must-revalidate without server freshness', () => {
    const cache = makeCache({ enabled: true })
    const zero = new URL('/zero-age', location.href)
    const revalidate = new URL('/revalidate', location.href)
    expect(
      cache.set(
        zero,
        response(undefined, {
          'content-type': 'text/html',
          'cache-control': 'public, max-age=0',
        }),
        zero.href,
        {},
      ),
    ).toBe(false)
    expect(
      cache.set(
        revalidate,
        response(undefined, {
          'content-type': 'text/html',
          'cache-control': 'public, must-revalidate',
        }),
        revalidate.href,
        {},
      ),
    ).toBe(false)
  })

  it('does not cache responses that set cookies', () => {
    const cache = makeCache({ enabled: true })
    const url = new URL('/sets-cookie', location.href)
    const result = new Response('<html><body>session</body></html>', {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'public, max-age=30',
        'set-cookie': 'session=abc; HttpOnly',
      },
    })
    expect(cache.set(url, result, url.href, {})).toBe(false)
  })

  it('requires an explicit public caching contract', () => {
    const cache = makeCache({ enabled: true })
    const url = new URL('/implicit', location.href)
    expect(cache.set(url, response(undefined, { 'content-type': 'text/html' }), url.href, {})).toBe(
      false,
    )
  })

  it('excludes configured sensitive path prefixes', () => {
    const cache = makeCache({ enabled: true, exclude: ['/tenant/private'] })
    expect(cache.isEligible(new URL('/tenant/private/report', location.href))).toBe(false)
    expect(cache.isEligible(new URL('/tenant/public', location.href))).toBe(true)
  })

  it('rejects Vary: Cookie and Vary: *', () => {
    const cache = makeCache({ enabled: true })
    const cookieUrl = new URL('/vary-cookie', location.href)
    const wildcardUrl = new URL('/vary-star', location.href)
    expect(
      cache.set(
        cookieUrl,
        response(undefined, {
          'content-type': 'text/html',
          'cache-control': 'public, max-age=30',
          vary: 'Cookie',
        }),
        cookieUrl.href,
        {},
      ),
    ).toBe(false)
    expect(
      cache.set(
        wildcardUrl,
        response(undefined, {
          'content-type': 'text/html',
          'cache-control': 'public, max-age=30',
          vary: '*',
        }),
        wildcardUrl.href,
        {},
      ),
    ).toBe(false)
  })

  it('keys authenticated variants by their explicit Authorization header', async () => {
    const cache = makeCache({ enabled: true })
    const url = new URL('/localized', location.href)
    const headersA = { Authorization: 'Bearer user-a', 'Accept-Language': 'en' }
    const headersB = { Authorization: 'Bearer user-b', 'Accept-Language': 'en' }
    const headers = {
      'content-type': 'text/html',
      'cache-control': 'public, max-age=30',
      vary: 'Authorization, Accept-Language',
    }
    cache.set(url, response('<h1>user-a</h1>', headers), url.href, headersA)
    expect(await cache.get(url, headersA)?.text()).toContain('user-a')
    expect(cache.get(url, headersB)).toBeNull()
  })

  it('rejects browser-managed Cookie variants and sensitive routes', () => {
    const cache = makeCache({ enabled: true })
    expect(cache.isEligible(new URL('/account/overview', location.href))).toBe(false)
    expect(cache.isEligible(new URL('/admin/users', location.href))).toBe(false)
    expect(cache.isEligible(new URL('/public', 'https://example.com'))).toBe(false)
  })

  it('supports URL-specific and full invalidation', () => {
    const cache = makeCache({ enabled: true })
    const headers = {}
    const first = new URL('/first', location.href)
    const second = new URL('/second', location.href)
    cache.set(first, response(), first.href, headers)
    cache.set(second, response(), second.href, headers)
    cache.clear(first)
    expect(cache.get(first, headers)).toBeNull()
    expect(cache.get(second, headers)).not.toBeNull()
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('does not start a request when the caller is already aborted', async () => {
    const cache = makeCache({ enabled: true })
    const controller = new AbortController()
    controller.abort()
    const loader = vi.fn().mockResolvedValue(response())
    await expect(
      cache.request(new URL('/already-aborted', location.href), {}, controller.signal, loader),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(loader).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent requests for the same URL and headers', async () => {
    const cache = makeCache({ enabled: true })
    let resolve!: (value: Response) => void
    const loader = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    const url = new URL('/deduplicated', location.href)
    const first = cache.request(url, {}, new AbortController().signal, loader)
    const second = cache.request(url, {}, new AbortController().signal, loader)
    expect(loader).toHaveBeenCalledTimes(1)
    resolve(response())
    const [firstResponse, secondResponse] = await Promise.all([first, second])
    expect(await firstResponse.text()).toContain('cached')
    expect(await secondResponse.text()).toContain('cached')
  })

  it('keeps a shared request alive while another subscriber remains', async () => {
    const cache = makeCache({ enabled: true })
    let resolve!: (value: Response) => void
    let fetchSignal: AbortSignal | undefined
    const loader = vi.fn((signal: AbortSignal) => {
      fetchSignal = signal
      return new Promise<Response>((done) => {
        resolve = done
      })
    })
    const url = new URL('/shared-abort', location.href)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = cache.request(url, {}, firstController.signal, loader)
    const second = cache.request(url, {}, secondController.signal, loader)
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchSignal?.aborted).toBe(false)
    resolve(response())
    await expect(second).resolves.toBeInstanceOf(Response)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('integrates with navigation and clearCache()', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({
      progress: false,
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      cache: { enabled: true, maxEntries: 20, maxAge: 30_000 },
    })
    await expect(boost.navigate('/memoized')).resolves.toBe(true)
    await expect(boost.navigate('/memoized')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    boost.clearCache()
    await expect(boost.navigate('/memoized')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    boost.stop()
  })

  it('invalidates cached responses after a state-changing request', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({
      progress: false,
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      cache: { enabled: true },
    })
    await boost.navigate('/public-page')
    await boost.navigate('/mutate', { method: 'POST', body: 'change=1' })
    await boost.navigate('/public-page')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    boost.stop()
  })

  it('honors per-link cache opt-outs', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({
      progress: false,
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      cache: { enabled: true },
    })
    const link = document.createElement('a')
    link.href = '/public-page'
    link.setAttribute('data-no-cache', '')
    await boost.navigate('/public-page', { element: link })
    await boost.navigate('/public-page', { element: link })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    boost.stop()
  })

  it('does not cache sensitive routes or responses without public permission', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      return Promise.resolve(
        url.includes('/implicit')
          ? response(undefined, { 'content-type': 'text/html' })
          : response(),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({
      progress: false,
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      cache: { enabled: true },
    })
    await boost.navigate('/account')
    await boost.navigate('/account')
    await boost.navigate('/implicit')
    await boost.navigate('/implicit')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    boost.stop()
  })

  it('applies sensitive-route exclusions to integrated prefetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({
      progress: false,
      cache: { enabled: true, exclude: ['/tenant'] },
      prefetch: { enabled: true },
    })
    await expect(boost.prefetch('/dashboard')).resolves.toBe(false)
    await expect(boost.prefetch('/tenant/private')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    boost.stop()
  })

  it('shares prefetch responses with the navigation cache', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({
      progress: false,
      history: false,
      scroll: false,
      focus: false,
      announce: false,
      cache: { enabled: true },
      prefetch: { enabled: true },
    })
    await expect(boost.prefetch('/prefetched-shared')).resolves.toBe(true)
    await expect(boost.navigate('/prefetched-shared')).resolves.toBe(true)
    await expect(boost.navigate('/prefetched-shared')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    boost.stop()
  })
})
