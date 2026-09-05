import type { SavedOrder } from '../orders/storage'
import type { Product } from './storage'
import { matchSharedProducts } from './sharedApi'
import { openDatabase, PRODUCTS_STORE, requestToPromise } from '../storage/database'
import { mayUseOfflineCache } from '../storage/apiClient'

export async function productsForOrders(orders: SavedOrder[]): Promise<Product[]> {
  const snapshots = orders.flatMap(order => order.productSnapshots || [])
  const db = await openDatabase()
  try {
    let products: Product[]
    try {
      products = await matchSharedProducts(orders.flatMap(order => order.items))
      const tx = db.transaction(PRODUCTS_STORE, 'readwrite')
      // Cache only selected/order products, never an administrative bulk response.
      for (const product of products) tx.objectStore(PRODUCTS_STORE).put(product)
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error) })
    } catch (error) {
      if (!mayUseOfflineCache(error)) throw error
      products = await requestToPromise(db.transaction(PRODUCTS_STORE).objectStore(PRODUCTS_STORE).getAll()) as Product[]
    }
    return [...new Map([...snapshots, ...products].map(product => [product.id, product])).values()]
  } finally { db.close() }
}
