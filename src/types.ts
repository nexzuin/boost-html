/**
 * Options forwarded to `NProgress.configure()`.
 * @see https://ricostacruz.com/nprogress/
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
  /** Custom template. */
  template?: string
}

export type BoostHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>)

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
   * Where the response body is swapped in. Accepts a CSS selector or a
   * function returning an element.
   * @default 'body'
   */
  target?: string | (() => Element | null)
  /** Update `history` on navigation. @default true */
  history?: boolean
  /** Scroll to the top (or to the URL hash) after a swap. @default true */
  scroll?: boolean
  /**
   * Re-run scripts found in the swapped markup.
   *
   * Disabled by default. Fetched HTML is trusted as much as a full page load;
   * enabling this re-executes inline and external scripts from the response.
   * @default false
   */
  executeScripts?: boolean
  /**
   * Content Security Policy nonce applied to the injected progress styles and
   * to re-executed scripts that do not already carry one.
   */
  nonce?: string
  /**
   * Maximum response body size in bytes. `0` disables the limit.
   * @default 2097152 (2 MiB)
   */
  maxResponseBytes?: number
  /**
   * Re-submit a failed non-idempotent form natively. This can duplicate
   * server-side effects and is disabled by default.
   * @default false
   */
  fallbackToNativeForm?: boolean
  /**
   * Show the NProgress bar during requests. Pass `false` to disable,
   * or a configuration object to customise NProgress.
   * @default true
   */
  progress?: boolean | ProgressOptions
  /** Extra headers sent with every boosted request. */
  headers?: BoostHeaders
}

export interface ResolvedBoostOptions {
  scope: string
  linkSelector: string
  formSelector: string
  target: () => Element | null
  history: boolean
  scroll: boolean
  executeScripts: boolean
  nonce: string
  maxResponseBytes: number
  fallbackToNativeForm: boolean
  progress: false | ProgressOptions
  headers: BoostHeaders
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

export interface BoostErrorDetail extends BoostRequestDetail {
  error: unknown
}

export interface Boost {
  readonly options: ResolvedBoostOptions
  /** Attach the DOM listeners. Safe to call more than once. */
  start(): this
  /** Detach the DOM listeners and abort in-flight requests. */
  stop(): this
  /** Programmatically navigate. Resolves to `true` when the swap succeeded. */
  navigate(url: string | URL, options?: NavigateOptions): Promise<boolean>
}
