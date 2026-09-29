import { describe, expect, it } from 'vitest'
import { useChatStore } from './chat-store'
import type { ChatMessage } from '../screens/chat/types'

function textMessage(
  id: string,
  role: string,
  text: string,
  historyIndex: number,
): ChatMessage {
  return {
    id,
    role,
    timestamp: 1_700_000_000_000,
    __historyIndex: historyIndex,
    content: [{ type: 'text', text }],
  }
}

describe('chat-store history merge ordering', () => {
  it('preserves persisted history order when messages share a timestamp', () => {
    const messages: Array<ChatMessage> = [
      textMessage('m1', 'user', 'first question', 0),
      textMessage('m2', 'assistant', 'first answer', 1),
      textMessage('m3', 'user', 'follow-up', 2),
    ]

    const merged = useChatStore
      .getState()
      .mergeHistoryMessages('history-order-session', messages)

    expect(merged.map((message) => message.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('accepts local-store historyIndex as a persisted order hint', () => {
    const messages: Array<ChatMessage> = [
      {
        id: 'local-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        historyIndex: 0,
        content: [{ type: 'text', text: 'local question' }],
      },
      {
        id: 'local-2',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        historyIndex: 1,
        content: [{ type: 'text', text: 'local answer' }],
      },
      {
        id: 'local-3',
        role: 'user',
        timestamp: 1_700_000_000_000,
        historyIndex: 2,
        content: [{ type: 'text', text: 'local follow-up' }],
      },
    ]

    const merged = useChatStore
      .getState()
      .mergeHistoryMessages('local-history-order-session', messages)

    expect(merged.map((message) => message.id)).toEqual([
      'local-1',
      'local-2',
      'local-3',
    ])
  })
})

describe('active send Stop identity', () => {
  it('never clears B\'s new-chat waiting marker while A resolves', () => {
    const store = useChatStore.getState()
    try {
      store.setSessionWaiting('new', null, 'request-B')
      store.clearSessionWaitingIfRequestId('new', 'request-A')
      expect(useChatStore.getState().waitingSessionMeta.new?.requestId).toBe('request-B')
      store.clearSessionWaitingIfRequestId('new', 'request-B')
      expect(useChatStore.getState().waitingSessionMeta.new).toBeUndefined()
    } finally {
      store.clearSessionWaiting('new')
    }
  })
  it('keeps A\'s request ID while B runs and while A\'s run ID arrives later', () => {
    const store = useChatStore.getState()
    try {
      store.setSessionWaiting('stop-A', null, 'request-A')
      store.setSessionWaiting('stop-B', null, 'request-B')
      expect(useChatStore.getState().waitingSessionMeta['stop-A']?.requestId).toBe('request-A')
      store.setSessionWaiting('stop-A', 'run-A')
      expect(useChatStore.getState().waitingSessionMeta['stop-A']).toMatchObject({
        runId: 'run-A', requestId: 'request-A',
      })
      expect(useChatStore.getState().waitingSessionMeta['stop-B']?.requestId).toBe('request-B')
    } finally {
      store.clearSessionWaiting('stop-A')
      store.clearSessionWaiting('stop-B')
    }
  })
})
