export interface RequestInput {
  url: string
  method: string
  body: BodyInit | null
  headers: Record<string, string>
  signal: AbortSignal
}
export function sendRequest(input: RequestInput): Promise<Response> {
  return fetch(input.url, {
    method: input.method,
    body: input.method === 'GET' || input.method === 'HEAD' ? null : input.body,
    headers: input.headers,
    credentials: 'same-origin',
    redirect: 'follow',
    signal: input.signal,
  })
}
