import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from './claude-api'

afterEach(() => vi.unstubAllGlobals())

function stubGateway() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response('event: run.completed\ndata: {}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('enhanced session model switch', () => {
  it('requires a provider-qualified model to be locked for the turn', async () => {
    const fetchMock = stubGateway()
    await streamChat('session-1', { message: 'hi', model: 'anthropic/claude-sonnet-5', provider: 'anthropic' }, {
      onEvent: async () => {},
    })
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request).toMatchObject({
      model: 'claude-sonnet-5', provider: 'anthropic',
      require_model_lock: true, persist_model_lock: false,
    })
  })

  it('keeps a slash-named legacy model unlocked without catalog provider', async () => {
    const fetchMock = stubGateway()
    await streamChat('session-1', { message: 'hi', model: 'qwen/qwen3-coder' }, {
      onEvent: async () => {},
    })
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request.model).toBe('qwen/qwen3-coder')
    expect(request).not.toHaveProperty('require_model_lock')
  })

  it('rejects a catalog provider mismatch rather than sending unlocked', async () => {
    const fetchMock = stubGateway()
    await expect(streamChat('session-1', {
      message: 'hi', model: 'anthropic/claude-sonnet-5', provider: 'openai-codex',
    }, { onEvent: async () => {} })).rejects.toThrow(/provider.*model/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps an unqualified default model unlocked', async () => {
    const fetchMock = stubGateway()
    await streamChat('session-1', { message: 'hi', model: 'hermes-agent' }, {
      onEvent: async () => {},
    })
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request).not.toHaveProperty('require_model_lock')
  })

  it('propagates an SSE handler failure rather than swallowing it', async () => {
    stubGateway()
    await expect(streamChat('session-1', { message: 'hi' }, {
      onEvent: async () => { throw new Error('Gateway run failed') },
    })).rejects.toThrow('Gateway run failed')
  })
})
