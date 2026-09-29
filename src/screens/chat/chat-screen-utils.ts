import type { ChatAttachment, ChatMessage } from './types'

export type StickyStreamingTextState = {
  runId: string | null
  text: string
}

export type ResponseWaitSnapshot = {
  messageCount: number
  lastAssistantId: string | null
}

export function createPendingNewChatModelKey(instanceId: string): string {
  return `__workspace_pending_new_chat_model__:${instanceId}`
}

export function resolveSessionModel(
  sessionKey: string | undefined,
  gatewayModel: string,
  choices: Record<string, string>,
): string {
  return (sessionKey && choices[sessionKey]) || gatewayModel
}

export function resolveModelChoiceKey(model: string, provider?: string): string {
  const id = model.trim()
  const selectedProvider = provider?.trim()
  if (!id || !selectedProvider || id.includes('/')) return id
  return `${selectedProvider}/${id}`
}

export function shouldBlockUnresolvedModelSelection(
  selectedModel: string | undefined,
  currentModel: string,
  catalog: Array<{ id: string; provider?: string }>,
): boolean {
  if (!selectedModel) return false
  return selectedModel !== currentModel ||
    !catalog.some((entry) => entry.id === selectedModel)
}

export function resolveSelectedModelProvider(
  model: string,
  catalog: Array<{ id: string; provider?: string }>,
): string | undefined {
  const entry = catalog.find((candidate) => candidate.id === model)
  return entry?.provider && model.startsWith(`${entry.provider}/`)
    ? entry.provider
    : undefined
}

export function isTerminalActiveRunStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    ['complete', 'completed', 'failed', 'cancelled', 'error'].includes(status)
  )
}

function assistantMessageIdentity(message: ChatMessage): string {
  return String(
    message.__optimisticId ??
      message.id ??
      message.messageId ??
      message.__realtimeSequence ??
      '',
  )
}

export function createResponseWaitSnapshot(
  messages: Array<ChatMessage>,
): ResponseWaitSnapshot {
  const last = messages[messages.length - 1]
  return {
    messageCount: messages.length,
    lastAssistantId:
      last?.role === 'assistant' ? assistantMessageIdentity(last) : null,
  }
}

export function shouldClearWaitingForAssistantMessage(
  messages: Array<ChatMessage>,
  snapshot: ResponseWaitSnapshot,
): boolean {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return false
  if (last.__streamingStatus === 'streaming') return false

  if (messages.length > snapshot.messageCount) return true

  const currentId = assistantMessageIdentity(last)
  if (currentId.length > 0 && currentId !== (snapshot.lastAssistantId ?? '')) {
    return true
  }

  return snapshot.lastAssistantId === null
}

export function advanceStickyStreamingText(params: {
  isStreaming: boolean
  runId: string | null
  rawText: string
  smoothedText: string
  previousState: StickyStreamingTextState
}): StickyStreamingTextState {
  const { isStreaming, runId, rawText, smoothedText, previousState } = params

  if (!isStreaming) {
    return { runId: null, text: '' }
  }

  const nextRunId = runId ?? previousState.runId ?? 'streaming'
  const isNewRun = nextRunId !== previousState.runId
  const candidateText = smoothedText || rawText
  const nextText = candidateText.length > 0
    ? candidateText
    : isNewRun
      ? ''
      : previousState.text

  return {
    runId: nextRunId,
    text: nextText,
  }
}

type OptimisticMessagePayload = {
  clientId: string
  optimisticId: string
  optimisticMessage: ChatMessage
}

export function createOptimisticMessage(
  body: string,
  attachments: Array<ChatAttachment> = [],
): OptimisticMessagePayload {
  const clientId = crypto.randomUUID()
  const optimisticId = `opt-${clientId}`
  const timestamp = Date.now()
  const textContent =
    body.length > 0 ? [{ type: 'text' as const, text: body }] : []

  const optimisticMessage: ChatMessage = {
    role: 'user',
    content: textContent.length > 0 ? textContent : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    __optimisticId: optimisticId,
    __createdAt: timestamp,
    clientId,
    client_id: clientId,
    status: 'sending',
    timestamp,
  }

  return { clientId, optimisticId, optimisticMessage }
}
