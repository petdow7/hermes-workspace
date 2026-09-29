import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindInterruptibleRun,
  getInterruptibleRequestForSession,
  registerInterruptibleSend,
  rekeyInterruptibleSend,
  stopInterruptibleSend,
  unregisterInterruptibleSend,
} from './send-run-tracker'

const ids: Array<[string, string]> = []
function register(session: string, id: string, stop: () => void): boolean {
  ids.push([session, id])
  return registerInterruptibleSend(session, id, stop)
}
afterEach(() => {
  for (const [session, id] of ids) unregisterInterruptibleSend(session, id)
  ids.length = 0
})

describe('interruptible Workspace sends', () => {
  it('stops only the matching session and request, at most once', () => {
    const stopA = vi.fn()
    const stopB = vi.fn()
    expect(register('A', 'request-a', stopA)).toBe(true)
    expect(register('B', 'request-b', stopB)).toBe(true)
    expect(stopInterruptibleSend('B', 'request-a')).toBe(false)
    expect(stopInterruptibleSend('A', 'request-a')).toBe(true)
    expect(stopInterruptibleSend('A', 'request-a')).toBe(true)
    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopB).not.toHaveBeenCalled()
  })

  it('can stop a resumed chat by its run ID without crossing into another session', () => {
    const stopA = vi.fn()
    const stopB = vi.fn()
    register('A', 'request-a', stopA)
    register('B', 'request-b', stopB)
    expect(bindInterruptibleRun('A', 'request-a', 'run-a')).toBe(true)
    expect(stopInterruptibleSend('B', 'run-a')).toBe(false)
    expect(stopInterruptibleSend('A', 'run-a')).toBe(true)
    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopB).not.toHaveBeenCalled()
  })

  it('allows simultaneous new chats and moves each Stop identity to its own session', () => {
    const stopA = vi.fn()
    const stopB = vi.fn()
    expect(register('new', 'request-a', stopA)).toBe(true)
    expect(register('new', 'request-b', stopB)).toBe(true)
    expect(rekeyInterruptibleSend('new', 'request-a', 'created-A')).toBe(true)
    ids.push(['created-A', 'request-a'])
    expect(rekeyInterruptibleSend('new', 'request-b', 'created-B')).toBe(true)
    ids.push(['created-B', 'request-b'])
    expect(bindInterruptibleRun('created-A', 'request-a', 'run-a')).toBe(true)
    expect(stopInterruptibleSend('created-A', 'run-a')).toBe(true)
    expect(stopInterruptibleSend('created-B', 'request-b')).toBe(true)
    expect(stopA).toHaveBeenCalledTimes(1)
    expect(stopB).toHaveBeenCalledTimes(1)
  })

  it('recovers a pending request by its real session key after new-chat rekey', () => {
    expect(register('new', 'request-A', vi.fn())).toBe(true)
    expect(register('new', 'request-B', vi.fn())).toBe(true)
    expect(rekeyInterruptibleSend('new', 'request-A', 'created-A')).toBe(true)
    ids.push(['created-A', 'request-A'])
    expect(getInterruptibleRequestForSession('created-A')).toBe('request-A')
    expect(getInterruptibleRequestForSession('new')).toBe('request-B')
  })

  it('accepts an in-flight Stop using the original new-chat identity after session creation', () => {
    const stop = vi.fn()
    expect(register('new', 'request-early', stop)).toBe(true)
    expect(rekeyInterruptibleSend('new', 'request-early', 'created-C')).toBe(true)
    ids.push(['created-C', 'request-early'])
    expect(stopInterruptibleSend('new', 'request-early')).toBe(true)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('allows one live send per session while other sessions continue', () => {
    expect(register('A', 'first', vi.fn())).toBe(true)
    expect(register('A', 'second', vi.fn())).toBe(false)
    expect(register('B', 'other', vi.fn())).toBe(true)
    unregisterInterruptibleSend('A', 'first')
    expect(register('A', 'second', vi.fn())).toBe(true)
  })
})
