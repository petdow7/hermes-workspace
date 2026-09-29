import { describe, expect, it } from 'vitest'

import {
  advanceStickyStreamingText,
  createResponseWaitSnapshot,
  isTerminalActiveRunStatus,
  resolveSessionModel,
  resolveSelectedModelProvider,
  createPendingNewChatModelKey,
  resolveModelChoiceKey,
  shouldBlockUnresolvedModelSelection,
  shouldClearWaitingForAssistantMessage,
} from './chat-screen-utils'

describe('resolveSessionModel', () => {
  it('uses only the active chat choice over the gateway default', () => {
    expect(resolveSessionModel('chat-A', 'gpt-6-sol', {
      'chat-A': 'anthropic/claude-sonnet-5',
      'chat-B': 'openai-codex/gpt-5.6-luna',
    })).toBe('anthropic/claude-sonnet-5')
    expect(resolveSessionModel('chat-C', 'gpt-6-sol', {
      'chat-A': 'anthropic/claude-sonnet-5',
    })).toBe('gpt-6-sol')
  })
})

describe('resolveSelectedModelProvider', () => {
  const catalog = [
    { id: 'anthropic/claude-sonnet-5', provider: 'anthropic' },
    { id: 'qwen/qwen3-coder', provider: 'ollama' },
  ]
  it('uses the exact catalog provider, not the first slash segment', () => {
    expect(resolveSelectedModelProvider('anthropic/claude-sonnet-5', catalog)).toBe('anthropic')
    expect(resolveSelectedModelProvider('qwen/qwen3-coder', catalog)).toBeUndefined()
    expect(resolveSelectedModelProvider('qwen/qwen3-coder', [])).toBeUndefined()
  })
})

describe('resolveModelChoiceKey', () => {
  it('does not add a provider to a legacy slash-named local model', () => {
    expect(resolveModelChoiceKey('qwen/qwen3-coder', 'ollama')).toBe('qwen/qwen3-coder')
    expect(resolveModelChoiceKey('claude-sonnet-5', 'anthropic')).toBe('anthropic/claude-sonnet-5')
    expect(resolveModelChoiceKey('anthropic/claude-sonnet-5', 'anthropic')).toBe('anthropic/claude-sonnet-5')
  })
})

describe('unresolved picker choice', () => {
  const models = [{ id: 'anthropic/claude-sonnet-5', provider: 'anthropic' }]
  it('blocks only an explicit choice missing from the current catalog', () => {
    expect(shouldBlockUnresolvedModelSelection('anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5', [])).toBe(true)
    expect(shouldBlockUnresolvedModelSelection('anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5', models)).toBe(false)
    expect(shouldBlockUnresolvedModelSelection(undefined, 'gpt-6-sol', [])).toBe(false)
    expect(shouldBlockUnresolvedModelSelection('qwen/qwen3-coder', 'qwen/qwen3-coder', [{ id: 'qwen/qwen3-coder', provider: 'ollama' }])).toBe(false)
    expect(shouldBlockUnresolvedModelSelection('anthropic/claude-sonnet-5', 'gpt-6-sol', models)).toBe(true)
  })
})

describe('new-chat model handoff', () => {
  it('keeps model choices separate for abandoned and concurrent new chats', () => {
    const first = createPendingNewChatModelKey('draft-a')
    const second = createPendingNewChatModelKey('draft-b')
    expect(first).not.toBe(second)
    expect(resolveSessionModel(second, 'gpt-6-sol', {
      [first]: 'anthropic/claude-sonnet-5',
    })).toBe('gpt-6-sol')
  })
  it('keeps the picker choice available for the first send before a session ID exists', () => {
    const pendingKey = createPendingNewChatModelKey('current-draft')
    expect(resolveSessionModel(pendingKey, 'gpt-6-sol', {
      [pendingKey]: 'anthropic/claude-sonnet-5',
    })).toBe('anthropic/claude-sonnet-5')
  })
})

describe('advanceStickyStreamingText', () => {
  it('preserves the last non-empty streaming text when a tool phase temporarily reports empty text', () => {
    const afterText = advanceStickyStreamingText({
      isStreaming: true,
      runId: 'run-1',
      rawText: 'Working through the task',
      smoothedText: 'Working through the task',
      previousState: { runId: null, text: '' },
    })

    const afterToolPhase = advanceStickyStreamingText({
      isStreaming: true,
      runId: 'run-1',
      rawText: '',
      smoothedText: '',
      previousState: afterText,
    })

    expect(afterToolPhase).toEqual({
      runId: 'run-1',
      text: 'Working through the task',
    })
  })

  it('resets sticky text when a new run starts', () => {
    const next = advanceStickyStreamingText({
      isStreaming: true,
      runId: 'run-2',
      rawText: '',
      smoothedText: '',
      previousState: { runId: 'run-1', text: 'Old stream text' },
    })

    expect(next).toEqual({ runId: 'run-2', text: '' })
  })

  it('clears sticky text when streaming ends', () => {
    const next = advanceStickyStreamingText({
      isStreaming: false,
      runId: null,
      rawText: '',
      smoothedText: '',
      previousState: { runId: 'run-1', text: 'Old stream text' },
    })

    expect(next).toEqual({ runId: null, text: '' })
  })
})

describe('response wait detection', () => {
  it('treats persisted complete runs as terminal', () => {
    expect(isTerminalActiveRunStatus('complete')).toBe(true)
    expect(isTerminalActiveRunStatus('completed')).toBe(true)
    expect(isTerminalActiveRunStatus('active')).toBe(false)
  })

  it('clears waiting when a new assistant message appears after the send snapshot', () => {
    const snapshot = createResponseWaitSnapshot([
      {
        role: 'user',
        content: [{ type: 'text', text: 'remember that i like cheesecake' }],
      },
    ])

    expect(
      shouldClearWaitingForAssistantMessage(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'remember that i like cheesecake' },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Remembered: you like cheesecake.' },
            ],
            id: 'assistant-1',
          },
        ],
        snapshot,
      ),
    ).toBe(true)
  })
})
