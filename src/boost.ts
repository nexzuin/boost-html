import {
  collectScriptSources,
  dropScripts,
  encodeFormBody,
  encodeUrlEncoded,
  executeScripts,
  isHtmlResponse,
  readResponseText,
  replaceContent,
  resolveUrl,
  scrollToHash,
  scrollToPosition,
  scrollToTop,
} from './dom'
import { createProgress, type Progress } from './progress'
import type {
  Boost,
  BoostErrorDetail,
  BoostOptions,
  BoostRequestDetail,
  BoostSwapDetail,
  NavigateOptions,
  ResolvedBoostOptions,
} from './types'

const HANDLED = Symbol.for('boost-html:handled')

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/html, */*; q=0.1',
  'X-Requested-With': 'XMLHttpRequest',
  'HX-Request': 'true',
  'HX-Boosted': 'true',
}

const HTML_METHODS = new Set(['GET', 'POST'])

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

/**
 * `Response.url` is the request URL with the fragment stripped. Keep the hash
 * of the requested URL when the server answered for the same page.
 */
function withRequestedHash(finalUrl: string, requested: URL): string {
  if (!requested.hash) return finalUrl

  try {
    const url = new URL(finalUrl)
    if (!url.hash && url.pathname === requested.pathname && url.search === requested.search) {
      url.hash = requested.hash
      return url.href
    }
  } catch {
    /* keep the response URL as-is */
  }
  return finalUrl
}

function resolveOptions(options: BoostOptions): ResolvedBoostOptions {
  const target = options.target ?? 'body'
  const maxResponseBytes =
    typeof options.maxResponseBytes === 'number' &&
    Number.isFinite(options.maxResponseBytes) &&
    options.maxResponseBytes >= 0
      ? options.maxResponseBytes
      : DEFAULT_MAX_RESPONSE_BYTES

  return {
    scope: options.scope ?? '[data-boost="true"]',
    linkSelector: options.linkSelector ?? 'a[href]',
    formSelector: options.formSelector ?? 'form',
    target: typeof target === 'function' ? target : () => document.querySelector(target),
    history: options.history ?? true,
    scroll: options.scroll ?? true,
    executeScripts: options.executeScripts === true,
    nonce: typeof options.nonce === 'string' ? options.nonce : '',
    maxResponseBytes,
    fallbackToNativeForm: options.fallbackToNativeForm === true,
    progress:
      options.progress === false
        ? false
        : typeof options.progress === 'object'
          ? options.progress
          : {},
    headers: options.headers ?? {},
  }
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

function markHandled(event: Event): void {
  Object.defineProperty(event, HANDLED, { value: true, configurable: true })
}

function wasHandled(event: Event): boolean {
  return Boolean((event as Event & { [HANDLED]?: boolean })[HANDLED])
}

class BoostController implements Boost {
  readonly options: ResolvedBoostOptions
  private readonly progress: Progress
  private controller: AbortController | null = null
  private started = false
  private previousScrollRestoration: ScrollRestoration | null = null

  constructor(options: BoostOptions) {
    this.options = resolveOptions(options)
    this.progress = createProgress(this.options.progress, this.options.nonce)
  }

  start(): this {
    if (this.started || typeof document === 'undefined' || typeof window === 'undefined') {
      return this
    }
    this.started = true
    document.addEventListener('click', this.handleClick as EventListener)
    document.addEventListener('submit', this.handleSubmit as EventListener)
    window.addEventListener('popstate', this.handlePopState as EventListener)

    if (this.options.history && this.options.scroll && 'scrollRestoration' in history) {
      this.previousScrollRestoration = history.scrollRestoration
      history.scrollRestoration = 'manual'
    }
    return this
  }

  stop(): this {
    if (this.started) {
      this.started = false
      document.removeEventListener('click', this.handleClick as EventListener)
      document.removeEventListener('submit', this.handleSubmit as EventListener)
      window.removeEventListener('popstate', this.handlePopState as EventListener)
    }

    this.controller?.abort()
    this.controller = null

    if (this.previousScrollRestoration !== null) {
      history.scrollRestoration = this.previousScrollRestoration
      this.previousScrollRestoration = null
    }
    return this
  }

  async navigate(input: string | URL, init: NavigateOptions = {}): Promise<boolean> {
    if (typeof document === 'undefined' || typeof window === 'undefined') return false

    const url = typeof input === 'string' ? resolveUrl(input) : input
    if (!url) return false

    const method = (init.method ?? 'GET').toUpperCase()

    if (!this.isAllowedUrl(url)) {
      const error = new Error(
        `Refusing to navigate to "${url.href}": only same-origin http(s) URLs are supported`,
      )
      this.dispatch('boost:error', { ...this.toDetail(url, method, init), error }, true)
      return false
    }

    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller

    let optionHeaders: Record<string, string>
    try {
      optionHeaders =
        typeof this.options.headers === 'function'
          ? await this.options.headers()
          : this.options.headers
    } catch (error) {
      if (this.controller === controller) this.controller = null
      const errorDetail: BoostErrorDetail = { ...this.toDetail(url, method, init), error }
      if (this.dispatch('boost:error', errorDetail, true)) this.fallback(url.href, method, init)
      return false
    }

    const detail = this.toDetail(url, method, init, {
      ...DEFAULT_HEADERS,
      ...optionHeaders,
      ...init.headers,
    })

    if (!this.dispatch('boost:before-request', detail, true)) {
      if (this.controller === controller) this.controller = null
      return false
    }

    this.progress.start()

    try {
      const response = await fetch(url.href, {
        method,
        body: method === 'GET' || method === 'HEAD' ? null : (init.body ?? null),
        headers: detail.headers,
        credentials: 'same-origin',
        redirect: 'follow',
        signal: controller.signal,
      })

      if (controller.signal.aborted) return false

      const finalUrl = this.resolveFinalUrl(response, url)
      if (response.status === 204 || response.status === 205) return true
      if (!response.ok) {
        throw new Error(`Request to ${url.href} failed with status ${response.status}`)
      }
      if (!isHtmlResponse(response)) {
        throw new Error(
          `Expected an HTML response but received "${response.headers.get('content-type')}"`,
        )
      }

      const html = await readResponseText(response, this.options.maxResponseBytes)
      if (controller.signal.aborted) return false

      const doc = new DOMParser().parseFromString(html, 'text/html')
      const swapDetail: BoostSwapDetail = { ...detail, url: finalUrl, response, document: doc }

      if (!this.dispatch('boost:before-swap', swapDetail, true)) return false

      const target = this.options.target()
      if (!target) throw new Error('Boost target element was not found in the document')

      const loadedScripts = this.options.executeScripts
        ? collectScriptSources(document, window.location.href)
        : new Set<string>()

      if (init.push !== false) this.rememberScroll()
      const scripts = replaceContent(target, doc)
      if (doc.title) document.title = doc.title
      if (this.options.history) this.commitHistory(finalUrl, init.push ?? true, url.href)

      this.applyScroll(finalUrl, init.scrollY ?? null)

      if (this.options.executeScripts) {
        try {
          await executeScripts(scripts, loadedScripts, finalUrl, this.options.nonce)
        } catch (error) {
          console.error('boost-html: failed to re-execute scripts', error)
        }
      } else {
        dropScripts(scripts)
      }

      this.dispatch('boost:after-swap', swapDetail, false)
      return true
    } catch (error) {
      if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
        return false
      }

      const errorDetail: BoostErrorDetail = { ...detail, error }
      // A listener calling preventDefault() opts out of the hard fallback.
      const fallbackAllowed = this.dispatch('boost:error', errorDetail, true)
      if (fallbackAllowed) this.fallback(url.href, method, init)
      return false
    } finally {
      if (this.controller === controller) {
        this.controller = null
        this.progress.done()
      }
    }
  }

  private toDetail(
    url: URL,
    method: string,
    init: NavigateOptions,
    headers: Record<string, string> = {},
  ): BoostRequestDetail {
    return {
      url: url.href,
      method,
      element: init.element ?? null,
      form: init.form ?? null,
      headers,
    }
  }

  private dispatch(type: string, detail: unknown, cancelable: boolean): boolean {
    if (typeof document === 'undefined') return true
    return document.dispatchEvent(new CustomEvent(type, { detail, cancelable, bubbles: true }))
  }

  private isAllowedUrl(url: URL): boolean {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.origin === window.location.origin
  }

  /**
   * `fetch` follows redirects. Never commit a response whose final URL left the
   * origin or uses a non-http(s) scheme, otherwise URL and displayed content
   * can diverge and cross-origin HTML (with scripts) would be injected.
   */
  private resolveFinalUrl(response: Response, requested: URL): string {
    let finalUrl: URL
    try {
      finalUrl = new URL(response.url || requested.href)
    } catch {
      throw new Error(`Refusing to swap an invalid response URL "${response.url}"`)
    }

    if (finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') {
      throw new Error(`Refusing to swap a response from "${finalUrl.protocol}"`)
    }
    if (finalUrl.origin !== window.location.origin) {
      throw new Error(`Refusing to swap a cross-origin response from "${finalUrl.origin}"`)
    }

    return withRequestedHash(finalUrl.href, requested)
  }

  private isBoosted(element: Element): boolean {
    if (element.closest('[data-boost="false"]')) return false
    return Boolean(element.closest(this.options.scope))
  }

  private handleClick = (event: MouseEvent): void => {
    if (wasHandled(event) || event.defaultPrevented || isModifiedClick(event)) return

    const target = event.target
    if (!(target instanceof Element)) return

    const link = target.closest(this.options.linkSelector)
    if (!(link instanceof HTMLAnchorElement)) return
    if (!this.isBoosted(link)) return

    if (link.hasAttribute('download')) return
    const linkTarget = link.getAttribute('target')
    if (linkTarget && linkTarget !== '_self') return
    if ((link.getAttribute('rel') ?? '').split(/\s+/).includes('external')) return

    const href = link.getAttribute('href')
    if (!href || href.startsWith('#')) return

    const url = resolveUrl(href)
    if (!url || url.origin !== window.location.origin) return
    if (!/^https?:$/.test(url.protocol)) return

    const current = new URL(window.location.href)
    const sameDocument =
      url.pathname === current.pathname && url.search === current.search && url.hash !== ''
    if (sameDocument) return

    event.preventDefault()
    markHandled(event)
    void this.navigate(url.href, { element: link, push: true })
  }

  private handleSubmit = (event: Event): void => {
    if (wasHandled(event) || event.defaultPrevented) return

    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    if (!this.isBoosted(form)) return

    const submitter = (event as SubmitEvent).submitter as
      | HTMLButtonElement
      | HTMLInputElement
      | null

    const formTarget = submitter?.getAttribute('formtarget') ?? form.getAttribute('target')
    if (formTarget) return

    const rawMethod = (
      submitter?.getAttribute('formmethod') ??
      form.getAttribute('method') ??
      'get'
    ).toUpperCase()
    if (rawMethod === 'DIALOG') return
    // Browsers treat unknown form methods as GET.
    const method = HTML_METHODS.has(rawMethod) ? rawMethod : 'GET'

    const action =
      submitter?.getAttribute('formaction') || form.getAttribute('action') || window.location.href
    const url = resolveUrl(action)
    if (!url || !this.isAllowedUrl(url)) return

    const formData = new FormData(form)
    if (submitter instanceof HTMLInputElement && submitter.type === 'image') {
      if (submitter.name) {
        formData.append(`${submitter.name}.x`, '0')
        formData.append(`${submitter.name}.y`, '0')
      }
    } else if (submitter?.name) {
      formData.append(submitter.name, submitter.value)
    }

    let body: BodyInit | null = null
    let headers: Record<string, string> | undefined
    if (method === 'GET') {
      url.search = encodeUrlEncoded(formData)
      url.hash = ''
    } else {
      const enctype =
        submitter?.getAttribute('formenctype') ??
        form.getAttribute('enctype') ??
        'application/x-www-form-urlencoded'
      const encoded = encodeFormBody(formData, enctype)
      body = encoded.body
      headers = encoded.headers
    }

    event.preventDefault()
    markHandled(event)
    void this.navigate(url.href, {
      method,
      body,
      headers,
      element: form,
      form,
      push: true,
    })
  }

  private handlePopState = (event: PopStateEvent): void => {
    const state = event.state as { boostScrollY?: number } | null
    const scrollY = typeof state?.boostScrollY === 'number' ? state.boostScrollY : null

    void this.navigate(window.location.href, { push: false, scrollY })
  }

  private rememberScroll(): void {
    if (!this.options.history) return
    try {
      const state = typeof history.state === 'object' && history.state !== null ? history.state : {}
      history.replaceState({ ...state, boostScrollY: window.scrollY }, '')
    } catch {
      /* history may be unavailable in some sandboxes */
    }
  }

  private commitHistory(target: string, push: boolean | 'replace', requested: string): void {
    try {
      if (push === false) {
        if (target !== requested) {
          history.replaceState({ ...(history.state ?? {}), boost: true }, '', target)
        }
        return
      }

      const state = { boost: true, boostScrollY: 0 }
      if (push === 'replace') history.replaceState(state, '', target)
      else history.pushState(state, '', target)
    } catch {
      /* history may be unavailable in some sandboxes */
    }
  }

  private applyScroll(finalUrl: string, scrollY: number | null): void {
    if (scrollY !== null) {
      scrollToPosition(scrollY)
      return
    }
    if (!this.options.scroll) return

    const hash = resolveUrl(finalUrl)?.hash
    if (hash && scrollToHash(hash)) return
    scrollToTop()
  }

  private fallback(url: string, method: string, init: NavigateOptions): void {
    if (method === 'GET' || method === 'HEAD') {
      this.hardNavigate(url)
      return
    }

    // Non-idempotent requests are never retried automatically. Re-submitting a
    // POST after an ambiguous network failure can duplicate server-side effects.
    if (init.form && this.options.fallbackToNativeForm) {
      try {
        HTMLFormElement.prototype.submit.call(init.form)
      } catch {
        /* the caller can observe boost:error */
      }
    }
  }

  private hardNavigate(url: string): void {
    try {
      window.location.assign(url)
    } catch {
      window.location.href = url
    }
  }
}

export function createBoost(options: BoostOptions = {}): Boost {
  return new BoostController(options)
}
