import { ResponseTooLargeError } from './errors'

export function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')
  return (
    contentType !== null && /^\s*(text\/html|application\/xhtml\+xml)\s*(?:;|$)/i.test(contentType)
  )
}

function createDecoder(contentType: string | null): TextDecoder {
  const charset = /charset=([^;]+)/i
    .exec(contentType ?? '')?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '')
  try {
    return new TextDecoder(charset || 'utf-8')
  } catch {
    return new TextDecoder()
  }
}

/**
 * Read a bounded response body. Decode chunks as they arrive so the reader
 * does not retain every Uint8Array and then allocate/copy a second full buffer.
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
    if (maxBytes > 0 && new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ResponseTooLargeError(maxBytes)
    }
    return text
  }

  const reader = body.getReader()
  const decoder = createDecoder(response.headers.get('content-type'))
  const chunks: string[] = []
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
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* may already be released */
    }
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}
