import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopInterruptibleSend } from '../../server/send-run-tracker'
import { Route } from './send-stream'

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  getChatMode: vi.fn(() => 'enhanced'),
  openaiChat: vi.fn(),
  streamResponses: vi.fn(),
  appendLocalMessage: vi.fn(),
  markRunStatus: vi.fn(async () => null),
  createPersistedRun: vi.fn(async () => null),
  createSession: vi.fn(async () => ({ id: 'created-default' })),
  ensureGatewayProbed: vi.fn(async () => undefined),
}))

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('../../server/rate-limit', () => ({ requireJsonContentType: () => null }))
vi.mock('../../server/session-utils', () => ({
  resolveSessionKey: async ({ rawSessionKey }: { rawSessionKey: string }) => ({ sessionKey: rawSessionKey }),
}))
vi.mock('../../server/gateway-capabilities', () => ({ getChatMode: mocks.getChatMode }))
vi.mock('../../server/local-provider-discovery', () => ({ getDiscoveredModels: () => [] }))
vi.mock('../../server/openai-compat-api', () => ({ openaiChat: mocks.openaiChat }))
vi.mock('../../server/responses-api', () => ({ streamResponses: mocks.streamResponses }))
vi.mock('../../server/local-session-store', () => ({
  ensureLocalSession: vi.fn(),
  getLocalMessages: () => [],
  appendLocalMessage: mocks.appendLocalMessage,
  touchLocalSession: vi.fn(),
}))
vi.mock('../../server/chat-event-bus', () => ({ publishChatEvent: vi.fn() }))
vi.mock('../../server/run-store', () => ({
  createPersistedRun: mocks.createPersistedRun,
  markRunStatus: mocks.markRunStatus,
  appendRunText: vi.fn(async () => null),
  setRunThinking: vi.fn(async () => null),
  upsertRunToolCall: vi.fn(async () => null),
}))
vi.mock('../../server/claude-api', () => ({
  ensureGatewayProbed: mocks.ensureGatewayProbed,
  streamChat: mocks.streamChat,
  getMessages: async () => [],
  getGatewayCapabilities: () => ({ sessions: true }),
  createSession: mocks.createSession,
  listSessions: async () => [],
}))
vi.mock('./workspace', () => ({ loadWorkspaceCatalog: async () => null }))

const handlers = Route.options.server?.handlers
const handler = handlers && typeof handlers !== 'function' ? handlers.POST : undefined

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => vi.clearAllMocks())

describe('session stream handoff', () => {
  it('keeps the gateway run alive after both browser disconnect signals and completes A', async () => {
    if (!handler) throw new Error('Missing POST handler')
    const done = deferred()
    let gatewaySignal: AbortSignal | undefined
    let onEvent: ((event: { event: string; data: Record<string, unknown> }) => Promise<void>) | undefined
    mocks.streamChat.mockImplementation(async (_session: string, _body: unknown, opts: {
      signal: AbortSignal
      onEvent: typeof onEvent
    }) => {
      gatewaySignal = opts.signal
      onEvent = opts.onEvent
      await done.promise
    })
    const requestController = new AbortController()
    const request = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'disposable-A', message: 'probe' }),
      signal: requestController.signal,
    })
    const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(onEvent).toBeDefined())
    await onEvent!({ event: 'run.started', data: { run_id: 'run-A', session_id: 'disposable-A' } })
    const reader = response.body!.getReader()
    await reader.read()
    requestController.abort()
    await reader.cancel()
    expect(gatewaySignal?.aborted).toBe(false)
    await onEvent!({ event: 'run.completed', data: { run_id: 'run-A', session_id: 'disposable-A' } })
    done.resolve()
    await vi.waitFor(() => expect(mocks.markRunStatus).toHaveBeenCalledWith('disposable-A', 'run-A', 'complete'))
  })

  it('only an explicit Stop aborts the gateway request for that session', async () => {
    if (!handler) throw new Error('Missing POST handler')
    const done = deferred()
    let gatewaySignal: AbortSignal | undefined
    let onEvent: ((event: { event: string; data: Record<string, unknown> }) => Promise<void>) | undefined
    mocks.streamChat.mockImplementation(async (_session: string, _body: unknown, opts: {
      signal: AbortSignal
      onEvent: typeof onEvent
    }) => {
      gatewaySignal = opts.signal
      onEvent = opts.onEvent
      await done.promise
    })
    const request = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'disposable-A', message: 'probe', idempotencyKey: 'request-A' }),
    })
    const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(onEvent).toBeDefined())
    await onEvent!({ event: 'run.started', data: { run_id: 'run-A', session_id: 'disposable-A' } })
    const wrongSession = stopInterruptibleSend('disposable-B', 'request-A')
    const stopped = stopInterruptibleSend('disposable-A', 'run-A')
    done.resolve()
    expect(wrongSession).toBe(false)
    expect(stopped).toBe(true)
    expect(gatewaySignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(mocks.markRunStatus).toHaveBeenCalledWith('disposable-A', 'run-A', 'error', 'Stopped by user'))
  })

  it('does not save a stopped portable reply as a completed assistant message', async () => {
    if (!handler) throw new Error('Missing POST handler')
    mocks.getChatMode.mockReturnValueOnce('portable')
    const finish = deferred()
    let portableSignal: AbortSignal | undefined
    mocks.openaiChat.mockImplementation(async (_messages: unknown, opts: { signal: AbortSignal }) => {
      portableSignal = opts.signal
      return (async function* () {
        yield { type: 'text', text: 'partial reply' }
        await finish.promise
      })()
    })
    const request = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'portable-A', message: 'probe', idempotencyKey: 'portable-request' }),
    })
    const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(portableSignal).toBeDefined())
    expect(stopInterruptibleSend('portable-A', 'portable-request')).toBe(true)
    expect(portableSignal?.aborted).toBe(true)
    finish.resolve()
    await vi.waitFor(() => expect(mocks.markRunStatus).toHaveBeenCalledWith('portable-A', expect.any(String), 'error', 'Stopped by user'))
    await vi.waitFor(() => expect(stopInterruptibleSend('portable-A', 'portable-request')).toBe(false))
    expect(mocks.appendLocalMessage.mock.calls.filter(([, message]) => message.role === 'assistant')).toHaveLength(0)
  })

  it('does not save a stopped Responses reply or fall back to another send', async () => {
    if (!handler) throw new Error('Missing POST handler')
    vi.stubEnv('HERMES_USE_RESPONSES', '1')
    try {
      mocks.getChatMode.mockReturnValueOnce('portable')
      const finish = deferred()
      let responsesSignal: AbortSignal | undefined
      mocks.streamResponses.mockImplementation((opts: { signal: AbortSignal }) => {
        responsesSignal = opts.signal
        return (async function* () {
          yield { kind: 'text.delta', delta: 'partial reply' }
          await finish.promise
        })()
      })
      const request = new Request('http://localhost/api/send-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: 'responses-A', message: 'probe', idempotencyKey: 'responses-request' }),
      })
      const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
      expect(response.status).toBe(200)
      await vi.waitFor(() => expect(responsesSignal).toBeDefined())
      expect(stopInterruptibleSend('responses-A', 'responses-request')).toBe(true)
      expect(responsesSignal?.aborted).toBe(true)
      finish.resolve()
      await vi.waitFor(() => expect(stopInterruptibleSend('responses-A', 'responses-request')).toBe(false))
      expect(mocks.appendLocalMessage.mock.calls.filter(([, message]) => message.role === 'assistant')).toHaveLength(0)
      expect(mocks.openaiChat).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('releases a bootstrapped new chat so a later new chat is not rejected', async () => {
    if (!handler) throw new Error('Missing POST handler')
    mocks.createSession.mockResolvedValueOnce({ id: 'created-A' }).mockResolvedValueOnce({ id: 'created-B' })
    mocks.streamChat.mockImplementation(async (session: string, _body: unknown, opts: {
      onEvent: (event: { event: string; data: Record<string, unknown> }) => Promise<void>
    }) => {
      const runId = `run-${session}`
      await opts.onEvent({ event: 'run.started', data: { run_id: runId, session_id: session } })
      await opts.onEvent({ event: 'run.completed', data: { run_id: runId, session_id: session } })
    })
    const sendNew = async (id: string) => {
      const request = new Request('http://localhost/api/send-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: 'new', message: 'probe', idempotencyKey: id }),
      })
      const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
      if (response.status === 200) await response.text()
      return response.status
    }
    expect(await sendNew('request-new-A')).toBe(200)
    expect(await sendNew('request-new-B')).toBe(200)
    expect(mocks.createSession).toHaveBeenCalledTimes(2)
  })

  it('accepts Stop while the Gateway probe is still preparing a send', async () => {
    if (!handler) throw new Error('Missing POST handler')
    const probe = deferred()
    mocks.ensureGatewayProbed.mockImplementationOnce(async () => { await probe.promise })
    const request = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'new', message: 'probe', idempotencyKey: 'request-probe-stop' }),
    })
    const pending = handler({ request } as Parameters<typeof handler>[0])
    await vi.waitFor(() => expect(mocks.ensureGatewayProbed).toHaveBeenCalled())
    const stopped = stopInterruptibleSend('new', 'request-probe-stop')
    probe.resolve()
    const response = (await pending) as Response
    expect(stopped).toBe(true)
    expect(response.status).toBe(204)
    expect(mocks.streamChat).not.toHaveBeenCalled()
    expect(stopInterruptibleSend('new', 'request-probe-stop')).toBe(false)
  })

  it('stops a bootstrapped new chat using the original new-chat request identity', async () => {
    if (!handler) throw new Error('Missing POST handler')
    const done = deferred()
    let gatewaySignal: AbortSignal | undefined
    mocks.createSession.mockResolvedValueOnce({ id: 'created-stop' })
    mocks.streamChat.mockImplementation(async (_session: string, _body: unknown, opts: { signal: AbortSignal }) => {
      gatewaySignal = opts.signal
      await done.promise
    })
    const request = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'new', message: 'probe', idempotencyKey: 'request-stop-new' }),
    })
    const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(gatewaySignal).toBeDefined())
    expect(stopInterruptibleSend('new', 'request-stop-new')).toBe(true)
    expect(gatewaySignal?.aborted).toBe(true)
    done.resolve()
    await vi.waitFor(() => expect(stopInterruptibleSend('new', 'request-stop-new')).toBe(false))
  })

  it('aborts a detached gateway run when the server-side lifetime limit expires', async () => {
    if (!handler) throw new Error('Missing POST handler')
    const done = deferred()
    let gatewaySignal: AbortSignal | undefined
    mocks.streamChat.mockImplementation(async (_session: string, _body: unknown, opts: { signal: AbortSignal }) => {
      gatewaySignal = opts.signal
      await done.promise
    })
    const request = new Request('http://localhost/api/send-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'disposable-A', message: 'probe', idempotencyKey: 'request-timeout' }),
    })
    vi.useFakeTimers()
    try {
      const response = (await handler({ request } as Parameters<typeof handler>[0])) as Response
      expect(response.status).toBe(200)
      await vi.advanceTimersByTimeAsync(1)
      expect(gatewaySignal).toBeDefined()
      await vi.advanceTimersByTimeAsync(600_000)
      expect(gatewaySignal?.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(1000) // allow the mid-run poller to drain
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      done.resolve()
      vi.useRealTimers()
    }
  })
})
