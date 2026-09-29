// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The app's ESM React transform and react-dom's CJS require otherwise load
// separate dispatchers under Vitest on Windows.
vi.mock('react', async () => {
  const { createRequire } = await import('node:module')
  const react = createRequire(import.meta.url)('react')
  return { ...react, default: react }
})

import { useStreamingMessage } from './use-streaming-message'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('leaving a chat while its answer continues on the server', () => {
  it('detaches its browser reader without invoking the user Stop callback', async () => {
    const onAbort = vi.fn()
    const fetchMock = vi.fn((_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useStreamingMessage({ onAbort }))
    act(() => {
      void result.current.startStreaming({
        sessionKey: 'disposable-A', friendlyId: 'disposable-A', message: 'probe', idempotencyKey: 'request-A',
      })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      result.current.cancelStreaming()
      await Promise.resolve()
    })
    expect(onAbort).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
  })
})
