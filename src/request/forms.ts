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
export function encodeUrlEncoded(formData: FormData): string {
  const params = new URLSearchParams()
  for (const [name, value] of formData) params.append(name, serializeValue(value))
  return params.toString()
}
export function encodeTextPlain(formData: FormData): string {
  let result = ''
  for (const [name, value] of formData) {
    result += `${normalizeLineEndings(name)}=${normalizeLineEndings(serializeValue(value))}\r\n`
  }
  return result
}
export function encodeFormBody(formData: FormData, enctype: string): EncodedFormBody {
  const normalized = enctype.trim().toLowerCase()
  if (normalized === 'multipart/form-data') return { body: formData }
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
