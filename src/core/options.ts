import type { BoostOptions, ResolvedBoostOptions } from '../types'

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function resolveCacheOptions(options: BoostOptions['cache']): ResolvedBoostOptions['cache'] {
  const maxEntries = options?.maxEntries
  const maxAge = options?.maxAge
  return {
    enabled: options?.enabled === true,
    maxEntries:
      typeof maxEntries === 'number' && Number.isInteger(maxEntries) && maxEntries > 0
        ? Math.min(maxEntries, 500)
        : 20,
    maxAge: typeof maxAge === 'number' && Number.isFinite(maxAge) && maxAge >= 0 ? maxAge : 30_000,
    exclude: options?.exclude ?? [],
  }
}

function resolvePrefetchOptions(
  options: BoostOptions['prefetch'],
): ResolvedBoostOptions['prefetch'] {
  const strategy = options?.strategy ?? 'hover'
  const strategies = Array.isArray(strategy) ? strategy : [strategy]
  const delay = options?.delay
  const maxConcurrent = options?.maxConcurrent
  return {
    enabled: options?.enabled === true,
    strategy: strategies.filter(
      (item): item is 'hover' | 'pointerdown' | 'viewport' =>
        item === 'hover' || item === 'pointerdown' || item === 'viewport',
    ),
    delay: typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : 100,
    maxConcurrent:
      typeof maxConcurrent === 'number' && Number.isInteger(maxConcurrent) && maxConcurrent > 0
        ? Math.min(maxConcurrent, 8)
        : 2,
    exclude: options?.exclude ?? [],
  }
}

export function resolveOptions(options: BoostOptions): ResolvedBoostOptions {
  const target = options.target ?? 'body'
  const maxResponseBytes =
    typeof options.maxResponseBytes === 'number' &&
    Number.isFinite(options.maxResponseBytes) &&
    options.maxResponseBytes >= 0
      ? options.maxResponseBytes
      : DEFAULT_MAX_RESPONSE_BYTES
  if (options.swapStrategy === 'morph' && !options.morphAdapter && !options.swapHandler) {
    throw new TypeError('swapStrategy "morph" requires a morphAdapter or swapHandler')
  }
  const resolveTarget = (ownerDocument: Document = document): Element | null => {
    if (typeof target === 'function') {
      const resolved = target(ownerDocument)
      // Preserve the original zero-argument callback contract: its returned
      // live target receives response body children unless it adopts the new API.
      if (
        ownerDocument !== document &&
        target.length === 0 &&
        resolved?.ownerDocument !== ownerDocument
      ) {
        return ownerDocument.body
      }
      return resolved
    }
    return ownerDocument.querySelector(target)
  }
  return {
    scope: options.scope ?? '[data-boost="true"]',
    linkSelector: options.linkSelector ?? 'a[href]',
    formSelector: options.formSelector ?? 'form',
    target: resolveTarget,
    swapStrategy: options.swapStrategy ?? 'replace',
    morphAdapter: options.morphAdapter,
    swapHandler: options.swapHandler,
    scriptHandler: options.scriptHandler,
    head: options.head ?? 'title',
    createHTML: options.createHTML,
    history: options.history ?? true,
    scroll: options.scroll ?? true,
    focus:
      options.focus === false ? false : typeof options.focus === 'string' ? options.focus : 'auto',
    announce: options.announce ?? true,
    executeScripts: false,
    nonce: typeof options.nonce === 'string' ? options.nonce : '',
    maxResponseBytes,
    requestTimeoutMs:
      typeof options.requestTimeoutMs === 'number' &&
      Number.isFinite(options.requestTimeoutMs) &&
      options.requestTimeoutMs >= 0
        ? options.requestTimeoutMs
        : 0,
    fallbackToNativeForm: options.fallbackToNativeForm === true,
    progress:
      options.progress === false
        ? false
        : typeof options.progress === 'object'
          ? options.progress
          : {},
    headers: options.headers ?? {},
    prefetch: resolvePrefetchOptions(options.prefetch),
    cache: resolveCacheOptions(options.cache),
  }
}
