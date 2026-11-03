import { updateDOM } from '../src/dom/engine'
import { readResponseText } from '../src/response/document'

declare global {
  interface Window {
    __boostBenchReadResponseText: typeof readResponseText
    __boostBenchUpdateDOM: typeof updateDOM
  }
}

window.__boostBenchReadResponseText = readResponseText
window.__boostBenchUpdateDOM = updateDOM
