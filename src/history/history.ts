export function rememberScrollPosition(): void {
  try {
    const state = typeof history.state === 'object' && history.state !== null ? history.state : {}
    history.replaceState({ ...state, boostScrollY: window.scrollY }, '')
  } catch {
    /* history can be unavailable in sandboxed contexts */
  }
}
export function commitHistory(target: string, push: boolean | 'replace', requested: string): void {
  try {
    if (push === false) {
      if (target !== requested)
        history.replaceState({ ...(history.state ?? {}), boost: true }, '', target)
      return
    }
    const state = { boost: true, boostScrollY: 0 }
    if (push === 'replace') history.replaceState(state, '', target)
    else history.pushState(state, '', target)
  } catch {
    /* history can be unavailable in sandboxed contexts */
  }
}
