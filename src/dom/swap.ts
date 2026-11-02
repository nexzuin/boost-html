import { resolveUrl } from '../utils/url'

const SCRIPT_LOAD_TIMEOUT = 5000
export function collectScriptSources(doc: Document, baseUrl: string): Set<string> {
  const sources = new Set<string>()
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src')
    if (src) sources.add(resolveUrl(src, baseUrl)?.href ?? src)
  }
  return sources
}
export interface ScriptPlaceholder {
  marker: Comment
  script: HTMLScriptElement
}
export function replaceContent(target: Element, doc: Document): ScriptPlaceholder[] {
  const body = doc.body
  const placeholders: ScriptPlaceholder[] = []
  if (!body) {
    target.replaceChildren()
    return placeholders
  }
  for (const script of Array.from(body.querySelectorAll('script'))) {
    const marker = doc.createComment('boost-html-script')
    script.replaceWith(marker)
    placeholders.push({ marker, script })
  }
  const fragment = doc.createDocumentFragment()
  while (body.firstChild) fragment.appendChild(body.firstChild)
  target.replaceChildren(fragment)
  return placeholders
}
export function dropScripts(placeholders: ScriptPlaceholder[]): void {
  for (const { marker } of placeholders) marker.remove()
}
export async function executeScripts(
  placeholders: ScriptPlaceholder[],
  alreadyLoaded: Set<string>,
  baseUrl: string,
  nonce?: string,
): Promise<void> {
  for (const { marker, script } of placeholders)
    await executeScript(marker, script, alreadyLoaded, baseUrl, nonce)
}
async function executeScript(
  marker: Comment,
  source: HTMLScriptElement,
  alreadyLoaded: Set<string>,
  baseUrl: string,
  nonce?: string,
): Promise<void> {
  const src = source.getAttribute('src')
  if (src) {
    const absoluteSrc = resolveUrl(src, baseUrl)?.href ?? src
    if (alreadyLoaded.has(absoluteSrc)) {
      marker.remove()
      return
    }
    alreadyLoaded.add(absoluteSrc)
  }
  const replacement = document.createElement('script')
  for (const attribute of Array.from(source.attributes))
    replacement.setAttribute(attribute.name, attribute.value)
  if (nonce && !replacement.hasAttribute('nonce')) replacement.setAttribute('nonce', nonce)
  if (!src) {
    replacement.textContent = source.textContent ?? ''
    marker.replaceWith(replacement)
    return
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve()
    }
    replacement.addEventListener('load', finish, { once: true })
    replacement.addEventListener('error', finish, { once: true })
    timer = setTimeout(finish, SCRIPT_LOAD_TIMEOUT)
    try {
      marker.replaceWith(replacement)
    } catch (error) {
      finish()
      reject(error)
    }
  })
}
