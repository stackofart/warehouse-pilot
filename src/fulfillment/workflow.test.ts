import { describe, expect, it } from 'vitest'
import {
  completeFulfillmentSession,
  createFulfillmentSession,
  getFulfillmentProgress,
  reconcileFulfillmentSession,
  updateFulfillmentItem,
  updateFulfillmentLocation,
  updateFulfillmentStop,
  type FulfillmentSession,
} from './workflow'

describe('order fulfillment workflow', () => {
  it('starts all order rows as pending and keeps the start time', () => {
    const session = createFulfillmentSession('order-1', [1, 2], '2026-08-19T08:00:00.000Z')
    expect(session).toMatchObject({ orderId: 'order-1', status: 'in-progress', startedAt: '2026-08-19T08:00:00.000Z' })
    expect(getFulfillmentProgress(session)).toEqual({ total: 2, handled: 0, picked: 0, missing: 0, pending: 2, percent: 0 })
  })

  it('tracks picked and missing positions with timestamps', () => {
    let session = createFulfillmentSession('order-1', [1, 2])
    session = updateFulfillmentItem(session, 1, 'picked', '2026-08-19T08:01:00.000Z')
    session = updateFulfillmentItem(session, 2, 'missing', '2026-08-19T08:02:00.000Z')
    expect(getFulfillmentProgress(session)).toEqual({ total: 2, handled: 2, picked: 1, missing: 1, pending: 0, percent: 100 })
    expect(session.items['2'].updatedAt).toBe('2026-08-19T08:02:00.000Z')
  })

  it('does not allow completion while a position is pending', () => {
    const session = createFulfillmentSession('order-1', [1, 2])
    expect(() => completeFulfillmentSession(session)).toThrow('Сначала обработайте все позиции заказа')
  })

  it('records order completion only after every position is handled', () => {
    let session = createFulfillmentSession('order-1', [1])
    session = updateFulfillmentItem(session, 1, 'picked')
    session = completeFulfillmentSession(session, '2026-08-19T08:10:00.000Z')
    expect(session).toMatchObject({ status: 'completed', completedAt: '2026-08-19T08:10:00.000Z' })
    expect(() => updateFulfillmentItem(session, 1, 'pending')).toThrow('Завершённый заказ нельзя изменить')
  })

  it('reconciles a saved session when order rows change', () => {
    let session = createFulfillmentSession('order-1', [1, 2])
    session = updateFulfillmentItem(session, 1, 'picked')
    const reconciled = reconcileFulfillmentSession(session, [1, 3], '2026-08-19T08:05:00.000Z')
    expect(reconciled.items['1'].status).toBe('picked')
    expect(reconciled.items['2']).toBeUndefined()
    expect(reconciled.items['3'].status).toBe('pending')
  })

  it('stores the selected start and timestamps every stop stage', () => {
    let session = createFulfillmentSession('order-1', [1], {
      addresses: ['25.A'],
      startAddress: '23.F',
      now: '2026-08-19T08:00:00.000Z',
    })
    expect(session).toMatchObject({ startAddress: '23.F', currentAddress: '23.F' })
    session = updateFulfillmentStop(session, '25.a', 'arrived', '2026-08-19T08:03:00.000Z')
    session = updateFulfillmentStop(session, '25.A', 'collecting', '2026-08-19T08:04:00.000Z')
    session = updateFulfillmentItem(session, 1, 'picked', '2026-08-19T08:06:00.000Z')
    session = updateFulfillmentStop(session, '25.A', 'completed', '2026-08-19T08:07:00.000Z')
    expect(session.currentAddress).toBe('25.A')
    expect(session.stops['25.A']).toEqual({
      status: 'completed',
      arrivedAt: '2026-08-19T08:03:00.000Z',
      collectingAt: '2026-08-19T08:04:00.000Z',
      completedAt: '2026-08-19T08:07:00.000Z',
    })
    expect(() => completeFulfillmentSession(session)).not.toThrow()
  })

  it('updates the actual location without changing a stop status', () => {
    const session = createFulfillmentSession('order-1', [1], { addresses: ['28.A'] })
    const moved = updateFulfillmentLocation(session, '25.a', '2026-08-19T08:02:00.000Z')
    expect(moved.currentAddress).toBe('25.A')
    expect(moved.stops['28.A'].status).toBe('pending')
  })

  it('migrates an old saved session without losing item progress', () => {
    const legacy = {
      orderId: 'order-1',
      status: 'in-progress',
      startedAt: '2026-08-19T08:00:00.000Z',
      completedAt: null,
      updatedAt: '2026-08-19T08:01:00.000Z',
      items: { '1': { status: 'picked', updatedAt: '2026-08-19T08:01:00.000Z' } },
    } as unknown as FulfillmentSession
    const migrated = reconcileFulfillmentSession(legacy, [1], ['25.A'], '2026-08-19T08:05:00.000Z')
    expect(migrated.items['1'].status).toBe('picked')
    expect(migrated.stops['25.A'].status).toBe('pending')
    expect(migrated.currentAddress).toBe('')
  })
})
