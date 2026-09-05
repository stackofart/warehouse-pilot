import { ApiError, apiRequest, mayUseOfflineCache } from '../storage/apiClient'
import { FULFILLMENT_STORE, OUTBOX_STORE, getStorageScope, openDatabase, requestToPromise } from '../storage/database'
import type { FulfillmentSession } from './workflow'

type SessionAttempt = { session: FulfillmentSession; expectedVersion: number; mutationId: string }
type PendingSession = SessionAttempt & { id: string; kind: 'session'; attempted?: boolean; baseAttempt?: SessionAttempt }
const transactionDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error) })
let chain: Promise<unknown> = Promise.resolve()
function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`warehouse-sync-${getStorageScope()}`, action)
  const next = chain.then(action, action); chain = next.catch(() => undefined); return next
}

async function readLocal(orderId: string) {
  const db = await openDatabase()
  try { return await requestToPromise(db.transaction(FULFILLMENT_STORE).objectStore(FULFILLMENT_STORE).get(orderId)) as FulfillmentSession | undefined } finally { db.close() }
}
async function flushOne(pending: PendingSession): Promise<FulfillmentSession> {
  const scope = getStorageScope()
  let session = pending.session
  let remove = false
  try {
    if (pending.baseAttempt) {
      // A previous request may have committed even if its response was lost.
      // Replay its immutable id before sending edits made during that outage.
      const base = await apiRequest<{ session: FulfillmentSession }>(`/api/orders/${pending.id}/session`, { method: 'PUT', body: JSON.stringify(pending.baseAttempt) })
      session = { ...session, events: [...base.session.events, ...session.events.slice(pending.baseAttempt.session.events.length)], serverVersion: base.session.serverVersion }
      pending = { ...pending, session, expectedVersion: base.session.serverVersion || 0, baseAttempt: undefined }
    }
    pending = { ...pending, attempted: true }
    const beforeSend = await openDatabase(false, scope)
    try { const tx = beforeSend.transaction(OUTBOX_STORE, 'readwrite'); tx.objectStore(OUTBOX_STORE).put(pending); await transactionDone(tx) } finally { beforeSend.close() }
    if (scope !== getStorageScope()) throw new ApiError('Пользователь изменился. Отправка остановлена.', 409)
    const result = await apiRequest<{ session: FulfillmentSession }>(`/api/orders/${pending.id}/session`, { method: 'PUT', body: JSON.stringify({ session, expectedVersion: pending.expectedVersion, mutationId: pending.mutationId }) })
    session = { ...result.session, localRevision: session.localRevision, syncStatus: 'synced', syncError: undefined }
    remove = true
  } catch (error) {
    if (!mayUseOfflineCache(error)) session = { ...session, syncStatus: 'conflict', syncError: error instanceof Error ? error.message : 'Конфликт синхронизации' }
  }
  const db = await openDatabase(false, scope)
  try {
    const tx = db.transaction([FULFILLMENT_STORE, OUTBOX_STORE], 'readwrite')
    tx.objectStore(FULFILLMENT_STORE).put(session)
    if (remove) tx.objectStore(OUTBOX_STORE).delete(pending.id)
    else tx.objectStore(OUTBOX_STORE).put({ ...pending, session })
    await transactionDone(tx)
  } finally { db.close() }
  return session
}

export async function saveSyncedSession(input: FulfillmentSession) {
  return exclusive(async () => {
    const db = await openDatabase()
    let pending: PendingSession
    try {
      const tx = db.transaction([FULFILLMENT_STORE, OUTBOX_STORE], 'readwrite')
      const current = await requestToPromise(tx.objectStore(FULFILLMENT_STORE).get(input.orderId)) as FulfillmentSession | undefined
      if (current?.syncStatus === 'conflict' || (current?.localRevision || 0) !== (input.localRevision || 0)) {
        tx.abort()
        throw new ApiError('Прогресс изменён в другой вкладке. Обновите заказ.', 409)
      }
      const previousPending = await requestToPromise(tx.objectStore(OUTBOX_STORE).get(input.orderId)) as PendingSession | undefined
      const session: FulfillmentSession = { ...input, localRevision: (current?.localRevision || 0) + 1, syncStatus: 'pending' }
      const baseAttempt = previousPending?.baseAttempt ?? (previousPending?.attempted ? { session: previousPending.session, expectedVersion: previousPending.expectedVersion, mutationId: previousPending.mutationId } : undefined)
      pending = { id: session.orderId, kind: 'session', session, expectedVersion: previousPending?.expectedVersion ?? current?.serverVersion ?? 0, mutationId: crypto.randomUUID(), baseAttempt }
      tx.objectStore(FULFILLMENT_STORE).put(session)
      tx.objectStore(OUTBOX_STORE).put(pending)
      await transactionDone(tx)
    } finally { db.close() }
    if (!navigator.onLine) return pending.session
    return flushOne(pending)
  })
}

export async function flushSessions() {
  return exclusive(async () => {
    if (!getStorageScope() || !navigator.onLine) return
    const db = await openDatabase()
    let queue: PendingSession[]
    try { queue = await requestToPromise(db.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll()) as PendingSession[] } finally { db.close() }
    for (const pending of queue.filter(row => row.kind === 'session' && row.session.syncStatus !== 'conflict')) await flushOne(pending)
    window.dispatchEvent(new Event('warehouse:synced'))
  })
}

export async function getSyncedSession(orderId: string, discardLocal = false) {
  return exclusive(async () => {
    const scope = getStorageScope()
    const local = await readLocal(orderId)
    if (!discardLocal && local?.syncStatus && local.syncStatus !== 'synced') return local
    try {
      const result = await apiRequest<{ session: FulfillmentSession | null }>(`/api/orders/${orderId}/session`)
      const session = result.session ? { ...result.session, localRevision: (local?.localRevision || 0) + 1 } : undefined
      const db = await openDatabase(false, scope)
      try {
        const tx = db.transaction([FULFILLMENT_STORE, OUTBOX_STORE], 'readwrite')
        if (session) tx.objectStore(FULFILLMENT_STORE).put(session)
        else tx.objectStore(FULFILLMENT_STORE).delete(orderId)
        if (discardLocal) tx.objectStore(OUTBOX_STORE).delete(orderId)
        await transactionDone(tx)
      } finally { db.close() }
      return session
    } catch (error) { if (discardLocal || !mayUseOfflineCache(error)) throw error; return local }
  })
}
