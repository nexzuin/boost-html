const BOOST_STATE_KEY = '__boostHtml'

interface BoostHistoryMetadata {
  version: 1
  scrollY?: number
  focusId?: string
}

type HistoryStateRecord = Record<string, unknown>

function getStateRecord(state: unknown): HistoryStateRecord {
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const prototype = Object.getPrototypeOf(state)
    if (prototype === Object.prototype || prototype === null) {
      return { ...(state as HistoryStateRecord) }
    }
  }
  return state === null || state === undefined ? {} : { __boostHtmlOriginalState: state }
}

function getMetadata(state: unknown): BoostHistoryMetadata | null {
  if (!state || typeof state !== 'object') return null
  const metadata = (state as HistoryStateRecord)[BOOST_STATE_KEY]
  if (!metadata || typeof metadata !== 'object') return null
  const value = metadata as Partial<BoostHistoryMetadata>
  return value.version === 1 ? (value as BoostHistoryMetadata) : null
}

function writeState(url?: string, scrollY?: number, focusId?: string, resetMetadata = false): void {
  const state = getStateRecord(history.state)
  const previous = resetMetadata ? null : getMetadata(state)
  const metadata: BoostHistoryMetadata = {
    version: 1,
    ...(typeof scrollY === 'number' && Number.isFinite(scrollY)
      ? { scrollY: Math.max(0, scrollY) }
      : typeof previous?.scrollY === 'number'
        ? { scrollY: previous.scrollY }
        : {}),
    ...(typeof focusId === 'string' && focusId
      ? { focusId }
      : previous?.focusId
        ? { focusId: previous.focusId }
        : {}),
  }
  state[BOOST_STATE_KEY] = metadata
  history.replaceState(state, '', url)
}

export function initializeHistoryEntry(): void {
  try {
    writeState()
  } catch {
    /* History may be unavailable in sandboxed or restricted contexts. */
  }
}

export function rememberScrollPosition(scrollY = window.scrollY, focusId?: string): void {
  try {
    writeState(undefined, scrollY, focusId)
  } catch {
    /* History may be unavailable in sandboxed or restricted contexts. */
  }
}

export function isBoostHistoryState(state: unknown): boolean {
  return getMetadata(state) !== null
}

export function getHistoryScrollPosition(state: unknown): number | null {
  const value = getMetadata(state)?.scrollY
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

export function getHistoryFocusId(state: unknown): string | null {
  const value = getMetadata(state)?.focusId
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Commit a successful navigation. Same-URL pushes become replacements, and
 * application-owned object state is retained alongside compact boost metadata.
 */
export function commitHistory(
  target: string,
  push: boolean | 'replace',
  requested: string,
): boolean {
  try {
    if (push === false) {
      if (target !== requested) writeState(target, 0, undefined, true)
      return true
    }

    const current = new URL(window.location.href)
    const next = new URL(target, current)
    const shouldReplace = push === 'replace' || current.href === next.href

    if (shouldReplace) {
      writeState(next.href, 0, undefined, true)
      return true
    }

    const state = getStateRecord(history.state)
    state[BOOST_STATE_KEY] = { version: 1, scrollY: 0 } satisfies BoostHistoryMetadata
    history.pushState(state, '', next.href)
    return true
  } catch {
    return false
  }
}
