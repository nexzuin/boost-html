export function dispatchEvent(type: string, detail: unknown, cancelable: boolean): boolean {
  if (typeof document === 'undefined') return true
  return document.dispatchEvent(new CustomEvent(type, { detail, cancelable, bubbles: true }))
}
