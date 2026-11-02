import NProgress from 'nprogress'
import type { ProgressOptions } from './types'

export interface Progress {
  start(): void
  done(): void
}

const STYLE_ID = 'boost-html-progress-style'

const CSS = `#nprogress{pointer-events:none}
#nprogress .bar{background:#29d;position:fixed;z-index:1031;top:0;left:0;width:100%;height:2px}
#nprogress .peg{display:block;position:absolute;right:0;width:100px;height:100%;box-shadow:0 0 10px #29d,0 0 5px #29d;opacity:1;transform:rotate(3deg) translate(0,-4px)}
#nprogress .spinner{display:block;position:fixed;z-index:1031;top:15px;right:15px}
#nprogress .spinner-icon{width:18px;height:18px;box-sizing:border-box;border:2px solid transparent;border-top-color:#29d;border-left-color:#29d;border-radius:50%;animation:boost-html-progress-spin .4s linear infinite}
@keyframes boost-html-progress-spin{to{transform:rotate(360deg)}}`

let styleElement: HTMLStyleElement | null = null

function injectStyles(nonce: string): void {
  if (typeof document === 'undefined') return

  if (!styleElement?.isConnected) {
    const head = document.head ?? document.documentElement
    const existing = head?.querySelector<HTMLStyleElement>('style[data-boost-html-progress]')
    styleElement = existing ?? document.createElement('style')

    if (!existing) {
      styleElement.id = STYLE_ID
      styleElement.setAttribute('data-boost-html-progress', '')
      styleElement.textContent = CSS
      head?.appendChild(styleElement)
    }
  }

  if (nonce && !styleElement.hasAttribute('nonce')) {
    styleElement.setAttribute('nonce', nonce)
  }
}

const noopProgress: Progress = { start() {}, done() {} }

export function createProgress(options: false | ProgressOptions, nonce = ''): Progress {
  if (options === false) return noopProgress

  return {
    start() {
      if (typeof document === 'undefined') return
      injectStyles(nonce)
      NProgress.configure(options)
      NProgress.start()
    },
    done() {
      if (typeof document === 'undefined') return
      NProgress.done()
    },
  }
}
