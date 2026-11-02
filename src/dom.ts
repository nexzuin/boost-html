const SCRIPT_LOAD_TIMEOUT = 5000

export function resolveUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base ?? document.baseURI)
  } catch {
    return null
  }
}

export function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')
  if (!contentType) return false
  return /^\s*(text\/html|application\/xhtml\+xml)\s*(?:;|$)/i.test(contentType)
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeds the ${maxBytes} byte limit`)
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * Read the response body as text, enforcing a byte budget while streaming.
 * Falls back to `response.text()` for environments without a readable body.
 */
export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (maxBytes > 0) {
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new ResponseTooLargeError(maxBytes)
    }
  }

  const body = response.body
  if (maxBytes <= 0 || !body || typeof body.getReader !== 'function') {
    const text = await response.text()
    if (maxBytes > 0 && text.length > maxBytes) throw new ResponseTooLargeError(maxBytes)
    return text
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new ResponseTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* the reader may already be released after cancel */
    }
  }

  return decodeBytes(chunks, total, response.headers.get('content-type'))
}

function decodeBytes(chunks: Uint8Array[], total: number, contentType: string | null): string {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  const charset = /charset=([^;]+)/i
    .exec(contentType ?? '')?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '')
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

/** Snapshot the scripts already present in a document so they are not re-run. */
export function collectScriptSources(doc: Document, baseUrl: string): Set<string> {
  const sources = new Set<string>()
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src')
    if (!src) continue
    sources.add(resolveUrl(src, baseUrl)?.href ?? src)
  }
  return sources
}

export interface ScriptPlaceholder {
  /** Comment left in the swapped DOM where the script used to be. */
  marker: Comment
  /** Detached script element from the parsed response document. */
  script: HTMLScriptElement
}

/**
 * Replace the target's children with the parsed response body without
 * serializing/re-parsing HTML. Scripts are replaced by comments so they never
 * execute accidentally; callers decide whether to run them.
 */
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

/** Remove placeholders when script execution is disabled. */
export function dropScripts(placeholders: ScriptPlaceholder[]): void {
  for (const { marker } of placeholders) marker.remove()
}

/**
 * Re-create every script at its original position. External scripts that were
 * already loaded are skipped.
 */
export async function executeScripts(
  placeholders: ScriptPlaceholder[],
  alreadyLoaded: Set<string>,
  baseUrl: string,
  nonce?: string,
): Promise<void> {
  for (const { marker, script } of placeholders) {
    await executeScript(marker, script, alreadyLoaded, baseUrl, nonce)
  }
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
  for (const attribute of Array.from(source.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value)
  }
  if (nonce && !replacement.hasAttribute('nonce')) {
    replacement.setAttribute('nonce', nonce)
  }

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

export interface EncodedFormBody {
  body: BodyInit
  headers?: Record<string, string>
}

function serializeValue(value: FormDataEntryValue): string {
  return typeof value === 'string' ? value : value.name
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n')
}

/** Encode multipart form data as `application/x-www-form-urlencoded`. */
export function encodeUrlEncoded(formData: FormData): string {
  const params = new URLSearchParams()
  for (const [name, value] of formData) {
    params.append(name, serializeValue(value))
  }
  return params.toString()
}

/** Encode multipart form data as `text/plain` (native form semantics). */
export function encodeTextPlain(formData: FormData): string {
  let result = ''
  for (const [name, value] of formData) {
    result += `${normalizeLineEndings(name)}=${normalizeLineEndings(serializeValue(value))}\r\n`
  }
  return result
}

/** Honour the form/submitter `enctype`, falling back to urlencoded like browsers. */
export function encodeFormBody(formData: FormData, enctype: string): EncodedFormBody {
  const normalized = enctype.trim().toLowerCase()

  if (normalized === 'multipart/form-data') {
    return { body: formData }
  }
  if (normalized === 'text/plain') {
    return {
      body: encodeTextPlain(formData),
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }
  }

  return {
    body: encodeUrlEncoded(formData),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  }
}

export function scrollToTop(): void {
  try {
    window.scrollTo(0, 0)
  } catch {
    /* ignore environments without scrolling */
  }
}

export function scrollToPosition(y: number): void {
  try {
    window.scrollTo(0, y)
  } catch {
    /* ignore environments without scrolling */
  }
}

export function scrollToHash(hash: string): boolean {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!id) return false

  const element = document.getElementById(id) ?? document.getElementsByName(id)[0]
  if (!element) return false

  try {
    element.scrollIntoView({ block: 'start' })
  } catch {
    /* ignore environments without scrollIntoView */
  }
  return true
}
