export function scrollToTop(): void {
  try {
    window.scrollTo(0, 0)
  } catch {
    /* unavailable in some environments */
  }
}

export function scrollToPosition(y: number): void {
  if (!Number.isFinite(y) || y < 0) return
  try {
    window.scrollTo(0, y)
  } catch {
    /* unavailable in some environments */
  }
}

export function scrollToHash(hash: string): boolean {
  let id: string
  try {
    id = decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    id = hash.replace(/^#/, '')
  }
  if (!id) return false
  const element = document.getElementById(id) ?? document.getElementsByName(id)[0]
  if (!element) return false
  try {
    element.scrollIntoView({ block: 'start' })
  } catch {
    try {
      element.scrollIntoView()
    } catch {
      /* unavailable in some environments */
    }
  }
  return true
}
