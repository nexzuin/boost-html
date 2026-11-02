import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/boost'

function html(body: string): Response {
  return new Response(
    `<!doctype html><html><head><title>Page</title></head><body>${body}</body></html>`,
    {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  )
}

describe('core lifecycle', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const instances: ReturnType<typeof createBoost>[] = []

  beforeEach(() => {
    document.body.innerHTML = '<main data-boost="true"><a href="/next">Next</a></main>'
    history.replaceState({}, '', '/start')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    for (const instance of instances.splice(0)) instance.stop()
    vi.unstubAllGlobals()
  })

  it('keeps repeated start and stop calls idempotent and supports restarting', async () => {
    const boost = createBoost({ progress: false })
    instances.push(boost)
    boost.start().start()
    fetchMock.mockResolvedValue(html('<h1>First</h1>'))

    const firstClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('a')?.dispatchEvent(firstClick)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('First'))

    document.body.innerHTML = '<main data-boost="true"><a href="/next">Next</a></main>'
    boost.stop().stop()
    const stoppedClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('a')?.dispatchEvent(stoppedClick)
    expect(stoppedClick.defaultPrevented).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    boost.start()
    fetchMock.mockResolvedValue(html('<h1>Again</h1>'))
    const restartedClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('a')?.dispatchEvent(restartedClick)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Again'))
    boost.stop()
  })

  it('cancels older concurrent navigations and never commits their stale response', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/first')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(html('<h1>Newer page</h1>'))
    })

    const boost = createBoost({ progress: false })
    instances.push(boost)
    const first = boost.navigate('/first')
    await vi.waitFor(() => expect(resolveFirst).toBeDefined())
    const second = boost.navigate('/second')

    await expect(second).resolves.toBe(true)
    resolveFirst?.(html('<h1>Stale page</h1>'))
    await expect(first).resolves.toBe(false)
    expect(document.querySelector('h1')?.textContent).toBe('Newer page')
    boost.stop()
  })

  it('ignores an obsolete header-provider failure after a newer navigation takes ownership', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    let call = 0
    const boost = createBoost({
      progress: false,
      headers: () => {
        call += 1
        return call === 1
          ? new Promise<Record<string, string>>((_resolve, reject) => {
              rejectFirst = reject
            })
          : Promise.resolve({})
      },
    })
    instances.push(boost)

    const first = boost.navigate('/first')
    await vi.waitFor(() => expect(rejectFirst).toBeDefined())
    fetchMock.mockResolvedValue(html('<h1>Current page</h1>'))
    const second = boost.navigate('/second')
    await expect(second).resolves.toBe(true)

    rejectFirst?.(new Error('obsolete headers failed'))
    await expect(first).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector('h1')?.textContent).toBe('Current page')
    boost.stop()
  })

  it('removes delegated listeners and aborts active requests on stop', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init.signal ?? undefined
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    )
    const boost = createBoost({ progress: false })
    instances.push(boost)
    boost.start()

    const navigation = boost.navigate('/pending')
    await vi.waitFor(() => expect(signal).toBeDefined())
    boost.stop()
    expect(signal?.aborted).toBe(true)
    await expect(navigation).resolves.toBe(false)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('a')?.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
