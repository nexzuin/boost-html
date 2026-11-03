import type { ResolvedNavigationCacheOptions } from '../types'

type CacheEntry = {
  url: string
  response: Response
  finalUrl: string
  expiresAt: number
}

type PendingRequest = {
  controller: AbortController
  promise: Promise<Response>
  subscribers: number
  settled: boolean
}

const DEFAULT_SENSITIVE_SEGMENTS = new Set([
  'account',
  'admin',
  'auth',
  'billing',
  'cart',
  'checkout',
  'dashboard',
  'login',
  'logout',
  'my-account',
  'notifications',
  'orders',
  'password',
  'payment',
  'payments',
  'private',
  'profile',
  'reports',
  'session',
  'settings',
  'subscriptions',
  'token',
  'user',
  'users',
])

/** Per-instance LRU cache for explicitly public, fresh HTML responses. */
export class NavigationCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly pending = new Map<string, PendingRequest>()

  constructor(
    private readonly options: ResolvedNavigationCacheOptions,
    private readonly origin: string,
  ) {}

  get size(): number {
    this.pruneExpired()
    return this.entries.size
  }

  get(input: URL, headers: Record<string, string>): Response | null {
    if (!this.isEligible(input)) return null
    const key = this.key(input, headers)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return null
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.response.clone()
  }

  set(input: URL, response: Response, finalUrl: string, headers: Record<string, string>): boolean {
    let destination: URL
    try {
      destination = new URL(finalUrl)
    } catch {
      return false
    }
    if (
      !this.isEligible(input) ||
      destination.origin !== this.origin ||
      (destination.protocol !== 'http:' && destination.protocol !== 'https:') ||
      !this.isCacheable(response, headers)
    )
      return false
    const freshness = this.freshness(response)
    if (freshness <= 0) return false
    const key = this.key(input, headers)
    this.entries.delete(key)
    this.entries.set(key, {
      url: this.normalizedUrl(input),
      response: response.clone(),
      finalUrl: this.normalizedUrl(destination),
      expiresAt: Date.now() + freshness,
    })
    this.pruneExpired()
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return true
  }

  async request(
    input: URL,
    headers: Record<string, string>,
    signal: AbortSignal,
    loader: (signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> {
    if (signal.aborted) throw this.abortError()
    const cached = this.get(input, headers)
    if (cached) return cached

    const key = this.key(input, headers)
    let pending = this.pending.get(key)
    if (!pending) {
      const controller = new AbortController()
      const created: PendingRequest = {
        controller,
        promise: Promise.resolve(new Response(null)),
        subscribers: 0,
        settled: false,
      }
      created.promise = loader(controller.signal).finally(() => {
        created.settled = true
        if (this.pending.get(key) === created) this.pending.delete(key)
      })
      created.promise.catch(() => {})
      pending = created
      this.pending.set(key, created)
    }

    pending.subscribers++
    const active = pending
    try {
      const response = await this.withAbort(active.promise, signal)
      if (signal.aborted) throw this.abortError()
      return response.clone()
    } finally {
      active.subscribers--
      if (active.subscribers === 0 && !active.settled) {
        if (this.pending.get(key) === active) this.pending.delete(key)
        active.controller.abort()
      }
    }
  }

  getFinalUrl(input: URL, headers: Record<string, string>): string | undefined {
    const entry = this.entries.get(this.key(input, headers))
    return entry && entry.expiresAt > Date.now() ? entry.finalUrl : undefined
  }

  clear(input?: string | URL): void {
    const target = input === undefined ? null : this.resolveUrl(input)
    if (input !== undefined && (!target || target.origin !== this.origin)) return
    if (target) target.hash = ''
    for (const [key, entry] of this.entries) {
      if (!target || entry.url === target.href) this.entries.delete(key)
    }
    for (const [key, pending] of this.pending) {
      if (!target || key.startsWith(`${target.href}\\u0000`)) {
        pending.controller.abort()
        this.pending.delete(key)
      }
    }
  }

  isEligible(input: URL, element?: Element | null): boolean {
    if (
      !this.options.enabled ||
      this.options.maxAge <= 0 ||
      input.origin !== this.origin ||
      (input.protocol !== 'http:' && input.protocol !== 'https:') ||
      input.username !== '' ||
      input.password !== ''
    )
      return false
    if (this.isExcluded(input)) return false
    if (element?.closest('[data-no-cache], [data-cache="false"], [data-boost-sensitive]')) {
      return false
    }
    return true
  }

  isSensitive(input: URL): boolean {
    const segments = input.pathname.toLowerCase().split('/').filter(Boolean)
    return segments.some((segment) => DEFAULT_SENSITIVE_SEGMENTS.has(segment))
  }

  isExcluded(input: URL): boolean {
    return (
      this.isSensitive(input) ||
      this.options.exclude.some((route) => input.pathname.startsWith(route))
    )
  }

  private isCacheable(response: Response, requestHeaders: Record<string, string>): boolean {
    if (!response.ok || response.status !== 200) return false
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? ''
    if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') return false
    if (response.headers.has('set-cookie') || response.headers.has('set-cookie2')) return false

    const directives = this.parseDirectives(response.headers.get('cache-control') ?? '')
    // Explicit public is required because HttpOnly session cookies are not observable.
    if (!directives.has('public')) return false
    if (directives.has('no-store') || directives.has('no-cache') || directives.has('private')) {
      return false
    }

    const requestNames = new Set(Object.keys(requestHeaders).map((name) => name.toLowerCase()))
    const vary =
      response.headers
        .get('vary')
        ?.split(',')
        .map((name) => name.trim().toLowerCase()) ?? []
    if (
      vary.includes('*') ||
      vary.includes('cookie') ||
      vary.some((name) => !requestNames.has(name))
    ) {
      return false
    }
    return true
  }

  private freshness(response: Response): number {
    const directives = this.parseDirectives(response.headers.get('cache-control') ?? '')
    let maxAge = this.options.maxAge
    const serverMaxAge = directives.get('max-age')
    const expires = response.headers.get('expires')
    if (serverMaxAge !== undefined) {
      const seconds = Number(serverMaxAge.replace(/^"|"$/g, ''))
      if (!Number.isFinite(seconds) || seconds <= 0) return 0
      maxAge = Math.min(maxAge, seconds * 1000)
    } else if (directives.has('must-revalidate') || directives.has('proxy-revalidate')) {
      if (!expires) return 0
    }
    if (expires) {
      const expiresAt = Date.parse(expires)
      if (!Number.isFinite(expiresAt)) return 0
      maxAge = Math.min(maxAge, expiresAt - Date.now())
    }
    const ageSeconds = Number(response.headers.get('age') ?? 0)
    if (Number.isFinite(ageSeconds) && ageSeconds > 0) maxAge -= ageSeconds * 1000
    return Math.max(0, maxAge)
  }

  private parseDirectives(value: string): Map<string, string | undefined> {
    const directives = new Map<string, string | undefined>()
    for (const part of value.split(',')) {
      const [rawName, ...rawValue] = part.trim().split('=')
      if (rawName)
        directives.set(
          rawName.toLowerCase(),
          rawValue.length ? rawValue.join('=').trim() : undefined,
        )
    }
    return directives
  }

  private key(input: URL, headers: Record<string, string>): string {
    const normalized = Object.entries(headers)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    return `${this.normalizedUrl(input)}\\u0000${JSON.stringify(normalized)}`
  }

  private normalizedUrl(input: URL): string {
    const url = new URL(input.href)
    url.hash = ''
    return url.href
  }

  private resolveUrl(input: string | URL): URL | null {
    try {
      return input instanceof URL ? new URL(input.href) : new URL(input, this.origin)
    } catch {
      return null
    }
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }

  private withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(this.abortError())
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.abortError())
      signal.addEventListener('abort', abort, { once: true })
      promise.then(
        (value) => {
          signal.removeEventListener('abort', abort)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
      )
    })
  }

  private abortError(): DOMException {
    return new DOMException('The operation was aborted', 'AbortError')
  }
}
