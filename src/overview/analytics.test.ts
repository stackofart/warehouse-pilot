import { describe, expect, it } from 'vitest'
import {
  completeFulfillmentSession,
  createFulfillmentSession,
  pauseFulfillmentSession,
  resumeFulfillmentSession,
  updateFulfillmentItem,
  updateFulfillmentStop,
} from '../fulfillment/workflow'
import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'
import { calculateOverviewAnalytics } from './analytics'

const order: SavedOrder = {
  id: 'order-1',
  orderNumber: 'SO1',
  items: [{
    row: 1,
    address: '23.B',
    sku: '1511',
    barcode: '7290121920285',
    description: 'Test product',
    quantity: '24',
    unitsPerBox: '12',
    boxCount: '2',
    confidence: 100,
    warnings: [],
  }],
  rawText: '',
  createdAt: '2026-08-20T08:00:00.000Z',
  updatedAt: '2026-08-20T08:00:00.000Z',
}

const product: Product = {
  id: 'product-1',
  sku: '1511',
  barcode: '7290121920285',
  name: 'Test product from DB',
  location: '23.B',
  boxSpec: { lengthCm: 40, widthCm: 30, heightCm: 25, weightKg: 5 },
  createdAt: '2026-08-20T08:00:00.000Z',
  updatedAt: '2026-08-20T08:00:00.000Z',
}

function completedSession() {
  let session = createFulfillmentSession(order.id, [1], {
    addresses: ['23.B'],
    startAddress: '23.A',
    finishAddress: '40.A',
    now: '2026-08-20T08:00:00.000Z',
  })
  session = updateFulfillmentStop(session, '23.B', 'arrived', '2026-08-20T08:00:10.000Z', { distanceMeters: 2.4 })
  session = updateFulfillmentStop(session, '23.B', 'collecting', '2026-08-20T08:00:20.000Z')
  session = updateFulfillmentItem(session, 1, 'picked', '2026-08-20T08:00:45.000Z')
  session = updateFulfillmentStop(session, '23.B', 'completed', '2026-08-20T08:00:50.000Z')
  return completeFulfillmentSession(session, '2026-08-20T08:01:00.000Z')
}

describe('overview analytics', () => {
  it('combines order, product and fulfillment measurements', () => {
    const analytics = calculateOverviewAnalytics([order], [completedSession()], [product], { from: null, to: null })
    expect(analytics).toMatchObject({
      orders: 1,
      completedOrders: 1,
      positions: 1,
      boxes: 2,
      units: 24,
      totalWeightKg: 10,
      averageBoxesPerOrder: 2,
      averageUnitsPerOrder: 24,
      averageOrderMs: 60_000,
      averageCollectionMs: 30_000,
      averageTravelMs: 10_000,
      handledWeightKg: 10,
      weightCoveragePercent: 100,
    })
    expect(analytics.products[0]).toMatchObject({
      name: 'Test product from DB',
      orderCount: 1,
      boxes: 2,
      units: 24,
      weightKg: 10,
      estimatedCollectionMs: 30_000,
    })
    expect(analytics.heatmap[0]).toMatchObject({ address: '23.B', boxes: 2, orderCount: 1 })
    expect(analytics.loadDistanceKgM).toBeGreaterThan(0)
    expect(analytics.estimatedCalories).toBeGreaterThan(0)
  })

  it('filters orders by the fulfillment start date', () => {
    const analytics = calculateOverviewAnalytics([order], [completedSession()], [product], {
      from: new Date('2026-08-21T00:00:00.000Z').getTime(),
      to: null,
    })
    expect(analytics.orders).toBe(0)
    expect(analytics.products).toEqual([])
  })

  it('excludes pauses from order, travel and collection time', () => {
    let session = createFulfillmentSession(order.id, [1], {
      addresses: ['23.B'],
      startAddress: '23.A',
      finishAddress: '40.A',
      now: '2026-08-20T08:00:00.000Z',
    })
    session = pauseFulfillmentSession(session, '2026-08-20T08:00:05.000Z')
    session = resumeFulfillmentSession(session, '2026-08-20T08:00:15.000Z')
    session = updateFulfillmentStop(session, '23.B', 'arrived', '2026-08-20T08:00:20.000Z', { distanceMeters: 2.4 })
    session = updateFulfillmentStop(session, '23.B', 'collecting', '2026-08-20T08:00:20.000Z')
    session = pauseFulfillmentSession(session, '2026-08-20T08:00:30.000Z')
    session = resumeFulfillmentSession(session, '2026-08-20T08:00:40.000Z')
    session = updateFulfillmentItem(session, 1, 'picked', '2026-08-20T08:00:50.000Z')
    session = updateFulfillmentStop(session, '23.B', 'completed', '2026-08-20T08:00:50.000Z')
    session = completeFulfillmentSession(session, '2026-08-20T08:01:00.000Z')

    const analytics = calculateOverviewAnalytics([order], [session], [product], { from: null, to: null })
    expect(analytics.averageOrderMs).toBe(40_000)
    expect(analytics.averageTravelMs).toBe(10_000)
    expect(analytics.averageCollectionMs).toBe(20_000)
  })
})
