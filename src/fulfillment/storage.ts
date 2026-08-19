import { FULFILLMENT_STORE, openDatabase, requestToPromise } from '../storage/database'
import type { FulfillmentSession } from './workflow'

export async function getFulfillmentSession(orderId: string) {
  const database = await openDatabase()
  try {
    return await requestToPromise(database.transaction(FULFILLMENT_STORE).objectStore(FULFILLMENT_STORE).get(orderId)) as FulfillmentSession | undefined
  } finally {
    database.close()
  }
}

export async function listFulfillmentSessions() {
  const database = await openDatabase()
  try {
    return await requestToPromise(database.transaction(FULFILLMENT_STORE).objectStore(FULFILLMENT_STORE).getAll()) as FulfillmentSession[]
  } finally {
    database.close()
  }
}

export async function saveFulfillmentSession(session: FulfillmentSession) {
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
