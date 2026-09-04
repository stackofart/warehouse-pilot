export type FulfillmentItemStatus = 'pending' | 'checking' | 'picked' | 'missing'

export type FulfillmentItemProgress = {
  status: FulfillmentItemStatus
  updatedAt: string | null
}

export type FulfillmentStopStatus = 'pending' | 'arrived' | 'collecting' | 'completed'

export type FulfillmentStopProgress = {
  status: FulfillmentStopStatus
  arrivedAt: string | null
  collectingAt: string | null
  completedAt: string | null
  travelStartedAt?: string | null
  fromAddress?: string
  distanceFromPreviousMeters?: number | null
}

export type FulfillmentEventType =
  | 'order_started'
  | 'location_changed'
  | 'finish_changed'
  | 'stop_arrived'
  | 'stop_collecting_started'
  | 'stop_completed'
  | 'item_status_changed'
  | 'items_bulk_picked'
  | 'order_paused'
  | 'order_resumed'
  | 'order_completed'

export type FulfillmentEvent = {
  id: string
  type: FulfillmentEventType
  at: string
  address?: string
  fromAddress?: string
  toAddress?: string
  row?: number
  rows?: number[]
  previousItemStatus?: FulfillmentItemStatus
  itemStatus?: FulfillmentItemStatus
  distanceMeters?: number | null
}

export type FulfillmentSession = {
  orderId: string
  /** Fast mode records exceptions and accepts untouched rows together on completion. */
  mode: 'route' | 'fast'
  status: 'in-progress' | 'paused' | 'completed'
  startedAt: string
  completedAt: string | null
  pausedAt: string | null
  totalPausedMs: number
  updatedAt: string
  /** Address/node selected before work starts. Empty string means the central entrance. */
  startAddress: string
  /** Last stop inferred from an item action or selected manually. */
  currentAddress: string
  /** Fixed loading gate visited after all picking stops. */
  finishAddress: string
  stops: Record<string, FulfillmentStopProgress>
  items: Record<string, FulfillmentItemProgress>
  /** Append-only action history used by future productivity statistics. */
  events: FulfillmentEvent[]
}

export type FulfillmentProgress = {
  total: number
  handled: number
  picked: number
  missing: number
  checking: number
  pending: number
  percent: number
}

type CreateFulfillmentOptions = {
  addresses?: string[]
  startAddress?: string
  finishAddress?: string
  now?: string
  mode?: 'route' | 'fast'
}

const pendingStop = (): FulfillmentStopProgress => ({
  status: 'pending',
  arrivedAt: null,
  collectingAt: null,
  completedAt: null,
})

function eventId(session: Pick<FulfillmentSession, 'events'>, type: FulfillmentEventType, at: string) {
  return `${at}:${type}:${session.events.length}`
}

function withEvent(session: FulfillmentSession, event: Omit<FulfillmentEvent, 'id'>): FulfillmentEvent[] {
  return [...session.events, { ...event, id: eventId(session, event.type, event.at) }]
}

function latestCompletedAt(session: FulfillmentSession, before: string) {
  const beforeTime = new Date(before).getTime()
  return Object.values(session.stops)
    .map((stop) => stop.completedAt)
    .filter((value): value is string => Boolean(value) && new Date(value!).getTime() <= beforeTime)
    .sort()
    .at(-1) ?? session.startedAt
}

const normalizeAddress = (address: string) => address.trim().toUpperCase()

function uniqueAddresses(addresses: string[]) {
  return [...new Set(addresses.map(normalizeAddress).filter(Boolean))]
}

export function createFulfillmentSession(
  orderId: string,
  rows: number[],
  optionsOrNow: CreateFulfillmentOptions | string = {},
): FulfillmentSession {
  const options = typeof optionsOrNow === 'string' ? { now: optionsOrNow } : optionsOrNow
  const now = options.now ?? new Date().toISOString()
  const startAddress = normalizeAddress(options.startAddress ?? '')
  const finishAddress = normalizeAddress(options.finishAddress ?? '40.D')
  const session: FulfillmentSession = {
    orderId,
    mode: options.mode ?? 'route',
    status: 'in-progress',
    startedAt: now,
    completedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    updatedAt: now,
    startAddress,
    currentAddress: startAddress,
    finishAddress,
    stops: Object.fromEntries(uniqueAddresses(options.addresses ?? []).map((address) => [address, pendingStop()])),
    items: Object.fromEntries(rows.map((row) => [String(row), { status: 'pending', updatedAt: null }])),
    events: [],
  }
  session.events = withEvent(session, { type: 'order_started', at: now, address: startAddress })
  return session
}

export function updateFulfillmentItem(session: FulfillmentSession, row: number, status: FulfillmentItemStatus, now = new Date().toISOString()): FulfillmentSession {
  const key = String(row)
  if (!(key in session.items)) throw new Error(`Строка ${row} отсутствует в сессии заказа`)
  assertSessionIsActive(session)
  return {
    ...session,
    updatedAt: now,
    items: { ...session.items, [key]: { status, updatedAt: status === 'pending' ? null : now } },
    events: withEvent(session, {
      type: 'item_status_changed',
      at: now,
      row,
      previousItemStatus: session.items[key].status,
      itemStatus: status,
    }),
  }
}

export type FulfillmentStopTransition = {
  fromAddress?: string
  distanceMeters?: number | null
  travelStartedAt?: string
}

export function updateFulfillmentStop(
  session: FulfillmentSession,
  rawAddress: string,
  status: Exclude<FulfillmentStopStatus, 'pending'>,
  now = new Date().toISOString(),
  transition: FulfillmentStopTransition = {},
): FulfillmentSession {
  assertSessionIsActive(session)
  const address = normalizeAddress(rawAddress)
  const previous = session.stops[address] ?? pendingStop()
  const travelStartedAt = previous.travelStartedAt ?? transition.travelStartedAt ?? latestCompletedAt(session, now)
  const fromAddress = previous.fromAddress ?? normalizeAddress(transition.fromAddress ?? session.currentAddress ?? session.startAddress)
  const distanceFromPreviousMeters = previous.distanceFromPreviousMeters ?? transition.distanceMeters ?? null
  const next: FulfillmentStopProgress = status === 'arrived'
    ? { status, arrivedAt: previous.arrivedAt ?? now, collectingAt: null, completedAt: null, travelStartedAt, fromAddress, distanceFromPreviousMeters }
    : status === 'collecting'
      ? { ...previous, status, arrivedAt: previous.arrivedAt ?? now, collectingAt: previous.collectingAt ?? now, completedAt: null, travelStartedAt, fromAddress, distanceFromPreviousMeters }
      : { ...previous, status, arrivedAt: previous.arrivedAt ?? now, collectingAt: previous.collectingAt ?? now, completedAt: now, travelStartedAt, fromAddress, distanceFromPreviousMeters }
  const eventType: FulfillmentEventType = status === 'arrived'
    ? 'stop_arrived'
    : status === 'collecting' ? 'stop_collecting_started' : 'stop_completed'
  return {
    ...session,
    currentAddress: address,
    updatedAt: now,
    stops: { ...session.stops, [address]: next },
    events: withEvent(session, {
      type: eventType,
      at: now,
      address,
      fromAddress,
      distanceMeters: distanceFromPreviousMeters,
    }),
  }
}

export function updateFulfillmentLocation(session: FulfillmentSession, rawAddress: string, now = new Date().toISOString()): FulfillmentSession {
  assertSessionIsActive(session)
  const nextAddress = normalizeAddress(rawAddress)
  return {
    ...session,
    currentAddress: nextAddress,
    updatedAt: now,
    events: withEvent(session, {
      type: 'location_changed',
      at: now,
      fromAddress: session.currentAddress,
      toAddress: nextAddress,
    }),
  }
}

export function updateFulfillmentFinish(session: FulfillmentSession, rawAddress: string, now = new Date().toISOString()): FulfillmentSession {
  assertSessionIsActive(session)
  const finishAddress = normalizeAddress(rawAddress)
  return {
    ...session,
    finishAddress,
    updatedAt: now,
    events: withEvent(session, {
      type: 'finish_changed',
      at: now,
      fromAddress: session.finishAddress,
      toAddress: finishAddress,
    }),
  }
}

function assertSessionIsActive(session: FulfillmentSession) {
  if (session.status === 'completed') throw new Error('Завершённый заказ нельзя изменить')
  if (session.status === 'paused') throw new Error('Заказ на паузе. Сначала продолжите работу')
}

export function arriveAndStartFulfillmentStop(
  session: FulfillmentSession,
  rawAddress: string,
  now = new Date().toISOString(),
  transition: FulfillmentStopTransition = {},
) {
  const arrived = updateFulfillmentStop(session, rawAddress, 'arrived', now, transition)
  return updateFulfillmentStop(arrived, rawAddress, 'collecting', now)
}

/**
 * Records the only action the picker has to make at a stop: the outcome for an
 * item. The first outcome starts the stop and the last handled item completes
 * it, while preserving the detailed events used by analytics.
 */
export function updateFulfillmentItemAtStop(
  session: FulfillmentSession,
  rawAddress: string,
  stopRows: number[],
  row: number,
  status: FulfillmentItemStatus,
  now = new Date().toISOString(),
  transition: FulfillmentStopTransition = {},
) {
  if (!stopRows.includes(row)) throw new Error(`Строка ${row} не относится к этой остановке`)
  assertSessionIsActive(session)
  const address = normalizeAddress(rawAddress)
  const stop = session.stops[address] ?? pendingStop()
  let next = session

  if (stop.status === 'pending') {
    next = arriveAndStartFulfillmentStop(next, address, now, transition)
  } else if (stop.status === 'arrived' || stop.status === 'completed') {
    next = updateFulfillmentStop(next, address, 'collecting', now, transition)
  }

  next = updateFulfillmentItem(next, row, status, now)
  const allItemsHandled = stopRows.every((stopRow) => {
    const itemStatus = next.items[String(stopRow)]?.status ?? 'pending'
    return itemStatus === 'picked' || itemStatus === 'missing'
  })

  if (allItemsHandled && next.stops[address]?.status !== 'completed') {
    next = updateFulfillmentStop(next, address, 'completed', now, transition)
  }
  return next
}

export function pauseFulfillmentSession(session: FulfillmentSession, now = new Date().toISOString()): FulfillmentSession {
  assertSessionIsActive(session)
  return {
    ...session,
    status: 'paused',
    pausedAt: now,
    updatedAt: now,
    events: withEvent(session, { type: 'order_paused', at: now }),
  }
}

export function resumeFulfillmentSession(session: FulfillmentSession, now = new Date().toISOString()): FulfillmentSession {
  if (session.status === 'completed') throw new Error('Завершённый заказ нельзя продолжить')
  if (session.status !== 'paused') return session
  const pauseStarted = session.pausedAt ? new Date(session.pausedAt).getTime() : new Date(now).getTime()
  const pauseEnded = new Date(now).getTime()
  return {
    ...session,
    status: 'in-progress',
    pausedAt: null,
    totalPausedMs: (session.totalPausedMs ?? 0) + Math.max(0, pauseEnded - pauseStarted),
    updatedAt: now,
    events: withEvent(session, { type: 'order_resumed', at: now }),
  }
}

function pausedIntervals(session: FulfillmentSession, until: number) {
  const intervals: Array<{ start: number; end: number }> = []
  let start: number | null = null
  for (const event of [...(session.events ?? [])].sort((left, right) => left.at.localeCompare(right.at))) {
    const at = new Date(event.at).getTime()
    if (!Number.isFinite(at)) continue
    if (event.type === 'order_paused' && start === null) start = at
    if (event.type === 'order_resumed' && start !== null) {
      intervals.push({ start, end: Math.max(start, at) })
      start = null
    }
  }
  if (start !== null) intervals.push({ start, end: Math.max(start, until) })
  return intervals
}

export function getFulfillmentActiveDurationBetween(
  session: FulfillmentSession,
  start: string | null | undefined,
  end: string | null | undefined,
  now = Date.now(),
) {
  if (!start) return 0
  const startTime = new Date(start).getTime()
  const endTime = end ? new Date(end).getTime() : now
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return 0
  const pausedMs = pausedIntervals(session, endTime).reduce((total, interval) => {
    const overlapStart = Math.max(startTime, interval.start)
    const overlapEnd = Math.min(endTime, interval.end)
    return total + Math.max(0, overlapEnd - overlapStart)
  }, 0)
  return Math.max(0, endTime - startTime - pausedMs)
}

export function getFulfillmentActiveDuration(session: FulfillmentSession, now = Date.now()) {
  return getFulfillmentActiveDurationBetween(session, session.startedAt, session.completedAt, now)
}

function migrateFulfillmentEvents(session: FulfillmentSession): FulfillmentEvent[] {
  if (session.events) return session.events
  const events: FulfillmentEvent[] = []
  const push = (event: Omit<FulfillmentEvent, 'id'>) => events.push({ ...event, id: `${event.at}:${event.type}:${events.length}` })
  push({ type: 'order_started', at: session.startedAt, address: normalizeAddress(session.startAddress ?? '') })
  for (const [address, stop] of Object.entries(session.stops ?? {})) {
    if (stop.arrivedAt) push({ type: 'stop_arrived', at: stop.arrivedAt, address, fromAddress: stop.fromAddress, distanceMeters: stop.distanceFromPreviousMeters })
    if (stop.collectingAt) push({ type: 'stop_collecting_started', at: stop.collectingAt, address })
    if (stop.completedAt) push({ type: 'stop_completed', at: stop.completedAt, address })
  }
  for (const [row, item] of Object.entries(session.items ?? {})) {
    if (item.updatedAt) push({ type: 'item_status_changed', at: item.updatedAt, row: Number(row), itemStatus: item.status })
  }
  if (session.completedAt) push({ type: 'order_completed', at: session.completedAt })
  return events.sort((left, right) => left.at.localeCompare(right.at))
}

export function reconcileFulfillmentSession(
  session: FulfillmentSession,
  rows: number[],
  addressesOrNow: string[] | string = [],
  reconciliationTime = new Date().toISOString(),
): FulfillmentSession {
  const addresses = typeof addressesOrNow === 'string' ? [] : addressesOrNow
  const now = typeof addressesOrNow === 'string' ? addressesOrNow : reconciliationTime
  const savedItems = session.items ?? {}
  const savedStops = session.stops ?? {}
  const events = migrateFulfillmentEvents(session)
  const hadSavedStops = session.stops !== undefined
  const nextItems = Object.fromEntries(rows.map((row) => {
    const key = String(row)
    return [key, savedItems[key] ?? { status: 'pending', updatedAt: null }]
  }))
  const migratedCompletedStop = (): FulfillmentStopProgress => ({
    status: 'completed',
    arrivedAt: session.startedAt,
    collectingAt: session.startedAt,
    completedAt: session.completedAt ?? session.updatedAt,
  })
  const nextStops = Object.fromEntries(uniqueAddresses(addresses).map((address) => [
    address,
    savedStops[address] ?? (session.status === 'completed' && !hadSavedStops ? migratedCompletedStop() : pendingStop()),
  ]))
  const startAddress = normalizeAddress(session.startAddress ?? '')
  const currentAddress = normalizeAddress(session.currentAddress ?? startAddress)
  const finishAddress = normalizeAddress(session.finishAddress ?? '40.D')
  const itemsChanged = Object.keys(nextItems).length !== Object.keys(savedItems).length
    || Object.keys(nextItems).some((key) => !(key in savedItems))
  const stopsChanged = Object.keys(nextStops).length !== Object.keys(savedStops).length
    || Object.keys(nextStops).some((key) => !(key in savedStops))
  const mustReopenCompletedSession = session.status === 'completed' && (itemsChanged || (hadSavedStops && stopsChanged))
  const changed = itemsChanged
    || stopsChanged
    || session.mode === undefined
    || session.startAddress === undefined
    || session.currentAddress === undefined
    || session.finishAddress === undefined
    || session.pausedAt === undefined
    || session.totalPausedMs === undefined
    || session.stops === undefined
    || session.events === undefined
  return changed
      ? {
        ...session,
        mode: session.mode ?? 'route',
        status: mustReopenCompletedSession ? 'in-progress' : session.status,
        completedAt: mustReopenCompletedSession ? null : session.completedAt,
        pausedAt: mustReopenCompletedSession ? null : (session.pausedAt ?? null),
        totalPausedMs: session.totalPausedMs ?? 0,
        updatedAt: now,
        startAddress,
        currentAddress,
        finishAddress,
        stops: nextStops,
        items: nextItems,
        events,
      }
    : session
}

export function getFulfillmentProgress(session: FulfillmentSession | null | undefined): FulfillmentProgress {
  const values = Object.values(session?.items ?? {})
  const picked = values.filter((item) => item.status === 'picked').length
  const missing = values.filter((item) => item.status === 'missing').length
  const checking = values.filter((item) => item.status === 'checking').length
  const handled = picked + missing
  const total = values.length
  return { total, handled, picked, missing, checking, pending: total - handled, percent: total ? Math.round(handled / total * 100) : 0 }
}

export function completeFulfillmentSession(session: FulfillmentSession, now = new Date().toISOString()): FulfillmentSession {
  assertSessionIsActive(session)
  const progress = getFulfillmentProgress(session)
  if (!progress.total || progress.pending > 0) throw new Error('Сначала обработайте все позиции заказа')
  if (Object.values(session.stops ?? {}).some((stop) => stop.status !== 'completed')) {
    throw new Error('Сначала завершите все остановки маршрута')
  }
  return {
    ...session,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
    events: withEvent(session, { type: 'order_completed', at: now }),
  }
}

/**
 * Completes the low-interaction picking flow. Explicit exceptions are kept,
 * while every untouched row is accepted as picked in one auditable event.
 */
export function completeFastFulfillmentSession(session: FulfillmentSession, now = new Date().toISOString()): FulfillmentSession {
  assertSessionIsActive(session)
  const checkingRows = Object.entries(session.items)
    .filter(([, item]) => item.status === 'checking')
    .map(([row]) => Number(row))
  if (checkingRows.length) throw new Error('Сначала завершите проверку отмеченных позиций')

  const rows = Object.entries(session.items)
    .filter(([, item]) => item.status === 'pending')
    .map(([row]) => Number(row))
  const items = { ...session.items }
  rows.forEach((row) => { items[String(row)] = { status: 'picked', updatedAt: now } })
  const accepted = rows.length
    ? { ...session, mode: 'fast' as const, items, updatedAt: now, events: withEvent(session, { type: 'items_bulk_picked', at: now, rows }) }
    : { ...session, mode: 'fast' as const, items, updatedAt: now }

  return {
    ...accepted,
    status: 'completed',
    completedAt: now,
    updatedAt: now,
    events: withEvent(accepted, { type: 'order_completed', at: now }),
  }
}
