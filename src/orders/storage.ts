import { emptyOrderSummary, formatRecognizedOrderText, type RecognizedOrderItem, type RecognizedOrderSummary } from '../recognition/ocr'
import { openDatabase, ORDERS_STORE, requestToPromise } from '../storage/database'

export type SavedOrder = {
  id: string
  orderNumber: string
  notes?: string
  /** Kept only so older IndexedDB records remain readable. New orders do not store customer data. */
  customer?: { name?: string; address?: string; city?: string; phone?: string; customerNumber?: string; raw?: string }
  summary?: RecognizedOrderSummary
  items: RecognizedOrderItem[]
  rawText: string
  sourceFileName?: string
  sourceFileNames?: string[]
  createdAt: string
  updatedAt: string
}

export async function saveOrder(order: Omit<SavedOrder, 'createdAt' | 'updatedAt'> & { createdAt?: string }) {
  const database = await openDatabase()
  const now = new Date().toISOString()
  const { customer: _legacyCustomer, ...safeOrder } = order
  const savedOrder: SavedOrder = {
    ...safeOrder,
    rawText: formatRecognizedOrderText(order.orderNumber, order.items, order.summary ?? emptyOrderSummary()),
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
