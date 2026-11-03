import type { PrefetchOptions, ResolvedPrefetchOptions } from '../types'

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/html, */*; q=0.1',
  'X-Requested-With': 'XMLHttpRequest',
  'HX-Request': 'true',
  'HX-Boosted': 'true',
}
const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 8
const MAX_QUEUED_PREFETCHES = 32

type Entry = {
  controller: AbortController
  promise: Promise<Response | null>
  response?: Response
  expiresAt?: number
  finalUrl?: string
  headers?: Record<string, string>
  queued: boolean
  claimed: boolean
  resolve: (response: Response | null) => void
}

export function resolvePrefetchOptions(options?: PrefetchOptions): ResolvedPrefetchOptions {
  const strategy = options?.strategy ?? 'hover'
  const strategies = Array.isArray(strategy) ? strategy : [strategy]
  const delay = options?.delay
  const maxConcurrent = options?.maxConcurrent
  return {
    enabled: options?.enabled === true,
    strategy: strategies.filter(
      (item): item is 'hover' | 'pointerdown' | 'viewport' =>
        item === 'hover' || item === 'pointerdown' || item === 'viewport',
    ),
    delay: typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : 100,
    maxConcurrent:
      typeof maxConcurrent === 'number' && Number.isInteger(maxConcurrent) && maxConcurrent > 0
        ? Math.min(maxConcurrent, 8)
        : 2,
    exclude: options?.exclude ?? [],
  }
}

export class PrefetchEngine {
  private readonly entries = new Map<string, Entry>()
  private readonly finalUrls = new WeakMap<Response, string>()
  private readonly queue: Array<{ url: URL; entry: Entry }> = []
  private readonly hoverTimers = new Map<Element, ReturnType<typeof setTimeout>>()
  private observer: IntersectionObserver | null = null
  private active = 0
  private started = false

  constructor(
    private readonly options: ResolvedPrefetchOptions,
    private readonly headers: () => Promise<Record<string, string>>,
    private readonly scopeSelector = '[data-boost="true"]',
    private readonly linkSelector = 'a[href]',
    private readonly maxResponseBytes = 2 * 1024 * 1024,
  ) {}

  start(): void {
    if (!this.options.enabled || this.started || typeof document === 'undefined') return
    this.started = true
    if (this.options.strategy.includes('hover')) {
      document.addEventListener('pointerover', this.handlePointerOver)
    }
    if (this.options.strategy.includes('hover') || this.options.strategy.includes('pointerdown')) {
      document.addEventListener('pointerout', this.handlePointerOut)
    }
    if (this.options.strategy.includes('pointerdown')) {
      document.addEventListener('pointerdown', this.handlePointerDown, { passive: true })
    }
    this.refresh()
  }

  stop(): void {
    if (this.started && typeof document !== 'undefined') {
      document.removeEventListener('pointerover', this.handlePointerOver)
      document.removeEventListener('pointerout', this.handlePointerOut)
      document.removeEventListener('pointerdown', this.handlePointerDown)
    }
    this.started = false
    this.observer?.disconnect()
    this.observer = null
    for (const timer of this.hoverTimers.values()) clearTimeout(timer)
    this.hoverTimers.clear()
    for (const entry of this.entries.values()) {
      entry.controller.abort()
      entry.resolve(null)
    }
    this.entries.clear()
    this.queue.length = 0
  }

  refresh(): void {
    if (!this.started || !this.options.strategy.includes('viewport')) return
    if (typeof IntersectionObserver === 'undefined') return
    this.observer?.disconnect()
    this.observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (!record.isIntersecting) continue
          this.observer?.unobserve(record.target)
          const url = this.linkUrl(record.target)
          if (url) void this.prefetch(url)
        }
      },
      { rootMargin: '200px 0px' },
    )
    for (const link of document.querySelectorAll(this.linkSelector)) {
      if (this.linkUrl(link)) this.observer.observe(link)
    }
  }

  async prefetch(input: string | URL): Promise<boolean> {
    if (!this.options.enabled) return false
    const url = this.resolveEligibleUrl(input)
    if (!url || !this.canPrefetch()) return false
    const existing = this.entries.get(url.href)
    if (existing) {
      if (existing.response && (existing.expiresAt ?? 0) > Date.now()) return true
      if (existing.response) {
        this.entries.delete(url.href)
      } else {
        return Boolean(await existing.promise)
      }
    }

    if (this.queue.length >= MAX_QUEUED_PREFETCHES) return false

    const entry: Entry = {
      controller: new AbortController(),
      promise: Promise.resolve(null),
      queued: true,
      claimed: false,
      resolve: () => {},
    }
    entry.promise = new Promise<Response | null>((resolve) => {
      entry.resolve = resolve
      this.queue.push({ url, entry })
    })
    this.entries.set(url.href, entry)
    this.pump()
    return Boolean(await entry.promise)
  }

  async take(
    input: URL,
    signal?: AbortSignal,
    expectedHeaders?: Record<string, string>,
  ): Promise<Response | null> {
    const entry = this.entries.get(input.href)
    if (!entry) return null
    if (entry.response && (entry.expiresAt ?? 0) <= Date.now()) {
      this.entries.delete(input.href)
      return null
    }
    if (entry.queued || !this.headersMatch(entry.headers, expectedHeaders)) {
      this.cancel(input)
      return null
    }
    if (signal?.aborted) {
      this.cancel(input)
      return null
    }
    entry.claimed = true
    const abort = () => {
      entry.controller.abort()
      this.entries.delete(input.href)
      entry.resolve(null)
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = entry.response ?? (await entry.promise)
      if (!response || entry.controller.signal.aborted || signal?.aborted) return null
      this.entries.delete(input.href)
      const clone = response.clone()
      this.finalUrls.set(clone, entry.finalUrl ?? input.href)
      return clone
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  getFinalUrl(response: Response): string | undefined {
    return this.finalUrls.get(response)
  }

  private pump(): void {
    while (this.active < this.options.maxConcurrent && this.queue.length) {
      const next = this.queue.shift()
      if (!next) break
      if (next.entry.controller.signal.aborted) continue
      next.entry.queued = false
      this.active++
      void this.run(next.url, next.entry).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async run(url: URL, entry: Entry): Promise<void> {
    let response: Response | null = null
    try {
      const headers = { ...DEFAULT_HEADERS, ...(await this.headers()) }
      const headerNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()))
      entry.headers = headers
      if (entry.controller.signal.aborted || !this.canPrefetch()) return
      const result = await fetch(url.href, {
        method: 'GET',
        headers,
        credentials: 'same-origin',
        redirect: 'follow',
        signal: entry.controller.signal,
      })
      const finalUrl = new URL(result.url || url.href)
      const contentType = result.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? ''
      const vary =
        result.headers
          .get('vary')
          ?.toLowerCase()
          .split(',')
          .map((item) => item.trim()) ?? []
      if (
        !result.ok ||
        result.status === 204 ||
        result.status === 205 ||
        !this.isSameOriginHttp(finalUrl) ||
        !/^text\/html$|^application\/xhtml\+xml$/i.test(contentType) ||
        /(?:no-store|no-cache|private)/i.test(result.headers.get('cache-control') ?? '') ||
        vary.includes('*') ||
        vary.some((name) => !headerNames.has(name)) ||
        Number(result.headers.get('content-length')) > this.maxResponseBytes
      ) {
        return
      }
      const reader = result.body?.getReader()
      if (!reader) return
      const chunks: Uint8Array[] = []
      let byteLength = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        byteLength += part.value.byteLength
        if (byteLength > this.maxResponseBytes) {
          await reader.cancel()
          return
        }
        chunks.push(part.value)
      }
      const body = new Uint8Array(byteLength)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
      }
      response = new Response(body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      })
      entry.response = response.clone()
      entry.finalUrl = finalUrl.href
      entry.expiresAt = Date.now() + CACHE_TTL_MS
      this.pruneCache(url.href)
    } catch {
      // Prefetch is opportunistic: failures must never trigger navigation fallback.
    } finally {
      if (this.entries.get(url.href) === entry) {
        if (response && !entry.controller.signal.aborted) {
          entry.resolve(response)
        } else {
          this.entries.delete(url.href)
          entry.resolve(null)
        }
      } else {
        entry.resolve(null)
      }
    }
  }

  private pruneCache(current: string): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (key !== current && entry.response && (entry.expiresAt ?? 0) <= now) {
        this.entries.delete(key)
      }
    }
    const cached = Array.from(this.entries).filter(([, entry]) => entry.response)
    while (cached.length > MAX_CACHE_ENTRIES) {
      const oldestIndex = cached.findIndex(([key]) => key !== current)
      if (oldestIndex === -1) break
      const oldest = cached.splice(oldestIndex, 1)[0]
      if (oldest) this.entries.delete(oldest[0])
    }
  }

  private resolveEligibleUrl(input: string | URL): URL | null {
    if (typeof window === 'undefined') return null
    let url: URL
    try {
      url = input instanceof URL ? new URL(input.href) : new URL(input, window.location.href)
    } catch {
      return null
    }
    if (!this.isSameOriginHttp(url) || url.username || url.password) return null
    const current = new URL(window.location.href)
    if (
      url.href === current.href ||
      (url.pathname === current.pathname && url.search === current.search && Boolean(url.hash))
    )
      return null
    if (this.options.exclude.some((route) => url.pathname.startsWith(route))) return null
    return url
  }

  private headersMatch(
    prefetched: Record<string, string> | undefined,
    expected: Record<string, string> | undefined,
  ): boolean {
    if (!expected) return true
    if (!prefetched) return false
    const normalize = (headers: Record<string, string>) =>
      Object.entries(headers)
        .map(([name, value]) => [name.toLowerCase(), value] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    return JSON.stringify(normalize(prefetched)) === JSON.stringify(normalize(expected))
  }

  private isSameOriginHttp(url: URL): boolean {
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === window.location.origin &&
      !url.username &&
      !url.password
    )
  }

  private canPrefetch(): boolean {
    if (typeof navigator === 'undefined' || navigator.onLine === false) return false
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string; downlink?: number }
      }
    ).connection
    return !(
      connection?.saveData ||
      connection?.effectiveType === 'slow-2g' ||
      connection?.effectiveType === '2g' ||
      (typeof connection?.downlink === 'number' && connection.downlink < 0.5)
    )
  }

  private linkUrl(target: EventTarget | Element | null): URL | null {
    if (!(target instanceof Element)) return null
    const link = target.closest(this.linkSelector)
    if (!(link instanceof HTMLAnchorElement) || !link.closest(this.scopeSelector)) return null
    if (
      link.hasAttribute('download') ||
      link.getAttribute('aria-disabled') === 'true' ||
      link.hasAttribute('data-no-prefetch') ||
      link.hasAttribute('data-boost-sensitive') ||
      link.hasAttribute('data-confirm') ||
      link.hasAttribute('data-turbo-confirm') ||
      (link.getAttribute('data-method') &&
        link.getAttribute('data-method')?.toUpperCase() !== 'GET') ||
      (link.getAttribute('data-turbo-method') &&
        link.getAttribute('data-turbo-method')?.toUpperCase() !== 'GET') ||
      (link.getAttribute('data-boost-method') &&
        link.getAttribute('data-boost-method')?.toUpperCase() !== 'GET') ||
      link.getAttribute('data-boost-prefetch') === 'false' ||
      link.closest('[data-boost-prefetch="false"], [data-no-prefetch], [data-boost-sensitive]') ||
      link.closest('[data-boost="false"]')
    )
      return null
    const targetName = link.getAttribute('target')
    if (targetName && targetName.toLowerCase() !== '_self') return null
    if ((link.rel || '').toLowerCase().split(/\s+/).includes('external')) return null
    const raw = link.getAttribute('href')
    if (!raw || raw.startsWith('#')) return null
    return this.resolveEligibleUrl(raw)
  }

  private handlePointerOver = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof Element) || !this.linkUrl(link) || this.hoverTimers.has(link)) return
    const timer = setTimeout(() => {
      this.hoverTimers.delete(link)
      const url = this.linkUrl(link)
      if (url) void this.prefetch(url)
    }, this.options.delay)
    this.hoverTimers.set(link, timer)
  }

  private handlePointerOut = (event: PointerEvent): void => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof Element)) return
    if (event.relatedTarget instanceof Node && link.contains(event.relatedTarget)) return
    const timer = this.hoverTimers.get(link)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.hoverTimers.delete(link)
    }
    const url = this.resolveEligibleUrl(link.getAttribute('href') ?? '')
    if (url) this.cancel(url)
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const url = this.linkUrl(event.target)
    if (url) void this.prefetch(url)
  }

  private cancel(url: URL): void {
    const entry = this.entries.get(url.href)
    if (!entry || entry.claimed) return
    entry.controller.abort()
    this.entries.delete(url.href)
    if (entry.queued) {
      const index = this.queue.findIndex((item) => item.entry === entry)
      if (index !== -1) this.queue.splice(index, 1)
      entry.resolve(null)
    }
  }
}
