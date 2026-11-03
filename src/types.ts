import type {
  DOMScriptHandler,
  DOMSwapHandler,
  DOMUpdateContext,
  HeadUpdateMode,
  MorphAdapter,
} from './dom/engine'

/**
 * Configuration for the built-in native progress indicator.
 */
export interface ProgressOptions {
  /** Minimum percentage used upon starting, between 0 and 1. */
  minimum?: number
  /** CSS easing string, e.g. `ease`. */
  easing?: string
  /** Animation speed in milliseconds. */
  speed?: number
  /** Enable the automatic trickle. */
  trickle?: boolean
  /** How often the bar grows automatically, in milliseconds. */
  trickleSpeed?: number
  /** Show the spinner. */
  showSpinner?: boolean
  /** Parent element selector. */
  parent?: string
  /** Custom HTML fragment; use the #nprogress, .bar and .spinner conventions. */
  template?: string
}

export type BoostHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>)

export interface PrefetchOptions {
  /** Enable opportunistic same-origin GET prefetching. @default false */
  enabled?: boolean
  /** Trigger strategy or strategies. @default 'hover' */
  strategy?: 'hover' | 'pointerdown' | 'viewport' | Array<'hover' | 'pointerdown' | 'viewport'>
  /** Hover delay in milliseconds. @default 100 */
  delay?: number
  /** Maximum concurrent prefetch requests. @default 2 */
  maxConcurrent?: number
  /** Path prefixes that must never be prefetched, e.g. ['/logout', '/account/delete']. */
  exclude?: string[]
}

export interface ResolvedPrefetchOptions {
  enabled: boolean
  strategy: Array<'hover' | 'pointerdown' | 'viewport'>
  delay: number
  maxConcurrent: number
  exclude: string[]
}

/** Configuration for the optional in-memory navigation cache. */
export interface NavigationCacheOptions {
  /** Enable per-instance in-memory caching. @default false */
  enabled?: boolean
  /** Maximum number of cached URL/header variants. @default 20 */
  maxEntries?: number
  /** Maximum local freshness lifetime in milliseconds. @default 30000 */
  maxAge?: number
  /** Path prefixes that must never be cached. */
  exclude?: string[]
}

export interface ResolvedNavigationCacheOptions {
  enabled: boolean
  maxEntries: number
  maxAge: number
  exclude: string[]
}

export interface BoostOptions {
  /**
   * CSS selector that marks boosted subtrees.
   * Any link or form inside a matching element is boosted.
   * @default '[data-boost="true"]'
   */
  scope?: string
  /** CSS selector used to find links. @default 'a[href]' */
  linkSelector?: string
  /** CSS selector used to find forms. @default 'form' */
  formSelector?: string
  /**
   * Live DOM target and matching response target. A selector is resolved in
   * both documents. A callback receives the document to query; legacy zero-arg
   * callbacks remain supported and use the response body as incoming content.
   * @default 'body'
   */
  target?: string | ((document?: Document) => Element | null)
  /** DOM update strategy. Native replacement is the default. @default 'replace' */
  swapStrategy?: 'replace' | 'morph'
  /** Optional adapter used only when `swapStrategy` is `morph`. */
  morphAdapter?: MorphAdapter
  /** Custom synchronous DOM update; overrides the built-in strategy. */
  swapHandler?: DOMSwapHandler
  /** Explicit script handling hook. No scripts are executed unless this is supplied. */
  scriptHandler?: DOMScriptHandler
  /** Update title only (default), title plus safe descriptive metadata, or no head fields. */
  head?: HeadUpdateMode
  /**
   * Optional host-owned Trusted Types policy hook for DOMParser input under
   * strict CSP. Under enforcement, return the policy's TrustedHTML object.
   * This hook does not sanitize HTML.
   */
  createHTML?: (html: string) => string | object
  /** Update `history` on navigation. @default true */
  history?: boolean
  /** Scroll to the top, URL hash, or saved position after a swap. @default true */
  scroll?: boolean
  /** Focus the main landmark after navigation, a selector, or false to disable. @default true */
  focus?: boolean | string
  /** Announce successful page changes through a polite live region. @default true */
  announce?: boolean
  /** @deprecated Scripts are never automatically executed. Use `scriptHandler` for explicit handling. */
  executeScripts?: boolean
  /**
   * Content Security Policy nonce applied to injected progress styles and
   * passed to explicit script handlers for their own CSP-aware policy.
   */
  nonce?: string
  /**
   * Maximum response body size in bytes. `0` disables the limit.
   * @default 2097152 (2 MiB)
   */
  maxResponseBytes?: number
  /** Maximum time in milliseconds to wait for a response. `0` disables the timeout. @default 0 */
  requestTimeoutMs?: number
  /**
   * Re-submit a failed non-idempotent form natively. This can duplicate
   * server-side effects and is disabled by default.
   * @default false
   */
  fallbackToNativeForm?: boolean
  /** Show the native progress indicator. Pass `false` to disable it. @default true */
  progress?: boolean | ProgressOptions
  /** Optional, conservative prefetch engine. Disabled by default. */
  prefetch?: PrefetchOptions
  /** Optional per-instance in-memory LRU navigation cache. Disabled by default. */
  cache?: NavigationCacheOptions
  /** Extra headers sent with every boosted request. */
  headers?: BoostHeaders
}

export interface ResolvedBoostOptions {
  scope: string
  linkSelector: string
  formSelector: string
  target: (document?: Document) => Element | null
  swapStrategy: 'replace' | 'morph'
  morphAdapter?: MorphAdapter
  swapHandler?: DOMSwapHandler
  scriptHandler?: DOMScriptHandler
  head: HeadUpdateMode
  createHTML?: (html: string) => string | object
  history: boolean
  scroll: boolean
  focus: string | false
  announce: boolean
  executeScripts: boolean
  nonce: string
  maxResponseBytes: number
  requestTimeoutMs: number
  fallbackToNativeForm: boolean
  progress: false | ProgressOptions
  headers: BoostHeaders
  prefetch: ResolvedPrefetchOptions
  cache: ResolvedNavigationCacheOptions
}

export interface NavigateOptions {
  /** HTTP method, `GET` by default. */
  method?: string
  /** Request body for non-GET requests. */
  body?: BodyInit | null
  /** Extra headers for this request only. */
  headers?: Record<string, string>
  /**
   * Whether to update the history: `true`/`'push'` pushes a new entry,
   * `'replace'` replaces it, `false` leaves history untouched.
   * @default true
   */
  push?: boolean | 'replace'
  /** Element that triggered the navigation (used in event details). */
  element?: Element | null
  /** Form that triggered the navigation, if any. */
  form?: HTMLFormElement | null
  /** Explicit scroll position to restore after the swap. */
  scrollY?: number | null
  /** Internal history focus target restored on browser back/forward. */
  focusId?: string | null
}

export interface BoostRequestDetail {
  url: string
  method: string
  element: Element | null
  form: HTMLFormElement | null
  headers: Record<string, string>
}

export interface BoostSwapDetail extends BoostRequestDetail {
  response: Response
  document: Document
}

export interface BoostDOMUpdateDetail extends BoostSwapDetail {
  target: Element
  incoming: Element
}

export interface BoostErrorDetail extends BoostRequestDetail {
  error: unknown
}

export type { DOMScriptHandler, DOMSwapHandler, DOMUpdateContext, HeadUpdateMode, MorphAdapter }

export interface Boost {
  readonly options: ResolvedBoostOptions
  /** Attach the DOM listeners. Safe to call more than once. */
  start(): this
  /** Detach the DOM listeners and abort in-flight requests. */
  stop(): this
  /** Programmatically navigate. Resolves to `true` when the swap succeeded. */
  navigate(url: string | URL, options?: NavigateOptions): Promise<boolean>
  /** Opportunistically prefetch an eligible same-origin HTML GET URL. */
  prefetch(url: string | URL): Promise<boolean>
  /** Clear every cached response, or only variants for the supplied URL. */
  clearCache(url?: string | URL): this
}
