import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { configureStorageScope } from '../storage/database'
import { createFulfillmentSession, updateFulfillmentItemNote } from './workflow'
import { flushSessions, getSyncedSession, saveSyncedSession } from './sync'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('navigator', { onLine: false })
  configureStorageScope('picker-a')
})
afterEach(() => { configureStorageScope(null); vi.unstubAllGlobals() })
describe('per-user offline picking outbox', () => {
  it('replays a lost acknowledgement before sending later offline edits', async () => {
    const receipts = new Map<string, unknown>()
    let version = 0
    let loseResponse = true
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body))
      if (receipts.has(request.mutationId)) return Response.json(receipts.get(request.mutationId))
      if (request.expectedVersion !== version) return Response.json({ error: 'Conflict' }, { status: 409 })
      const body = { session: { ...request.session, serverVersion: ++version, syncStatus: 'synced' } }
      receipts.set(request.mutationId, body)
      if (loseResponse) { loseResponse = false; throw new TypeError('Response lost') }
      return Response.json(body)
    }))
    let session = await saveSyncedSession(createFulfillmentSession('order', [1], { mode: 'fast' }))
    expect(session.syncStatus).toBe('pending')
    vi.stubGlobal('navigator', { onLine: false })
    session = await saveSyncedSession(updateFulfillmentItemNote(session, 1, 'After network loss'))
    vi.stubGlobal('navigator', { onLine: true })
    await flushSessions()
    expect(version).toBe(2)
    expect([...receipts.values()].at(-1)).toMatchObject({ session: { items: { '1': { note: 'After network loss' } } } })
  })
  it('coalesces offline edits, then sends one complete version and preserves its note', async () => {
    let session = await saveSyncedSession(createFulfillmentSession('order', [1], { mode: 'fast' }))
    session = await saveSyncedSession(updateFulfillmentItemNote(session, 1, 'Found at 24.F'))
    expect(session.syncStatus).toBe('pending')
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body))
      expect(input.expectedVersion).toBe(0)
      return Response.json({ session: { ...input.session, serverVersion: 1, syncStatus: 'synced' } })
    })
    vi.stubGlobal('fetch', fetcher); vi.stubGlobal('navigator', { onLine: true })
    await flushSessions()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).session.items['1'].note).toBe('Found at 24.F')
  })
  it('rejects an older tab snapshot without overwriting newer local work', async () => {
    const initial = createFulfillmentSession('order', [1], { mode: 'fast' })
    const stored = await saveSyncedSession(initial)
    await expect(saveSyncedSession(initial)).rejects.toMatchObject({ status: 409 })
    expect((await getSyncedSession('order'))?.localRevision).toBe(stored.localRevision)
  })
  it('keeps a conflict for explicit resolution instead of dropping or retrying it forever', async () => {
    await saveSyncedSession(createFulfillmentSession('order', [1], { mode: 'fast' }))
    const fetcher = vi.fn(async () => Response.json({ error: 'Reassigned or changed' }, { status: 409 }))
    vi.stubGlobal('fetch', fetcher); vi.stubGlobal('navigator', { onLine: true })
    await flushSessions(); await flushSessions()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await getSyncedSession('order'))?.syncStatus).toBe('conflict')
  })
  it('does not reuse another account local orders or pending work', async () => {
    await saveSyncedSession(createFulfillmentSession('order', [1], { mode: 'fast' }))
    configureStorageScope('picker-b')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ session: null })))
    expect(await getSyncedSession('order')).toBeUndefined()
    configureStorageScope('picker-a')
    expect((await getSyncedSession('order'))?.syncStatus).toBe('pending')
  })
})
