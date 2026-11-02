import { createBoost } from './boost'
import type { Boost, BoostOptions } from './types'

declare global {
  interface Window {
    /** Auto-created instance, available when the browser build is loaded. */
    boostHtml?: Boost
    /** Set before the library is loaded to configure auto-initialisation. */
    boostHtmlConfig?: BoostOptions
  }
}

let instance: Boost | null = null

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  instance = createBoost(window.boostHtmlConfig ?? {})
  instance.start()
  window.boostHtml = instance
}

/** The auto-created instance, or `null` outside the browser. */
export function getBoost(): Boost | null {
  return instance
}

export type {
  Boost,
  BoostDOMUpdateDetail,
  BoostErrorDetail,
  BoostHeaders,
  BoostOptions,
  BoostRequestDetail,
  BoostSwapDetail,
  DOMScriptHandler,
  DOMSwapHandler,
  DOMUpdateContext,
  HeadUpdateMode,
  MorphAdapter,
  NavigateOptions,
  ProgressOptions,
  ResolvedBoostOptions,
} from './types'
export { createBoost }
