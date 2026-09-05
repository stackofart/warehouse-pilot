import { FULFILLMENT_STORE, openDatabase, requestToPromise } from '../storage/database'
import type { FulfillmentSession } from './workflow'
import { getStorageScope } from '../storage/database'
import { getSyncedSession, saveSyncedSession } from './sync'
import { listOrders } from '../orders/storage'
import { apiRequest, mayUseOfflineCache } from '../storage/apiClient'

export async function getFulfillmentSession(orderId: string) {
  if (getStorageScope()) return getSyncedSession(orderId)
  const database = await openDatabase()
  try {
    return await requestToPromise(database.transaction(FULFILLMENT_STORE).objectStore(FULFILLMENT_STORE).get(orderId)) as FulfillmentSession | undefined
  } finally {
    database.close()
  }
}

export async function listFulfillmentSessions() {
  if (getStorageScope()) {
    const orders = await listOrders()
    const database = await openDatabase()
    let local: FulfillmentSession[]
    try { local = await requestToPromise(database.transaction(FULFILLMENT_STORE).objectStore(FULFILLMENT_STORE).getAll()) } finally { database.close() }
    const allowed = new Set(orders.map(order => order.id))
    local = local.filter(session => allowed.has(session.orderId))
    try {
      const sessions = new Map<string, FulfillmentSession>()
      for (let offset = 0; ; offset += 50) {
        const page = await apiRequest<{ items: FulfillmentSession[]; more: boolean }>(`/api/picking-sessions?offset=${offset}`)
        for (const session of page.items) sessions.set(session.orderId, session)
        if (!page.more) break
      }
      for (const session of local) if (session.syncStatus && session.syncStatus !== 'synced') sessions.set(session.orderId, session)
      return [...sessions.values()]
    } catch (error) { if (!mayUseOfflineCache(error)) throw error; return local }
  }
  const database = await openDatabase()
  try {
    return await requestToPromise(database.transaction(FULFILLMENT_STORE).objectStore(FULFILLMENT_STORE).getAll()) as FulfillmentSession[]
  } finally {
    database.close()
  }
}

export async function saveFulfillmentSession(session: FulfillmentSession) {
  if (getStorageScope()) return saveSyncedSession(session)
  const database = await openDatabase()
  try {
    const transaction = database.transaction(FULFILLMENT_STORE, 'readwrite')
    transaction.objectStore(FULFILLMENT_STORE).put(session)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить прогресс заказа'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Сохранение прогресса отменено'))
    })
    return session
  } finally {
    database.close()
  }
}
