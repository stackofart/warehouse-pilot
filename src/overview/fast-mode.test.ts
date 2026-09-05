import { expect, it } from 'vitest'
import { calculateOverviewAnalytics } from './analytics'
import { createFulfillmentSession, completeFastFulfillmentSession } from '../fulfillment/workflow'
import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'
it('counts picked mass in fast mode from the order snapshot without inventing travel or per-product times', () => {
  const product: Product = { id: 'p', sku: '1000', barcode: '7290000000000', name: 'Beer', location: '23.F', boxSpec: { weightKg: 10 }, createdAt: '', updatedAt: '' }
  const order: SavedOrder = { id: 'o', orderNumber: 'SO1', rawText: '', createdAt: '2026-09-05T10:00:00Z', updatedAt: '', productSnapshots: [product], items: [{ row: 1, sku: product.sku, barcode: product.barcode, description: product.name, address: product.location, quantity: '24', boxCount: '2', unitsPerBox: '12', warnings: [], confidence: 100 }] }
  const session = completeFastFulfillmentSession(createFulfillmentSession('o', [1], { mode: 'fast', now: '2026-09-05T10:00:00Z', startAddress: '23.F', finishAddress: '40.D', addresses: ['23.F'] }), '2026-09-05T10:10:00Z')
  const result = calculateOverviewAnalytics([order], [session], [{ ...product, boxSpec: { weightKg: 100 } }], { from: null, to: null })
  expect(result.handledWeightKg).toBe(20)
  expect(result.totalWeightKg).toBe(20)
  expect(result.averageOrderMs).toBe(600000)
  expect(result.averageTravelMs).toBeNull()
  expect(result.averageCollectionMs).toBeNull()
  expect(result.totalDistanceMeters).toBe(0)
})
