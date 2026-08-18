export const DATABASE_NAME = 'warehouse-pilot'
export const DATABASE_VERSION = 2
export const ORDERS_STORE = 'orders'
export const PRODUCTS_STORE = 'products'

export function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(ORDERS_STORE)) {
        const orders = database.createObjectStore(ORDERS_STORE, { keyPath: 'id' })
        orders.createIndex('orderNumber', 'orderNumber', { unique: false })
        orders.createIndex('updatedAt', 'updatedAt', { unique: false })
      }

      if (!database.objectStoreNames.contains(PRODUCTS_STORE)) {
        const products = database.createObjectStore(PRODUCTS_STORE, { keyPath: 'id' })
        products.createIndex('sku', 'sku', { unique: true })
        products.createIndex('barcode', 'barcode', { unique: true })
        products.createIndex('location', 'location', { unique: false })
        products.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'))
    request.onblocked = () => reject(new Error('Database upgrade is blocked by another tab'))
  })
}

export function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}
