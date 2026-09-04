import { describe, expect, it } from 'vitest'
import {
  arriveAndStartFulfillmentStop,
  completeFastFulfillmentSession,
  completeFulfillmentSession,
  createFulfillmentSession,
  getFulfillmentActiveDuration,
  getFulfillmentProgress,
  pauseFulfillmentSession,
  reconcileFulfillmentSession,
  resumeFulfillmentSession,
  updateFulfillmentItem,
  updateFulfillmentFinish,
  updateFulfillmentItemAtStop,
  updateFulfillmentLocation,
  updateFulfillmentStop,
  type FulfillmentSession,
} from './workflow'

describe('order fulfillment workflow', () => {
  it('starts all order rows as pending and keeps the start time', () => {
    const session = createFulfillmentSession('order-1', [1, 2], '2026-08-19T08:00:00.000Z')
    expect(session).toMatchObject({ orderId: 'order-1', status: 'in-progress', startedAt: '2026-08-19T08:00:00.000Z' })
    expect(getFulfillmentProgress(session)).toEqual({ total: 2, handled: 0, picked: 0, missing: 0, checking: 0, pending: 2, percent: 0 })
  })

  it('tracks picked and missing positions with timestamps', () => {
    let session = createFulfillmentSession('order-1', [1, 2])
    session = updateFulfillmentItem(session, 1, 'picked', '2026-08-19T08:01:00.000Z')
    session = updateFulfillmentItem(session, 2, 'missing', '2026-08-19T08:02:00.000Z')
    expect(getFulfillmentProgress(session)).toEqual({ total: 2, handled: 2, picked: 1, missing: 1, checking: 0, pending: 0, percent: 100 })
    expect(session.items['2'].updatedAt).toBe('2026-08-19T08:02:00.000Z')
  })

  it('does not allow completion while a position is pending', () => {
    const session = createFulfillmentSession('order-1', [1, 2])
    expect(() => completeFulfillmentSession(session)).toThrow('Сначала обработайте все позиции заказа')
  })

  it('keeps a position unresolved while it is being checked', () => {
    let session = createFulfillmentSession('order-1', [1])
    session = updateFulfillmentItem(session, 1, 'checking', '2026-08-19T08:01:00.000Z')
    expect(getFulfillmentProgress(session)).toMatchObject({ handled: 0, checking: 1, pending: 1, percent: 0 })
    expect(() => completeFulfillmentSession(session)).toThrow('Сначала обработайте все позиции заказа')
  })

  it('records order completion only after every position is handled', () => {
    let session = createFulfillmentSession('order-1', [1])
    session = updateFulfillmentItem(session, 1, 'picked')
    session = completeFulfillmentSession(session, '2026-08-19T08:10:00.000Z')
    expect(session).toMatchObject({ status: 'completed', completedAt: '2026-08-19T08:10:00.000Z' })
    expect(() => updateFulfillmentItem(session, 1, 'pending')).toThrow('Завершённый заказ нельзя изменить')
  })

  it('finishes fast picking by accepting untouched rows in one event', () => {
    let session = createFulfillmentSession('order-1', [1, 2, 3], { mode: 'fast', now: '2026-08-19T08:00:00.000Z' })
    session = updateFulfillmentItem(session, 2, 'missing', '2026-08-19T08:02:00.000Z')
    const completed = completeFastFulfillmentSession(session, '2026-08-19T08:10:00.000Z')

    expect(completed).toMatchObject({ mode: 'fast', status: 'completed', completedAt: '2026-08-19T08:10:00.000Z' })
    expect(completed.items['1']).toEqual({ status: 'picked', updatedAt: '2026-08-19T08:10:00.000Z' })
    expect(completed.items['2'].status).toBe('missing')
    expect(completed.items['3'].status).toBe('picked')
    expect(completed.events.slice(-2)).toMatchObject([
      { type: 'items_bulk_picked', rows: [1, 3] },
      { type: 'order_completed' },
    ])
  })

  it('does not finish fast picking while an exception is being checked', () => {
    let session = createFulfillmentSession('order-1', [1], { mode: 'fast' })
    session = updateFulfillmentItem(session, 1, 'checking')
    expect(() => completeFastFulfillmentSession(session)).toThrow('Сначала завершите проверку')
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
      finishAddress: '40.B',
      now: '2026-08-19T08:00:00.000Z',
    })
    expect(session).toMatchObject({ startAddress: '23.F', currentAddress: '23.F', finishAddress: '40.B' })
    session = updateFulfillmentStop(session, '25.a', 'arrived', '2026-08-19T08:03:00.000Z', { distanceMeters: 12.4 })
    session = updateFulfillmentStop(session, '25.A', 'collecting', '2026-08-19T08:04:00.000Z')
    session = updateFulfillmentItem(session, 1, 'picked', '2026-08-19T08:06:00.000Z')
    session = updateFulfillmentStop(session, '25.A', 'completed', '2026-08-19T08:07:00.000Z')
    expect(session.currentAddress).toBe('25.A')
    expect(session.stops['25.A']).toEqual({
      status: 'completed',
      arrivedAt: '2026-08-19T08:03:00.000Z',
      collectingAt: '2026-08-19T08:04:00.000Z',
      completedAt: '2026-08-19T08:07:00.000Z',
      travelStartedAt: '2026-08-19T08:00:00.000Z',
      fromAddress: '23.F',
      distanceFromPreviousMeters: 12.4,
    })
    expect(session.events.map((event) => event.type)).toEqual([
      'order_started', 'stop_arrived', 'stop_collecting_started', 'item_status_changed', 'stop_completed',
    ])
    expect(session.events[1]).toMatchObject({ address: '25.A', fromAddress: '23.F', distanceMeters: 12.4 })
    expect(() => completeFulfillmentSession(session)).not.toThrow()
  })

  it('updates the actual location without changing a stop status', () => {
    const session = createFulfillmentSession('order-1', [1], { addresses: ['28.A'] })
    const moved = updateFulfillmentLocation(session, '25.a', '2026-08-19T08:02:00.000Z')
    expect(moved.currentAddress).toBe('25.A')
    expect(moved.stops['28.A'].status).toBe('pending')
    expect(moved.events.at(-1)).toMatchObject({ type: 'location_changed', fromAddress: '', toAddress: '25.A' })
  })

  it('records arrival and collection start as one stop action', () => {
    const session = createFulfillmentSession('order-1', [1], { addresses: ['25.A'], startAddress: '23.F' })
    const collecting = arriveAndStartFulfillmentStop(session, '25.A', '2026-08-19T08:03:00.000Z', { distanceMeters: 12.4 })
    expect(collecting.stops['25.A']).toMatchObject({
      status: 'collecting',
      arrivedAt: '2026-08-19T08:03:00.000Z',
      collectingAt: '2026-08-19T08:03:00.000Z',
      distanceFromPreviousMeters: 12.4,
    })
    expect(collecting.events.slice(-2).map((event) => event.type)).toEqual(['stop_arrived', 'stop_collecting_started'])
  })

  it('starts and completes a stop automatically from item outcomes', () => {
    let session = createFulfillmentSession('order-1', [1, 2], {
      addresses: ['25.A'],
      startAddress: '23.F',
      now: '2026-08-19T08:00:00.000Z',
    })
    session = updateFulfillmentItemAtStop(
      session,
      '25.A',
      [1, 2],
      1,
      'picked',
      '2026-08-19T08:03:00.000Z',
      { distanceMeters: 12.4 },
    )
    expect(session.stops['25.A']).toMatchObject({
      status: 'collecting',
      arrivedAt: '2026-08-19T08:03:00.000Z',
      collectingAt: '2026-08-19T08:03:00.000Z',
      completedAt: null,
    })

    session = updateFulfillmentItemAtStop(session, '25.A', [1, 2], 2, 'missing', '2026-08-19T08:05:00.000Z')
    expect(session.stops['25.A']).toMatchObject({ status: 'completed', completedAt: '2026-08-19T08:05:00.000Z' })
    expect(session.currentAddress).toBe('25.A')
    expect(session.events.map((event) => event.type)).toEqual([
      'order_started',
      'stop_arrived',
      'stop_collecting_started',
      'item_status_changed',
      'item_status_changed',
      'stop_completed',
    ])
  })

  it('reopens an automatically completed stop when an outcome is undone', () => {
    let session = createFulfillmentSession('order-1', [1], { addresses: ['25.A'] })
    session = updateFulfillmentItemAtStop(session, '25.A', [1], 1, 'picked', '2026-08-19T08:03:00.000Z')
    expect(session.stops['25.A'].status).toBe('completed')

    session = updateFulfillmentItemAtStop(session, '25.A', [1], 1, 'pending', '2026-08-19T08:04:00.000Z')
    expect(session.stops['25.A']).toMatchObject({ status: 'collecting', completedAt: null })
    expect(session.items['1']).toEqual({ status: 'pending', updatedAt: null })
  })

  it('pauses active timing and prevents work until the order is resumed', () => {
    let session = createFulfillmentSession('order-1', [1], '2026-08-19T08:00:00.000Z')
    session = pauseFulfillmentSession(session, '2026-08-19T08:01:00.000Z')
    expect(session).toMatchObject({ status: 'paused', pausedAt: '2026-08-19T08:01:00.000Z' })
    expect(getFulfillmentActiveDuration(session, new Date('2026-08-19T08:04:00.000Z').getTime())).toBe(60_000)
    expect(() => updateFulfillmentItem(session, 1, 'checking')).toThrow('Заказ на паузе')

    session = resumeFulfillmentSession(session, '2026-08-19T08:04:00.000Z')
    expect(session).toMatchObject({ status: 'in-progress', pausedAt: null, totalPausedMs: 180_000 })
    expect(getFulfillmentActiveDuration(session, new Date('2026-08-19T08:05:00.000Z').getTime())).toBe(120_000)
    expect(session.events.slice(-2).map((event) => event.type)).toEqual(['order_paused', 'order_resumed'])
  })

  it('stores a changed loading gate in the action history', () => {
    const session = createFulfillmentSession('order-1', [1], { finishAddress: '40.A' })
    const changed = updateFulfillmentFinish(session, '40.b', '2026-08-19T08:02:05.000Z')
    expect(changed.finishAddress).toBe('40.B')
    expect(changed.events.at(-1)).toMatchObject({
      type: 'finish_changed',
      at: '2026-08-19T08:02:05.000Z',
      fromAddress: '40.A',
      toAddress: '40.B',
    })
  })

  it('keeps every item action for later statistics instead of overwriting history', () => {
    let session = createFulfillmentSession('order-1', [1], '2026-08-19T08:00:00.000Z')
    session = updateFulfillmentItem(session, 1, 'picked', '2026-08-19T08:01:01.000Z')
    session = updateFulfillmentItem(session, 1, 'pending', '2026-08-19T08:01:07.000Z')
    session = updateFulfillmentItem(session, 1, 'missing', '2026-08-19T08:01:11.000Z')
    const actions = session.events.filter((event) => event.type === 'item_status_changed')
    expect(actions).toHaveLength(3)
    expect(actions.map((event) => event.itemStatus)).toEqual(['picked', 'pending', 'missing'])
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
    expect(migrated.finishAddress).toBe('40.D')
    expect(migrated.events.map((event) => event.type)).toEqual(['order_started', 'item_status_changed'])
  })
})
