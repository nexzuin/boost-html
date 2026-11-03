import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/core'
import { createProgress } from '../src/progress/progress'
import type { DOMUpdateContext, MorphAdapter } from '../src/types'

const html = (body: string, head = '') =>
  `<!doctype html><html><head><title>Response title</title>${head}</head><body>${body}</body></html>`

function response(body: string, head = ''): Response {
  return new Response(html(body, head), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

describe('DOM Engine', () => {
  let boost: ReturnType<typeof createBoost>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML =
      '<nav id="persistent">Persistent</nav><main id="content"><p>Old content</p></main>'
    document.title = 'Initial title'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    boost = createBoost({ progress: false, scroll: false })
  })

  afterEach(() => {
    boost.stop()
    vi.unstubAllGlobals()
  })

  it('replaces body children using the native default strategy', async () => {
    fetchMock.mockResolvedValue(response('<h1>New body</h1>'))
    const navigation = await boost.navigate('/body')
    expect(navigation).toBe(true)
    expect(document.querySelector('h1')?.textContent).toBe('New body')
    expect(document.querySelector('#persistent')).toBeNull()
    expect(document.title).toBe('Response title')
    expect(boost.options.swapStrategy).toBe('replace')
  })

  it('replaces only a configured partial target', async () => {
    document.body.innerHTML =
      '<nav id="persistent">Persistent</nav><main id="content"><p>Old</p></main>'
    boost = createBoost({ progress: false, scroll: false, target: '#content' })
    fetchMock.mockResolvedValue(response('<main id="content"><h2>Partial response</h2></main>'))
    await expect(boost.navigate('/partial')).resolves.toBe(true)
    expect(document.querySelector('#persistent')?.textContent).toBe('Persistent')
    expect(document.querySelector('#content')?.innerHTML).toContain('<h2>Partial response</h2>')
  })

  it('fails before fetching when the live target is missing', async () => {
    document.body.innerHTML = '<main id="other">Current</main>'
    boost = createBoost({ progress: false, scroll: false, target: '#content' })
    const fallback = vi
      .spyOn(boost as unknown as { fallback: (...args: unknown[]) => void }, 'fallback')
      .mockImplementation(() => {})
    await expect(boost.navigate('/live-missing')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalled()
  })

  it('fails safely when the configured response target is missing', async () => {
    document.body.innerHTML = '<main id="content">Current</main>'
    boost = createBoost({ progress: false, scroll: false, target: '#content' })
    fetchMock.mockResolvedValue(response('<main id="other">Wrong target</main>'))
    const fallback = vi
      .spyOn(boost as unknown as { fallback: (...args: unknown[]) => void }, 'fallback')
      .mockImplementation(() => {})
    await expect(boost.navigate('/missing')).resolves.toBe(false)
    expect(document.querySelector('#content')?.textContent).toBe('Current')
    expect(fallback).toHaveBeenCalled()
  })

  it('supports a document-aware target callback', async () => {
    document.body.innerHTML = '<section id="slot">Before</section>'
    boost = createBoost({
      progress: false,
      scroll: false,
      target: (ownerDocument) => ownerDocument?.querySelector('#slot') ?? null,
    })
    fetchMock.mockResolvedValue(response('<section id="slot">After</section>'))
    await expect(boost.navigate('/callback')).resolves.toBe(true)
    expect(document.querySelector('#slot')?.textContent).toBe('After')
  })

  it('supports a custom synchronous swap handler', async () => {
    const handler = vi.fn(({ target, incoming }: DOMUpdateContext) => {
      target.textContent = incoming.textContent
    })
    boost = createBoost({
      progress: false,
      scroll: false,
      target: '#content',
      swapHandler: handler,
    })
    fetchMock.mockResolvedValue(response('<main id="content"><b>Custom</b></main>'))
    await expect(boost.navigate('/custom')).resolves.toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(document.querySelector('#content')?.textContent).toBe('Custom')
  })

  it('uses an injected morph adapter only when requested', async () => {
    const adapter: MorphAdapter = {
      morph: vi.fn((target, incoming) => {
        target.replaceChildren(...Array.from(incoming.childNodes))
      }),
    }
    boost = createBoost({
      progress: false,
      scroll: false,
      target: '#content',
      swapStrategy: 'morph',
      morphAdapter: adapter,
    })
    fetchMock.mockResolvedValue(response('<main id="content"><strong>Morphed</strong></main>'))
    await expect(boost.navigate('/morph')).resolves.toBe(true)
    expect(adapter.morph).toHaveBeenCalledTimes(1)
    expect(document.querySelector('#content')?.textContent).toBe('Morphed')
  })

  it('rejects morph mode without an adapter', () => {
    expect(() => createBoost({ swapStrategy: 'morph' })).toThrow(/requires a morphAdapter/)
  })

  it('dispatches DOM lifecycle events in order', async () => {
    fetchMock.mockResolvedValue(response('<main id="content">Lifecycle</main>'))
    const events: string[] = []
    const names = [
      'boost:before-swap',
      'boost:before-dom-update',
      'boost:after-dom-update',
      'boost:after-swap',
    ]
    const listeners = names.map((name) => {
      const listener = () => events.push(name)
      document.addEventListener(name, listener)
      return [name, listener] as const
    })
    await boost.navigate('/events')
    for (const [name, listener] of listeners) document.removeEventListener(name, listener)
    expect(events).toEqual(names)
  })

  it('allows the DOM update to be canceled before any mutation', async () => {
    fetchMock.mockResolvedValue(response('<h1>Should not appear</h1>'))
    const cancel = (event: Event) => event.preventDefault()
    document.addEventListener('boost:before-dom-update', cancel)
    await expect(boost.navigate('/cancel-dom')).resolves.toBe(false)
    document.removeEventListener('boost:before-dom-update', cancel)
    expect(document.querySelector('#persistent')?.textContent).toBe('Persistent')
    expect(document.querySelector('h1')).toBeNull()
  })

  it('updates only allowlisted metadata and preserves security-sensitive head entries', async () => {
    document.head.innerHTML =
      '<meta name="description" content="Old"><meta http-equiv="Content-Security-Policy" content="default-src none">'
    boost = createBoost({ progress: false, scroll: false, head: 'metadata' })
    fetchMock.mockResolvedValue(
      response(
        '<h1>Metadata</h1>',
        '<meta name="description" content="New"><meta name="viewport" content="width=device-width">',
      ),
    )
    await expect(boost.navigate('/metadata')).resolves.toBe(true)
    expect(document.title).toBe('Response title')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'New',
    )
    expect(document.head.querySelector('meta[name="viewport"]')).toBeNull()
    expect(document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull()
  })

  it('can preserve all current head fields', async () => {
    document.title = 'Keep title'
    boost = createBoost({ progress: false, scroll: false, head: false })
    fetchMock.mockResolvedValue(response('<h1>Body</h1>'))
    await boost.navigate('/no-head')
    expect(document.title).toBe('Keep title')
  })

  it('recovers malformed HTML through the browser parser without throwing', async () => {
    fetchMock.mockResolvedValue(response('<main id="content"><p><strong>Recovered</main>'))
    await expect(boost.navigate('/malformed')).resolves.toBe(true)
    expect(document.querySelector('#content strong')?.textContent).toBe('Recovered')
  })

  it('removes scripts, inline handlers, and javascript URLs from response descendants', async () => {
    fetchMock.mockResolvedValue(
      response(
        '<main id="content"><button onclick="alert(1)">Click</button><a href="javascript:alert(1)">Bad</a><a href="&#x6a;avascript:alert(1)">Encoded</a><a href="java&Tab;script:alert(1)">Whitespace encoded</a><svg><a xlink:href="javascript:alert(1)">SVG</a></svg><iframe srcdoc="<script>alert(1)</script>"></iframe><script src="/evil.js"></script></main>',
      ),
    )
    boost = createBoost({ progress: false, scroll: false, target: '#content' })
    await expect(boost.navigate('/untrusted')).resolves.toBe(true)
    expect(document.querySelector('button')?.hasAttribute('onclick')).toBe(false)
    const anchors = document.querySelectorAll('a')
    expect(anchors[0]?.getAttribute('href')).toBeNull()
    expect(anchors[1]?.getAttribute('href')).toBeNull()
    expect(anchors[2]?.getAttribute('href')).toBeNull()
    expect(document.querySelector('svg a')?.getAttribute('xlink:href')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('script[src="/evil.js"]')).toBeNull()
  })

  it('removes embedded browsing contexts, CSS injection surfaces, and unsafe resource URLs', async () => {
    fetchMock.mockResolvedValue(
      response(
        '<main id="content"><iframe src="/frame"></iframe><object data="data:text/html,<script>alert(1)</script>"></object><embed src="https://evil.example/embed"><style>body{background:url(https://evil.example/track)}</style><a href="data:text/html,<script>alert(1)</script>">Data URL</a><img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=" srcset="https://evil.example/a 1x" style="background:url(https://evil.example/x)" onfocus="alert(1)"><form action="javascript:alert(1)"><button formaction="vbscript:msgbox(1)">Submit</button></form><a href="mailto:support@example.com">Mail</a><img src="data:image/png;base64,aGVsbG8=" alt="pixel"></main>',
      ),
    )
    boost = createBoost({ progress: false, scroll: false, target: '#content' })

    await expect(boost.navigate('/active-content')).resolves.toBe(true)

    expect(document.querySelector('iframe,object,embed,style')).toBeNull()
    expect(document.querySelector('a[href^="data:"]')).toBeNull()
    expect(document.querySelector('img')?.hasAttribute('srcset')).toBe(false)
    expect(document.querySelector('img')?.hasAttribute('style')).toBe(false)
    expect(document.querySelector('img')?.hasAttribute('onfocus')).toBe(false)
    expect(document.querySelector('form')?.hasAttribute('action')).toBe(false)
    expect(document.querySelector('button')?.hasAttribute('formaction')).toBe(false)
    expect(document.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toBe(
      'mailto:support@example.com',
    )
    expect(document.querySelector('img[alt="pixel"]')?.getAttribute('src')).toBe(
      'data:image/png;base64,aGVsbG8=',
    )
  })

  it('filters entity-obfuscated URL schemes even without other active markup', async () => {
    fetchMock.mockResolvedValue(
      response('<main id="content"><a href="java&Tab;script:alert(1)">Unsafe</a></main>'),
    )
    boost = createBoost({ progress: false, scroll: false, target: '#content' })

    await expect(boost.navigate('/obfuscated-url')).resolves.toBe(true)

    expect(document.querySelector('#content a')?.getAttribute('href')).toBeNull()
  })

  it('does not leave replaced descendant listeners attached to live DOM', async () => {
    const oldButton = document.createElement('button')
    oldButton.id = 'old'
    document.querySelector('#content')?.replaceChildren(oldButton)
    fetchMock.mockResolvedValue(response('<main id="content"><button id="new">New</button></main>'))
    boost = createBoost({ progress: false, scroll: false, target: '#content' })
    await boost.navigate('/listeners')
    const documentListener = vi.fn()
    document.addEventListener('click', documentListener)
    oldButton.click()
    document.removeEventListener('click', documentListener)
    expect(documentListener).not.toHaveBeenCalled()
    expect(oldButton.isConnected).toBe(false)
  })

  it('sanitizes active markup when the configured target is the document head', async () => {
    boost = createBoost({ progress: false, scroll: false, target: 'head' })
    fetchMock.mockResolvedValue(
      response(
        '<h1>Body</h1>',
        '<title>Safe</title><script>window.headInjected = true</script><meta name="description" content="safe">',
      ),
    )

    await expect(boost.navigate('/head-target')).resolves.toBe(true)

    expect(document.head.querySelector('script')).toBeNull()
    expect((window as Window & { headInjected?: boolean }).headInjected).toBeUndefined()
  })

  it('reports explicit script-handler failures through boost:error', async () => {
    const failure = new Error('application script policy rejected the response')
    const handler = vi.fn().mockRejectedValue(failure)
    const onError = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    boost = createBoost({ progress: false, scroll: false, scriptHandler: handler })
    document.addEventListener('boost:error', onError)
    fetchMock.mockResolvedValue(response('<main><script>throw new Error("no")</script></main>'))

    await expect(boost.navigate('/script-handler-error')).resolves.toBe(true)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())

    expect((onError.mock.calls[0]![0] as CustomEvent).detail.error).toBe(failure)
    document.removeEventListener('boost:error', onError)
    consoleError.mockRestore()
  })

  it('uses the supplied Trusted Types hook before parsing', async () => {
    const createHTML = vi.fn((value: string) => value)
    boost = createBoost({ progress: false, scroll: false, createHTML })
    fetchMock.mockResolvedValue(response('<h1>Trusted hook</h1>'))
    await expect(boost.navigate('/trusted')).resolves.toBe(true)
    expect(createHTML).toHaveBeenCalledTimes(1)
  })
})

it('filters scripts and executable attributes inside nested templates', async () => {
  document.body.innerHTML = '<main id="content">Before</main>'
  const scriptHandler = vi.fn()
  const localFetch = vi
    .fn()
    .mockResolvedValue(
      response(
        '<main id="content"><template><button oncustom="alert(1)">Template</button><script>window.templateScript = true</script></template></main>',
      ),
    )
  vi.stubGlobal('fetch', localFetch)
  const localBoost = createBoost({
    progress: false,
    scroll: false,
    target: '#content',
    scriptHandler,
  })
  await expect(localBoost.navigate('/template')).resolves.toBe(true)
  const template = document.querySelector('template') as HTMLTemplateElement
  expect(template.content.querySelector('button')?.hasAttribute('oncustom')).toBe(false)
  expect(template.content.querySelector('script')).toBeNull()
  expect(scriptHandler).toHaveBeenCalledTimes(1)
  expect((window as Window & { templateScript?: boolean }).templateScript).toBeUndefined()
  localBoost.stop()
  vi.unstubAllGlobals()
})

describe('progress template security', () => {
  afterEach(() => {
    document.querySelector('.boost-html-progress')?.remove()
    document.querySelector('#boost-html-progress-style')?.remove()
  })

  it('parses custom templates through the Trusted Types hook and strips active markup', () => {
    const createHTML = vi.fn((value: string) => value)
    const progress = createProgress(
      {
        template:
          '<div id="nprogress" onclick="alert(1)"><div class="bar"></div><iframe src="/evil"></iframe><script>alert(1)</script><a href="javascript:alert(1)">x</a></div>',
        showSpinner: false,
        trickle: false,
      },
      '',
      createHTML,
    )

    progress.start()
    const root = document.querySelector('#nprogress')
    expect(createHTML).toHaveBeenCalledOnce()
    expect(root?.hasAttribute('onclick')).toBe(false)
    expect(root?.querySelector('iframe,script')).toBeNull()
    expect(root?.querySelector('a')?.hasAttribute('href')).toBe(false)
    progress.done()
  })
})
