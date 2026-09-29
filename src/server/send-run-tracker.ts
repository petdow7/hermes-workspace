const ACTIVE_RUNS_KEY = '__claude_active_send_runs__' as const

function getActiveRuns(): Set<string> {
  const globalValue = globalThis as typeof globalThis & {
    [ACTIVE_RUNS_KEY]?: Set<string>
  }
  if (!globalValue[ACTIVE_RUNS_KEY]) {
    globalValue[ACTIVE_RUNS_KEY] = new Set<string>()
  }
  return globalValue[ACTIVE_RUNS_KEY]
}

export function registerActiveSendRun(runId: string): void {
  if (!runId) return
  getActiveRuns().add(runId)
}

export function unregisterActiveSendRun(runId: string): void {
  if (!runId) return
  getActiveRuns().delete(runId)
}

export function hasActiveSendRun(runId: string | null | undefined): boolean {
  if (!runId) return false
  return getActiveRuns().has(runId)
}

type InterruptibleSend = {
  sessionKey: string
  sourceSessionKey: string
  requestId: string
  runId?: string
  stop: () => void
  stopped: boolean
}

const INTERRUPTIBLE_SENDS_KEY = '__workspace_interruptible_sends__' as const

function getInterruptibleSends(): Map<string, InterruptibleSend> {
  const globals = globalThis as typeof globalThis & {
    [INTERRUPTIBLE_SENDS_KEY]?: Map<string, InterruptibleSend>
  }
  return (globals[INTERRUPTIBLE_SENDS_KEY] ??= new Map())
}

function sendKey(sessionKey: string, requestId: string): string {
  return JSON.stringify([sessionKey, requestId])
}

export function registerInterruptibleSend(
  sessionKey: string,
  requestId: string,
  stop: () => void,
): boolean {
  if (!sessionKey || !requestId) return false
  const sends = getInterruptibleSends()
  // A fresh chat has no real session yet; distinct new-chat requests can run
  // concurrently. A resolved chat still gets at most one agent turn.
  if (sends.size >= 10 || sends.has(sendKey(sessionKey, requestId))) return false
  if (sessionKey !== 'new' && [...sends.values()].some((send) => send.sessionKey === sessionKey)) return false
  sends.set(sendKey(sessionKey, requestId), { sessionKey, sourceSessionKey: sessionKey, requestId, stop, stopped: false })
  return true
}

export function rekeyInterruptibleSend(sessionKey: string, requestId: string, resolvedKey: string): boolean {
  const sends = getInterruptibleSends()
  const originalKey = sendKey(sessionKey, requestId)
  const send = sends.get(originalKey)
  if (!send || !resolvedKey) return false
  if (sessionKey === resolvedKey) return true
  if ([...sends.values()].some((entry) => entry.sessionKey === resolvedKey)) return false
  sends.delete(originalKey)
  send.sessionKey = resolvedKey
  sends.set(sendKey(resolvedKey, requestId), send)
  return true
}

export function bindInterruptibleRun(sessionKey: string, requestId: string, runId: string): boolean {
  const send = getInterruptibleSends().get(sendKey(sessionKey, requestId))
  if (!send || !runId) return false
  send.runId = runId
  return true
}

export function getInterruptibleRequestForSession(sessionKey: string): string | null {
  const send = [...getInterruptibleSends().values()].find((entry) =>
    entry.sessionKey === sessionKey && !entry.stopped,
  )
  return send?.requestId ?? null
}

export function stopInterruptibleSend(sessionKey: string, requestId: string): boolean {
  const send = [...getInterruptibleSends().values()].find((entry) =>
    (entry.sessionKey === sessionKey && (entry.requestId === requestId || entry.runId === requestId)) ||
    (entry.sourceSessionKey === sessionKey && entry.requestId === requestId),
  )
  if (!send) return false
  if (!send.stopped) {
    send.stopped = true
    send.stop()
  }
  return true
}

export function unregisterInterruptibleSend(sessionKey: string, requestId: string): void {
  getInterruptibleSends().delete(sendKey(sessionKey, requestId))
}
