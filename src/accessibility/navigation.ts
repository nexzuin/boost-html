const ANNOUNCEMENT_ID = 'boost-html-navigation-announcement'

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    return hash.replace(/^#/, '')
  }
}

function getAnnouncementRegion(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  let region = document.getElementById(ANNOUNCEMENT_ID) as HTMLElement | null
  if (!region) {
    region = document.createElement('div')
    region.id = ANNOUNCEMENT_ID
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.setAttribute('aria-atomic', 'true')
    region.setAttribute('data-boost-ignore', '')
    Object.assign(region.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    })
    document.body.append(region)
  }
  return region
}

export function removeAnnouncementRegion(): void {
  if (typeof document !== 'undefined') document.getElementById(ANNOUNCEMENT_ID)?.remove()
}

export function announceNavigation(title = document.title): void {
  const region = getAnnouncementRegion()
  if (!region) return
  region.textContent = ''
  queueMicrotask(() => {
    if (region.isConnected) region.textContent = title ? `Navigated to ${title}` : 'Page updated'
  })
}

export function focusAfterNavigation(
  target: Element,
  selector: string | false,
  focusId?: string | null,
  hash?: string,
): void {
  if (selector === false || typeof document === 'undefined') return
  const active = document.activeElement
  const hashId = hash ? decodeHash(hash) : ''
  const hashTarget = hashId
    ? (document.getElementById(hashId) ?? document.getElementsByName(hashId)[0])
    : null
  if (
    !focusId &&
    !hashTarget &&
    active &&
    active !== document.body &&
    active !== document.documentElement &&
    active.isConnected
  ) {
    return
  }
  let configuredTarget: Element | null = null
  if (selector === 'auto')
    configuredTarget = target.querySelector('main, [role="main"], h1') ?? target
  else if (selector === 'target') configuredTarget = target
  else {
    try {
      configuredTarget = document.querySelector(selector)
    } catch {
      configuredTarget = target
    }
  }
  const candidate =
    (focusId ? document.getElementById(focusId) : null) ?? hashTarget ?? configuredTarget ?? target
  if (!(candidate instanceof HTMLElement)) return

  const hadTabindex = candidate.hasAttribute('tabindex')
  if (!hadTabindex && !candidate.matches('a[href], button, input, select, textarea, [tabindex]')) {
    candidate.setAttribute('tabindex', '-1')
  }
  try {
    candidate.focus({ preventScroll: true })
  } catch {
    candidate.focus()
  }
  if (!hadTabindex && candidate.getAttribute('tabindex') === '-1') {
    candidate.addEventListener('blur', () => candidate.removeAttribute('tabindex'), { once: true })
  }
}
