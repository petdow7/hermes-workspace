// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => {
  const { createRequire } = await import('node:module')
  const react = createRequire(import.meta.url)('react')
  return { ...react, default: react }
})
const mockStore = vi.hoisted(() => ({ setSessionWaiting: vi.fn(), isSessionWaiting: vi.fn(() => false), clearSessionWaiting: vi.fn() }))
vi.mock('../../../stores/chat-store', () => ({ useChatStore: { getState: () => mockStore } }))
import { useActiveRunCheck } from './use-active-run-check'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('active run recovery across chat switches', () => {
  it('restores Stop identity when A resolves but has not reported a run ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true, run: null, requestId: 'request-A',
    }))))
    renderHook(() => useActiveRunCheck({ sessionKey: 'created-A', enabled: true }))
    await waitFor(() => expect(mockStore.setSessionWaiting).toHaveBeenCalledWith('created-A', null, 'request-A'))
  })
  it('checks each selected session, including one reopened after navigating away', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const session = url.includes('/A/') ? 'A' : 'B'
      return new Response(JSON.stringify({ ok: true, run: { runId: `run-${session}`, status: 'active', sessionKey: session, startedAt: 1 } }))
    }))
    const { rerender } = renderHook(({ sessionKey }) => useActiveRunCheck({ sessionKey, enabled: true }), {
      initialProps: { sessionKey: 'A' },
    })
    await waitFor(() => expect(mockStore.setSessionWaiting).toHaveBeenCalledWith('A', 'run-A'))
    rerender({ sessionKey: 'B' })
    await waitFor(() => expect(mockStore.setSessionWaiting).toHaveBeenCalledWith('B', 'run-B'))
    rerender({ sessionKey: 'A' })
    await waitFor(() => expect(mockStore.setSessionWaiting).toHaveBeenCalledTimes(3))
  })
})
