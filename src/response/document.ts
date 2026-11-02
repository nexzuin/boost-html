import { ResponseTooLargeError } from './errors'

export function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')
  return (
    contentType !== null && /^\s*(text\/html|application\/xhtml\+xml)\s*(?:;|$)/i.test(contentType)
  )
}

export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (maxBytes > 0) {
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxBytes)
      throw new ResponseTooLargeError(maxBytes)
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
      /* may already be released */
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
