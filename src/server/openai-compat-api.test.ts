import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildRequestBody, openaiChat, parseOpenAIStream } from './openai-compat-api'

describe('provider-qualified Hermes model choices', () => {
  it('sends the provider explicitly and the bare model to the gateway', async () => {
    const request = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      model: 'openai-codex/gpt-6-sol',
      provider: 'openai-codex',
    })
    expect(request).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-sol', require_model_lock: true })
  })

  it('does not misinterpret a slash-named legacy model without catalog provider', async () => {
    const request = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      model: 'qwen/qwen3-coder',
    })
    expect(request.model).toBe('qwen/qwen3-coder')
    expect(request).not.toHaveProperty('provider')
    expect(request).not.toHaveProperty('require_model_lock')
  })

  it('does not impose a gateway lock on a direct local-provider endpoint', async () => {
    const request = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      model: 'qwen/local',
      baseUrl: 'http://127.0.0.1:11434/v1',
    })
    expect(request).not.toHaveProperty('require_model_lock')
  })

  it('keeps a bare default model unqualified', async () => {
    const request = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      model: 'hermes-agent',
    })
    expect(request).toMatchObject({ model: 'hermes-agent' })
    expect(request).not.toHaveProperty('provider')
    expect(request).not.toHaveProperty('require_model_lock')
  })
})

function createStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_USERPROFILE = process.env.USERPROFILE

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.HERMES_API_TOKEN
  delete process.env.CLAUDE_API_TOKEN
  if (ORIGINAL_HOME === undefined) delete process.env.HOME
  else process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = ORIGINAL_USERPROFILE
})

describe('openaiChat', () => {
  it('sends Hermes session continuity headers with authentication when available', async () => {
    process.env.HERMES_API_TOKEN = 'test-token'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await openaiChat([{ role: 'user', content: 'hello' }], {
      model: 'hermes-agent',
      sessionId: 'workspace-session-1',
    })

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers['X-Hermes-Session-Id']).toBe('workspace-session-1')
    expect(headers['X-Claude-Session-Id']).toBe('workspace-session-1')
  })

  it('sends Hermes session continuity headers even without a bearer token', async () => {
    process.env.HOME = '/tmp/hermes-workspace-test-no-codex-auth'
    process.env.USERPROFILE = '/tmp/hermes-workspace-test-no-codex-auth'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await openaiChat([{ role: 'user', content: 'hello' }], {
      model: 'hermes-agent',
      sessionId: 'workspace-session-2',
    })

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.Authorization === undefined).toBe(true)
    expect(headers['X-Hermes-Session-Id']).toBe('workspace-session-2')
    expect(headers['X-Claude-Session-Id']).toBe('workspace-session-2')
  })
})

describe('parseOpenAIStream', () => {
  it('rejects a failed gateway turn instead of reporting the partial reply as success', async () => {
    const response = createStreamResponse([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\n',
      'data: [DONE]\n\n',
    ])
    const read = async () => {
      for await (const _chunk of parseOpenAIStream(response)) { /* consume */ }
    }
    await expect(read()).rejects.toThrow(/stream failed/i)
  })

  it('rejects a top-level gateway error after partial text', async () => {
    const response = createStreamResponse([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"message":"model lock rejected"}}\n\n',
    ])
    const read = async () => {
      for await (const _chunk of parseOpenAIStream(response)) { /* consume */ }
    }
    await expect(read()).rejects.toThrow(/model lock rejected/i)
  })

  it('passes through ordinary content chunks', async () => {
    const response = createStreamResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = []
    for await (const chunk of parseOpenAIStream(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'content', text: 'Hello' },
      { type: 'content', text: ' world' },
    ])
  })

  it('emits synthetic tool events for Hermes tool progress frames', async () => {
    const response = createStreamResponse([
      'event: claude.tool.progress\n',
      'data: {"tool":"terminal","emoji":"💻","label":"ls -la"}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = []
    for await (const chunk of parseOpenAIStream(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      {
        type: 'tool',
        name: 'terminal',
        label: '💻 ls -la',
      },
    ])
  })

  it('handles multiple tool events even when frames are split across transport chunks', async () => {
    const response = createStreamResponse([
      'event: claude.tool.progress\ndata: {"tool":"browser_get_images","emoji":"📖","la',
      'bel":"scan page"}\n\n',
      'event: claude.tool.progress\ndata: {"tool":"browser_console","emoji":"🔎","label":"inspect DOM"}\n\n',
      'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = []
    for await (const chunk of parseOpenAIStream(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      {
        type: 'tool',
        name: 'browser_get_images',
        label: '📖 scan page',
      },
      {
        type: 'tool',
        name: 'browser_console',
        label: '🔎 inspect DOM',
      },
      { type: 'content', text: 'done' },
    ])
  })
})
