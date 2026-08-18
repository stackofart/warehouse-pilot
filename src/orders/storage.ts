import type { RecognizedCustomer, RecognizedOrderItem } from '../recognition/ocr'
import { openDatabase, ORDERS_STORE, requestToPromise } from '../storage/database'

export type SavedOrder = {
  id: string
  orderNumber: string
  customer: RecognizedCustomer
  items: RecognizedOrderItem[]
  rawText: string
  sourceFileName: string
  createdAt: string
  updatedAt: string
}

export async function saveOrder(order: Omit<SavedOrder, 'createdAt' | 'updatedAt'> & { createdAt?: string }) {
  const database = await openDatabase()
  const now = new Date().toISOString()
  const savedOrder: SavedOrder = {
    ...order,
    createdAt: order.createdAt ?? now,
    updatedAt: now,
  }

  return new Promise<SavedOrder>((resolve, reject) => {
    const transaction = database.transaction(ORDERS_STORE, 'readwrite')
    transaction.objectStore(ORDERS_STORE).put(savedOrder)
    transaction.oncomplete = () => {
      database.close()
      resolve(savedOrder)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Order could not be saved'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error('Order save was aborted'))
    }
  })
}

export async function listOrders() {
  const database = await openDatabase()
  try {
    const orders = await requestToPromise(database.transaction(ORDERS_STORE).objectStore(ORDERS_STORE).getAll()) as SavedOrder[]
    return orders.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } finally {
    database.close()
  }
}
