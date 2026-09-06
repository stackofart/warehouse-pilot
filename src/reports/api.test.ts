import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { configureStorageScope, openDatabase, OUTBOX_STORE, requestToPromise } from '../storage/database'
import { sendReport, flushReports } from './api'

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('window', new EventTarget()); configureStorageScope('picker-photos') })
afterEach(() => { configureStorageScope(null); vi.unstubAllGlobals() })
it('retains a photo with the same report ID offline, then removes it from the outbox after success', async () => {
  const input = { id: crypto.randomUUID(), orderId: 'order', row: 1, kind: 'damaged' as const, note: '', photoDataUrl: 'data:image/jpeg;base64,/9j/AA==' }
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')))
  expect(await sendReport(input)).toBe(1)
  const db = await openDatabase()
  expect(await requestToPromise(db.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).get(input.id))).toMatchObject({ input })
  const fetcher = vi.fn().mockResolvedValue(Response.json({ report: { id: input.id } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await flushReports()).toBe(0)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input)
  expect(await requestToPromise(db.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).get(input.id))).toBeUndefined()
  db.close()
})
