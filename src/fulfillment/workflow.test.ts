import { describe, expect, it } from 'vitest'
import { completeFulfillmentSession, createFulfillmentSession, getFulfillmentProgress, reconcileFulfillmentSession, updateFulfillmentItem } from './workflow'

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
})
