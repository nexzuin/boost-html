import {
  announceNavigation,
  focusAfterNavigation,
  removeAnnouncementRegion,
} from '../accessibility/navigation'
import { resolveOptions } from '../core/options'
import {
  encodeFormBody,
  encodeUrlEncoded,
  isHtmlResponse,
  readResponseText,
  resolveUrl,
  scrollToHash,
  scrollToPosition,
  scrollToTop,
} from '../dom'
import {
  type DOMUpdateContext,
  handleResponseScripts,
  updateDOM,
  updateDocumentHead,
} from '../dom/engine'
import { dispatchEvent } from '../events/events'
import {
  commitHistory,
  getHistoryFocusId,
  getHistoryScrollPosition,
  initializeHistoryEntry,
  isBoostHistoryState,
  rememberScrollPosition,
} from '../history/history'
import { createProgress, type Progress } from '../progress'
import { sendRequest } from '../request/request'
import type {
  Boost,
  BoostDOMUpdateDetail,
  BoostErrorDetail,
  BoostOptions,
  BoostRequestDetail,
  BoostSwapDetail,
  NavigateOptions,
  ResolvedBoostOptions,
} from '../types'

const HANDLED = Symbol.for('boost-html:handled')

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/html, */*; q=0.1',
  'X-Requested-With': 'XMLHttpRequest',
  'HX-Request': 'true',
  'HX-Boosted': 'true',
}

const HTML_METHODS = new Set(['GET', 'POST'])

function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

function markHandled(event: Event): void {
  Object.defineProperty(event, HANDLED, { value: true, configurable: true })
}

function wasHandled(event: Event): boolean {
  return Boolean((event as Event & { [HANDLED]?: boolean })[HANDLED])
}

class NavigationController implements Boost {
  readonly options: ResolvedBoostOptions
  private readonly progress: Progress
  private controller: AbortController | null = null
  private readonly submittingForms = new WeakSet<HTMLFormElement>()
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

    if (this.options.history) {
      window.addEventListener('popstate', this.handlePopState as EventListener)
      initializeHistoryEntry()
    }
    if (this.options.history && this.options.scroll && 'scrollRestoration' in history) {
      try {
        this.previousScrollRestoration = history.scrollRestoration
        history.scrollRestoration = 'manual'
      } catch {
        this.previousScrollRestoration = null
      }
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
    this.progress.done()

    if (this.previousScrollRestoration !== null) {
      try {
        history.scrollRestoration = this.previousScrollRestoration
      } catch {
        /* the host may have disabled History API mutation */
      }
      this.previousScrollRestoration = null
    }
    removeAnnouncementRegion()
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
      if (!this.isCurrent(controller)) return false
      this.controller = null
      const errorDetail: BoostErrorDetail = { ...this.toDetail(url, method, init), error }
      if (this.dispatch('boost:error', errorDetail, true)) this.fallback(url.href, method, init)
      return false
    }

    if (!this.isCurrent(controller)) return false

    const detail = this.toDetail(url, method, init, {
      ...DEFAULT_HEADERS,
      ...optionHeaders,
      ...init.headers,
    })

    if (!this.dispatch('boost:before-request', detail, true)) {
      if (this.controller === controller) this.controller = null
      return false
    }
    if (!this.isCurrent(controller)) return false

    this.progress.start()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      // Resolve once before the request; never repeatedly query a configurable selector.
      const target = this.options.target(document)
      if (!target?.isConnected)
        throw new Error('Boost target element was not found in the document')

      if (this.options.requestTimeoutMs > 0) {
        timeoutId = setTimeout(() => {
          controller.abort(new DOMException('The navigation request timed out', 'TimeoutError'))
        }, this.options.requestTimeoutMs)
      }

      const response = await sendRequest({
        url: url.href,
        method,
        body: init.body ?? null,
        headers: detail.headers,
        signal: controller.signal,
      })

      if (controller.signal.aborted) {
        if (controller.signal.reason?.name === 'TimeoutError') throw controller.signal.reason
        return false
      }

      const finalUrlObject = this.resolveFinalUrl(response, url)
      const finalUrl = finalUrlObject.href
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
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      if (!this.isCurrent(controller)) return false

      const parsedHTML = this.options.createHTML ? this.options.createHTML(html) : html
      const doc = new DOMParser().parseFromString(parsedHTML as string, 'text/html')
      // DOMParser repairs malformed markup; validate the resulting document shape,
      // not the source string. Parsing does not sanitize untrusted HTML.
      if (doc.documentElement?.localName !== 'html' || !doc.head || !doc.body) {
        throw new Error('The HTML response did not produce a valid HTML document')
      }
      const incoming = this.options.target(doc)
      if (!incoming || incoming.ownerDocument !== doc) {
        throw new Error('Boost response target was not found in the HTML document')
      }
      if (!target.isConnected)
        throw new Error('Boost target element is no longer connected to the document')

      const swapDetail: BoostSwapDetail = { ...detail, url: finalUrl, response, document: doc }
      if (!this.dispatch('boost:before-swap', swapDetail, true)) return false
      if (!this.isCurrent(controller)) return false

      const domContext: DOMUpdateContext = {
        target,
        incoming,
        document: doc,
        url: finalUrl,
        response,
        nonce: this.options.nonce,
      }
      const updateDetail: BoostDOMUpdateDetail = { ...swapDetail, target, incoming }
      if (!this.dispatch('boost:before-dom-update', updateDetail, true)) return false
      if (!this.isCurrent(controller)) return false

      if (init.push === undefined || init.push === true) this.rememberScroll()
      const scripts = updateDOM(
        domContext,
        {
          strategy: this.options.swapStrategy,
          morphAdapter: this.options.morphAdapter,
          swapHandler: this.options.swapHandler,
        },
        html,
      )
      updateDocumentHead(document, doc, this.options.head)
      if (this.options.history && !this.commitHistory(finalUrl, init.push ?? true, url.href)) {
        // Keep the address bar and rendered document consistent if History API
        // mutation is blocked by the browser or host environment.
        this.hardNavigate(finalUrl)
        return false
      }
      this.applyScroll(init.scrollY ?? null, finalUrlObject.hash)
      focusAfterNavigation(target, this.options.focus, init.focusId, finalUrlObject.hash)
      if (this.options.announce) announceNavigation(document.title)
      this.dispatch('boost:after-dom-update', updateDetail, false)

      try {
        const scriptWork = handleResponseScripts(scripts, domContext, this.options.scriptHandler)
        if (scriptWork && typeof scriptWork.then === 'function') {
          void scriptWork.catch((error) => {
            console.error('boost-html: explicit script handler failed', error)
          })
        }
      } catch (error) {
        console.error('boost-html: explicit script handler failed', error)
      }

      this.dispatch('boost:after-swap', swapDetail, false)
      return true
    } catch (error) {
      const timedOut = controller.signal.reason?.name === 'TimeoutError'
      if (
        (controller.signal.aborted && !timedOut) ||
        (!timedOut && (error as { name?: string } | null)?.name === 'AbortError')
      ) {
        return false
      }

      const errorDetail: BoostErrorDetail = { ...detail, error }
      // A listener calling preventDefault() opts out of the hard fallback.
      const fallbackAllowed = this.dispatch('boost:error', errorDetail, true)
      if (fallbackAllowed) this.fallback(url.href, method, init)
      return false
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      if (this.controller === controller) {
        this.controller = null
        this.progress.done()
      }
    }
  }

  private isCurrent(controller: AbortController): boolean {
    return this.controller === controller && !controller.signal.aborted
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
    return dispatchEvent(type, detail, cancelable)
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
  private resolveFinalUrl(response: Response, requested: URL): URL {
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
    if (
      requested.hash &&
      !finalUrl.hash &&
      finalUrl.pathname === requested.pathname &&
      finalUrl.search === requested.search
    ) {
      finalUrl.hash = requested.hash
    }

    return finalUrl
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

    if (link.hasAttribute('download') || link.getAttribute('aria-disabled') === 'true') return
    const linkTarget = link.getAttribute('target')
    if (linkTarget && linkTarget.toLowerCase() !== '_self') return
    if ((link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('external')) return

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
    if (this.submittingForms.has(form)) {
      event.preventDefault()
      markHandled(event)
      return
    }

    const submitter = (event as SubmitEvent).submitter as
      | HTMLButtonElement
      | HTMLInputElement
      | null

    const formTarget = submitter?.getAttribute('formtarget') ?? form.getAttribute('target')
    if (formTarget && formTarget.toLowerCase() !== '_self') return

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
      const query = new URLSearchParams(url.search)
      for (const [name, value] of new URLSearchParams(encodeUrlEncoded(formData))) {
        query.append(name, value)
      }
      url.search = query.toString()
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
    this.submittingForms.add(form)
    void this.navigate(url.href, {
      method,
      body,
      headers,
      element: form,
      form,
      push: true,
    }).finally(() => this.submittingForms.delete(form))
  }

  private handlePopState = (event: PopStateEvent): void => {
    // Leave entries owned by the browser or another router untouched.
    if (!this.options.history || !isBoostHistoryState(event.state)) return
    const scrollY = this.options.scroll ? getHistoryScrollPosition(event.state) : null
    const focusId = getHistoryFocusId(event.state)
    void this.navigate(window.location.href, { push: false, scrollY, focusId })
  }

  private rememberScroll(): void {
    if (!this.options.history || (!this.options.scroll && this.options.focus === false)) return
    const active = document.activeElement
    const focusId =
      this.options.focus !== false && active instanceof HTMLElement && active.id
        ? active.id
        : undefined
    rememberScrollPosition(this.options.scroll ? window.scrollY : 0, focusId)
  }

  private commitHistory(target: string, push: boolean | 'replace', requested: string): boolean {
    return commitHistory(target, push, requested)
  }

  private applyScroll(scrollY: number | null, hash: string): void {
    if (!this.options.scroll) return
    if (scrollY !== null) {
      scrollToPosition(scrollY)
      return
    }
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
  return new NavigationController(options)
}
