import { sanitizeUntrustedSubtree } from '../dom/engine'
import type { ProgressOptions } from '../types'

export interface Progress {
  start(): void
  done(): void
}

const STYLE_ID = 'boost-html-progress-style'
const CSS = `.boost-html-progress{position:fixed;inset:0 0 auto;z-index:2147483647;height:2px;pointer-events:none}.boost-html-progress-bar{height:100%;width:0;background:#29d;box-shadow:0 0 8px #29d;transition:width .2s ease,opacity .2s ease}.boost-html-progress-spinner{position:fixed;top:15px;right:15px;width:18px;height:18px;border:2px solid transparent;border-top-color:#29d;border-left-color:#29d;border-radius:50%;animation:boost-html-progress-spin .4s linear infinite}@keyframes boost-html-progress-spin{to{transform:rotate(360deg)}}`

function injectStyles(nonce: string): void {
  if (typeof document === 'undefined') return
  const head = document.head ?? document.documentElement
  if (!head?.querySelector(`#${STYLE_ID}`)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.setAttribute('data-boost-html-progress', '')
    style.textContent = CSS
    if (nonce) style.setAttribute('nonce', nonce)
    head.appendChild(style)
  }
  const existing = head.querySelector<HTMLStyleElement>(`#${STYLE_ID}`)
  if (nonce && existing && !existing.hasAttribute('nonce')) existing.setAttribute('nonce', nonce)
}

const noopProgress: Progress = { start() {}, done() {} }

export function createProgress(
  options: false | ProgressOptions,
  nonce = '',
  createHTML?: (html: string) => string | object,
): Progress {
  if (options === false) return noopProgress
  let container: HTMLElement | null = null
  let bar: HTMLElement | null = null
  let trickleTimer: ReturnType<typeof setInterval> | undefined
  const minimum = Math.min(0.99, Math.max(0.01, options.minimum ?? 0.08))
  const speed = Math.max(0, options.speed ?? 200)
  const trickleSpeed = Math.max(100, options.trickleSpeed ?? 800)
  const easing = options.easing ?? 'ease'
  let value = minimum

  const setValue = (next: number) => {
    value = Math.min(0.994, Math.max(value, next))
    if (bar) {
      bar.style.transition = `width ${speed}ms ${easing},opacity ${speed}ms ${easing}`
      bar.style.width = `${value * 100}%`
    }
  }

  const createIndicator = (): void => {
    if (options.template) {
      const trustedTemplate = createHTML ? createHTML(options.template) : options.template
      const parsed = new DOMParser().parseFromString(trustedTemplate as string, 'text/html')
      sanitizeUntrustedSubtree(parsed.body, document.baseURI)
      const root =
        parsed.querySelector<HTMLElement>('#nprogress') ??
        (parsed.body.firstElementChild as HTMLElement | null)
      if (root) container = root
    }

    container ??= document.createElement('div')
    container.classList.add('boost-html-progress')
    container.setAttribute('role', 'progressbar')
    container.setAttribute('aria-label', 'Loading')

    bar = container.querySelector<HTMLElement>('.bar, .boost-html-progress-bar')
    if (!bar) {
      bar = document.createElement('div')
      container.appendChild(bar)
    }
    bar.classList.add('boost-html-progress-bar')

    const spinner =
      container.querySelector<HTMLElement>('.spinner-icon, .boost-html-progress-spinner') ??
      container.querySelector<HTMLElement>('.spinner')
    if (options.showSpinner !== false) {
      if (spinner) spinner.classList.add('boost-html-progress-spinner')
      else {
        const icon = document.createElement('div')
        icon.className = 'boost-html-progress-spinner'
        icon.setAttribute('aria-hidden', 'true')
        container.appendChild(icon)
      }
    } else {
      container.querySelector('.spinner')?.remove()
      container.querySelector('.boost-html-progress-spinner')?.remove()
    }

    const parent = options.parent ? document.querySelector(options.parent) : document.body
    ;(parent ?? document.body ?? document.documentElement).appendChild(container)
  }

  const cleanup = () => {
    if (trickleTimer !== undefined) clearInterval(trickleTimer)
    trickleTimer = undefined
    const node = container
    container = null
    bar = null
    if (node) {
      node.style.opacity = '0'
      setTimeout(() => node.remove(), speed)
    }
  }

  return {
    start() {
      if (typeof document === 'undefined') return
      injectStyles(nonce)
      if (!container) createIndicator()
      value = 0
      setValue(minimum)
      if (options.trickle !== false && trickleTimer === undefined) {
        trickleTimer = setInterval(() => setValue(value + (1 - value) * 0.04), trickleSpeed)
      }
    },
    done() {
      if (!container) return
      if (bar) bar.style.width = '100%'
      cleanup()
    },
  }
}
