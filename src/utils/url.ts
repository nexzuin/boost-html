export function resolveUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base ?? document.baseURI)
  } catch {
    return null
  }
}

export function withRequestedHash(finalUrl: string, requested: URL): string {
  if (!requested.hash) return finalUrl
  try {
    const url = new URL(finalUrl)
    if (!url.hash && url.pathname === requested.pathname && url.search === requested.search) {
      url.hash = requested.hash
      return url.href
    }
  } catch {
    /* keep response URL as-is */
  }
  return finalUrl
}
