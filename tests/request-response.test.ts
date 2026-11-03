import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoost } from '../src/core'
import { ResponseTooLargeError, readResponseText } from '../src/dom'

const html =
  '<!doctype html><html><head><title>Response</title></head><body><h1>Loaded</h1></body></html>'

function response(status = 200, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(html, { status, headers: contentType ? { 'content-type': contentType } : {} })
}

describe('request and response pipeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([404, 500])('rejects HTTP %i without swapping the document', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(response(status))
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({ progress: false })
    const fallback = vi
      .spyOn(boost as unknown as { fallback: (...args: unknown[]) => void }, 'fallback')
      .mockImplementation(() => {})
    await expect(boost.navigate('/result')).resolves.toBe(false)
    expect(document.querySelector('h1')).toBeNull()
    expect(fallback).toHaveBeenCalled()
    boost.stop()
  })

  it('rejects invalid content types before parsing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, 'application/json'))
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({ progress: false })
    const fallback = vi
      .spyOn(boost as unknown as { fallback: (...args: unknown[]) => void }, 'fallback')
      .mockImplementation(() => {})
    await expect(boost.navigate('/json')).resolves.toBe(false)
    expect(fallback).toHaveBeenCalled()
    expect(document.querySelector('h1')).toBeNull()
    boost.stop()
  })

  it('decodes UTF-8 safely when multibyte characters cross stream chunks', async () => {
    const expected = 'Boost HTML 🌍 café'
    const bytes = new TextEncoder().encode(expected)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    })
    const body = new Response(stream, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

    await expect(readResponseText(body, bytes.byteLength)).resolves.toBe(expected)
  })

  it('enforces response limits using encoded byte length', async () => {
    const body = new Response('é', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

    await expect(readResponseText(body, 1)).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('falls back to UTF-8 for unsupported response charsets', async () => {
    const body = new Response('café', {
      headers: { 'content-type': 'text/html; charset=unsupported-charset' },
    })

    await expect(readResponseText(body, 100)).resolves.toBe('café')
  })

  it('passes custom headers to the native Fetch API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({ progress: false, headers: { 'X-App': 'test' } })
    await expect(boost.navigate('/result')).resolves.toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-App': 'test' })
    boost.stop()
  })

  it('aborts a request when the configured timeout elapses', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const boost = createBoost({ progress: false, requestTimeoutMs: 10 })
    const fallback = vi
      .spyOn(boost as unknown as { fallback: (...args: unknown[]) => void }, 'fallback')
      .mockImplementation(() => {})
    await expect(boost.navigate('/slow')).resolves.toBe(false)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(fallback).toHaveBeenCalled()
    boost.stop()
  })

  it('does not issue duplicate requests for a pending form submission', async () => {
    let resolveFetch!: (value: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML =
      '<main data-boost="true"><form action="/save" method="post"><input name="name" value="Ada"><button name="intent" value="save">Save</button></form></main>'
    const boost = createBoost({ progress: false })
    boost.start()
    const form = document.querySelector('form')!
    const fireSubmit = () =>
      form.dispatchEvent(
        new SubmitEvent('submit', {
          bubbles: true,
          cancelable: true,
          submitter: form.querySelector('button'),
        }),
      )
    fireSubmit()
    fireSubmit()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(response())
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Loaded'))
    boost.stop()
  })

  it('preserves uploaded files in multipart FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML =
      '<main data-boost="true"><form action="/upload" method="post" enctype="multipart/form-data"><input type="file" name="upload"></form></main>'
    const file = new File(['payload'], 'report.txt', { type: 'text/plain' })
    // jsdom does not implement a writable FileList; model the browser's FormData(form)
    // result while still asserting that the exact File reaches the Fetch body.
    const NativeFormData = FormData
    class UploadFormData extends NativeFormData {
      constructor(form?: HTMLFormElement) {
        super()
        if (form) this.append('upload', file)
      }
    }
    vi.stubGlobal('FormData', UploadFormData)
    const boost = createBoost({ progress: false })
    boost.start()
    document
      .querySelector('form')!
      .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Loaded'))
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect((body.get('upload') as File).name).toBe('report.txt')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Content-Type')
    boost.stop()
  })
})
