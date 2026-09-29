import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthenticated } from '../../../server/auth-middleware'
import { registerInterruptibleSend, unregisterInterruptibleSend } from '../../../server/send-run-tracker'
import { Route } from './$sessionKey.$requestId.stop'

vi.mock('../../../server/auth-middleware', () => ({ isAuthenticated: vi.fn(() => true) }))
vi.mock('../../../server/rate-limit', () => ({ requireJsonContentType: () => null }))

const handlers = Route.options.server?.handlers
const handler = handlers && typeof handlers !== 'function' ? handlers.POST : undefined
const params = { sessionKey: 'disposable-A', requestId: 'request-A' }

afterEach(() => {
  unregisterInterruptibleSend(params.sessionKey, params.requestId)
  vi.mocked(isAuthenticated).mockReturnValue(true)
})

async function post(input = params): Promise<Response> {
  if (!handler) throw new Error('Missing POST handler')
  const request = new Request('http://localhost/api/runs/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return (await handler({ request, params: input } as Parameters<typeof handler>[0])) as Response
}

describe('explicit Stop for a Workspace send', () => {
  it('interrupts the matching request and does not interrupt another session', async () => {
    const stopA = vi.fn()
    const stopB = vi.fn()
    registerInterruptibleSend(params.sessionKey, params.requestId, stopA)
    registerInterruptibleSend('disposable-B', 'request-B', stopB)
    expect((await post({ sessionKey: 'disposable-B', requestId: params.requestId })).status).toBe(404)
    const response = await post()
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopB).not.toHaveBeenCalled()
    expect((await post()).status).toBe(200)
    expect(stopA).toHaveBeenCalledTimes(1)
    unregisterInterruptibleSend('disposable-B', 'request-B')
  })

  it('rejects unauthenticated stop requests', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    expect((await post()).status).toBe(401)
  })
})
