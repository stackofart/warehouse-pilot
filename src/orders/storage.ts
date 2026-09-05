import { emptyOrderSummary, formatRecognizedOrderText, type RecognizedOrderItem, type RecognizedOrderSummary } from '../recognition/ocr'
import { openDatabase, ORDERS_STORE, requestToPromise } from '../storage/database'
import { getStorageScope } from '../storage/database'
import { apiRequest, mayUseOfflineCache } from '../storage/apiClient'
import { fromServerOrder, toServerOrder, type ServerOrder } from './model'

export type SavedOrder = {
  assignedTo?: string | null
  assigneeName?: string
  status?: string
  version?: number
  source?: 'photo' | 'manual' | 'json' | 'legacy' | 'wms1'
  productSnapshots?: import('../products/storage').Product[]
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
  if (getStorageScope()) {
    const scope = getStorageScope()
    const response = await apiRequest<{ order: ServerOrder }>(`/api/orders/${encodeURIComponent(order.id)}`, { method: 'PUT', body: JSON.stringify(toServerOrder(order)) })
    const saved = fromServerOrder(response.order)
    await cacheOrders([saved], false, scope)
    return saved
  }
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
  const scope = getStorageScope()
  if (getStorageScope()) {
    try {
      const orders: SavedOrder[] = []
      for (let offset = 0; ; offset += 100) {
        const page = await apiRequest<{ items: ServerOrder[]; more: boolean }>(`/api/orders?offset=${offset}`)
        orders.push(...page.items.map(fromServerOrder))
        if (!page.more) break
      }
      await cacheOrders(orders, true, scope)
      return orders
    } catch (error) { if (!mayUseOfflineCache(error)) throw error }
  }
  const database = await openDatabase()
  try {
    const orders = await requestToPromise(database.transaction(ORDERS_STORE).objectStore(ORDERS_STORE).getAll()) as SavedOrder[]
    return orders.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } finally {
    database.close()
  }
}

async function cacheOrders(orders: SavedOrder[], replace: boolean, scope: string | null) {
  if (!scope || getStorageScope() !== scope) throw new Error('Пользователь изменился. Повторите вход.')
  const database = await openDatabase(false, scope)
  try {
    const tx = database.transaction(ORDERS_STORE, 'readwrite')
    if (replace) tx.objectStore(ORDERS_STORE).clear()
    orders.forEach(order => tx.objectStore(ORDERS_STORE).put(order))
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error) })
  } finally { database.close() }
}
