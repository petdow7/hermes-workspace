import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestStopActiveSend } from './stop-active-send'

afterEach(() => vi.unstubAllGlobals())

describe('Stop button request', () => {
  it('POSTs an authenticated, session-scoped Stop request and reports success', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestStopActiveSend('disposable-A', 'request-A')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs/disposable-A/request-A/stop',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', keepalive: true }),
    )
  })

  it('retries a stop that arrives before the send has registered', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestStopActiveSend('disposable-A', 'request-A')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not report success if Stop is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 401 })))
    await expect(requestStopActiveSend('disposable-A', 'request-A')).rejects.toThrow('Stop request failed')
  })

  it('keeps trying while slow setup has not yet registered the send', async () => {
    vi.useFakeTimers()
    const start = Date.now()
    const fetchMock = vi.fn(async () => new Response('{}', {
      status: Date.now() - start >= 2500 ? 200 : 404,
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const pending = requestStopActiveSend('disposable-A', 'request-A')
      const result = expect(pending).resolves.toBe(true)
      await vi.advanceTimersByTimeAsync(2600)
      await result
      expect(fetchMock.mock.calls.length).toBeGreaterThan(20)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for registration instead of exhausting retries in one tick', async () => {
    let registered = false
    const timer = setTimeout(() => { registered = true }, 30)
    const fetchMock = vi.fn(async () => new Response(
      registered ? '{"ok":true}' : '{}',
      { status: registered ? 200 : 404 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(requestStopActiveSend('disposable-A', 'request-A')).resolves.toBe(true)
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    } finally {
      clearTimeout(timer)
    }
  })
})
