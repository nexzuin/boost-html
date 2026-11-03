export type HeadUpdateMode = 'title' | 'metadata' | false

export interface DOMUpdateContext {
  /** Existing live element that receives the update. */
  target: Element
  /** Matching element parsed from the validated response document. */
  incoming: Element
  /** The single DOMParser result for this navigation. */
  document: Document
  /** Final, validated same-origin response URL. */
  url: string
  response: Response
  /** Configured CSP nonce, available to explicit script handlers. */
  nonce: string
}

export interface MorphAdapter {
  /** Synchronously morph target using incoming. Implementations are optional. */
  morph(target: Element, incoming: Element, context: DOMUpdateContext): void
}

export type DOMSwapHandler = (context: DOMUpdateContext) => void
export type DOMScriptHandler = (
  scripts: readonly HTMLScriptElement[],
  context: DOMUpdateContext,
) => void | Promise<void>

export interface DOMEngineOptions {
  strategy: 'replace' | 'morph'
  morphAdapter?: MorphAdapter
  swapHandler?: DOMSwapHandler
}

const SAFE_META_NAMES = new Set([
  'description',
  'keywords',
  'author',
  'robots',
  'theme-color',
  'application-name',
  'color-scheme',
])
const SAFE_META_PROPERTIES = new Set([
  'og:title',
  'og:description',
  'og:type',
  'og:url',
  'og:image',
  'og:site_name',
])

function metadataKey(meta: HTMLMetaElement): string | null {
  const name = meta.getAttribute('name')?.trim().toLowerCase()
  if (name && SAFE_META_NAMES.has(name)) return `name:${name}`
  const property = meta.getAttribute('property')?.trim().toLowerCase()
  if (property && SAFE_META_PROPERTIES.has(property)) return `property:${property}`
  return null
}

/**
 * Synchronize only a conservative allowlist of descriptive metadata.
 * Security-sensitive http-equiv, charset, base, link, style and script nodes
 * are deliberately excluded.
 */
export function updateDocumentHead(
  current: Document,
  incoming: Document,
  mode: HeadUpdateMode,
): void {
  if (mode === false) return
  if ((mode === 'title' || mode === 'metadata') && incoming.title) {
    current.title = incoming.title
  }

  if (mode !== 'metadata') return

  const existing = new Map<string, HTMLMetaElement>()
  for (const meta of current.head.querySelectorAll('meta')) {
    const key = metadataKey(meta)
    if (key) existing.set(key, meta)
  }

  const retained = new Set<string>()
  for (const meta of incoming.head.querySelectorAll('meta')) {
    const key = metadataKey(meta)
    const content = meta.getAttribute('content')
    if (!key || content === null) continue

    retained.add(key)
    const currentMeta = existing.get(key)
    if (currentMeta) {
      if (currentMeta.getAttribute('content') !== content) {
        currentMeta.setAttribute('content', content)
      }
      continue
    }

    const next = current.createElement('meta')
    if (key.startsWith('name:')) next.setAttribute('name', key.slice(5))
    else next.setAttribute('property', key.slice(9))
    next.setAttribute('content', content)
    current.head.appendChild(next)
  }

  for (const [key, meta] of existing) {
    if (!retained.has(key)) meta.remove()
  }
}

const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'data',
])
const ACTIVE_CONTENT_SELECTOR =
  'script,template,[srcdoc],[href],[src],[xlink\\:href],[action],[formaction],[poster],[data]'
const ACTIVE_BODY_MARKUP =
  /<script\b|<template\b|\ssrcdoc\b|\son[a-z][\w-]*(?=\s|=|>)|\b(?:href|src|xlink:href|action|formaction|poster|data)\s*=\s*(?:"[^"]*(?:javascript|vbscript|&#|&[a-z][a-z0-9]+;|\s)[^"]*"|'[^']*(?:javascript|vbscript|&#|&[a-z][a-z0-9]+;|\s)[^']*'|[^\s>]*(?:javascript|vbscript|&#|&[a-z][a-z0-9]+;|\s)[^\s>]*)/i
const EVENT_ATTRIBUTE_PATTERN = /\s(on[a-z][a-z0-9-]*)(?=\s|=|>)/gi

function getActiveBodyMarkup(sourceHTML: string): string | null {
  // Ignore scripts in <head>; only the target subtree is inserted. Deliberately
  // scan to EOF rather than looking for </body>, which may occur in comments or
  // script strings. Entity-bearing URL attributes are conservatively inspected.
  const bodyStart = /<body\b[^>]*>/i.exec(sourceHTML)
  const bodyMarkup = bodyStart
    ? sourceHTML.slice(bodyStart.index + bodyStart[0].length)
    : sourceHTML
  return ACTIVE_BODY_MARKUP.test(bodyMarkup) ? bodyMarkup : null
}

/**
 * Filter only response subtrees that contain potentially active markup. The
 * source pre-check avoids traversing large, ordinary documents with no scripts
 * or executable attributes. Template contents are visited recursively.
 */
function extractScriptsAndFilter(
  incoming: Element,
  baseUrl: string,
  bodyMarkup: string,
): HTMLScriptElement[] {
  const scripts: HTMLScriptElement[] = []
  const eventSelectors = new Set<string>()
  for (const match of bodyMarkup.matchAll(EVENT_ATTRIBUTE_PATTERN)) {
    if (match[1]) eventSelectors.add(`[${match[1].toLowerCase()}]`)
  }
  const selector = eventSelectors.size
    ? `${ACTIVE_CONTENT_SELECTOR},${Array.from(eventSelectors).join(',')}`
    : ACTIVE_CONTENT_SELECTOR

  const visit = (root: ParentNode): void => {
    for (const element of root.querySelectorAll(selector)) {
      if (element.localName === 'script') {
        scripts.push(element as HTMLScriptElement)
        continue
      }

      for (let index = element.attributes.length - 1; index >= 0; index--) {
        const attribute = element.attributes.item(index)
        if (!attribute) continue
        const name = attribute.name.toLowerCase()
        if (name.startsWith('on') || name === 'srcdoc') {
          element.removeAttribute(attribute.name)
          continue
        }
        if (!URL_ATTRIBUTES.has(name)) continue

        const first = attribute.value.trimStart()[0]?.toLowerCase()
        if (first !== 'j' && first !== 'v') continue
        try {
          const protocol = new URL(attribute.value, baseUrl).protocol.toLowerCase()
          if (protocol === 'javascript:' || protocol === 'vbscript:') {
            element.removeAttribute(attribute.name)
          }
        } catch {
          element.removeAttribute(attribute.name)
        }
      }

      if (element.localName === 'template') {
        visit((element as HTMLTemplateElement).content)
      }
    }
  }
  visit(incoming)
  for (const script of scripts) script.remove()
  return scripts
}

/**
 * Native replacement strategy. Moving the parsed nodes avoids serializing and
 * reparsing HTML; replaceChildren also releases the replaced subtree/listeners.
 */
export function replaceTargetChildren(target: Element, incoming: Element): void {
  const fragment = target.ownerDocument.createDocumentFragment()
  while (incoming.firstChild) fragment.appendChild(incoming.firstChild)
  target.replaceChildren(fragment)
}

/** Apply one DOM update after the response and both target elements are validated. */
export function updateDOM(
  context: DOMUpdateContext,
  options: DOMEngineOptions,
  sourceHTML: string,
): readonly HTMLScriptElement[] {
  const bodyMarkup = getActiveBodyMarkup(sourceHTML)
  const scripts = bodyMarkup
    ? extractScriptsAndFilter(context.incoming, context.url, bodyMarkup)
    : []

  if (options.swapHandler) {
    options.swapHandler(context)
  } else if (options.strategy === 'morph') {
    if (!options.morphAdapter) {
      throw new Error('The morph strategy requires a morphAdapter')
    }
    options.morphAdapter.morph(context.target, context.incoming, context)
  } else {
    replaceTargetChildren(context.target, context.incoming)
  }

  return scripts
}

/** Invoke only an explicitly supplied script handler; scripts are inert otherwise. */
export function handleResponseScripts(
  scripts: readonly HTMLScriptElement[],
  context: DOMUpdateContext,
  handler?: DOMScriptHandler,
): void | Promise<void> {
  if (scripts.length === 0 || !handler) return
  return handler(scripts, context)
}
