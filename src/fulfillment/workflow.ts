export type FulfillmentItemStatus = 'pending' | 'picked' | 'missing'

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
}

export type FulfillmentSession = {
  orderId: string
  status: 'in-progress' | 'completed'
  startedAt: string
  completedAt: string | null
  updatedAt: string
  /** Address/node selected before work starts. Empty string means the central entrance. */
  startAddress: string
  /** Last stop at which the worker confirmed arrival. */
  currentAddress: string
  stops: Record<string, FulfillmentStopProgress>
  items: Record<string, FulfillmentItemProgress>
}

export type FulfillmentProgress = {
  total: number
  handled: number
  picked: number
  missing: number
  pending: number
  percent: number
}

type CreateFulfillmentOptions = {
  addresses?: string[]
  startAddress?: string
  now?: string
}

const pendingStop = (): FulfillmentStopProgress => ({
  status: 'pending',
  arrivedAt: null,
  collectingAt: null,
  completedAt: null,
})

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
  return {
    orderId,
    status: 'in-progress',
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    startAddress,
    currentAddress: startAddress,
    stops: Object.fromEntries(uniqueAddresses(options.addresses ?? []).map((address) => [address, pendingStop()])),
    items: Object.fromEntries(rows.map((row) => [String(row), { status: 'pending', updatedAt: null }])),
  }
}

export function updateFulfillmentItem(session: FulfillmentSession, row: number, status: FulfillmentItemStatus, now = new Date().toISOString()): FulfillmentSession {
  const key = String(row)
  if (!(key in session.items)) throw new Error(`Строка ${row} отсутствует в сессии заказа`)
  if (session.status === 'completed') throw new Error('Завершённый заказ нельзя изменить')
  return {
    ...session,
    updatedAt: now,
    items: { ...session.items, [key]: { status, updatedAt: status === 'pending' ? null : now } },
  }
}

export function updateFulfillmentStop(
  session: FulfillmentSession,
  rawAddress: string,
  status: Exclude<FulfillmentStopStatus, 'pending'>,
  now = new Date().toISOString(),
): FulfillmentSession {
  if (session.status === 'completed') throw new Error('Завершённый заказ нельзя изменить')
  const address = normalizeAddress(rawAddress)
  const previous = session.stops[address] ?? pendingStop()
  const next: FulfillmentStopProgress = status === 'arrived'
    ? { status, arrivedAt: previous.arrivedAt ?? now, collectingAt: null, completedAt: null }
    : status === 'collecting'
      ? { status, arrivedAt: previous.arrivedAt ?? now, collectingAt: previous.collectingAt ?? now, completedAt: null }
      : { status, arrivedAt: previous.arrivedAt ?? now, collectingAt: previous.collectingAt ?? now, completedAt: now }
  return {
    ...session,
    currentAddress: address,
    updatedAt: now,
    stops: { ...session.stops, [address]: next },
  }
}

export function updateFulfillmentLocation(session: FulfillmentSession, rawAddress: string, now = new Date().toISOString()): FulfillmentSession {
  if (session.status === 'completed') throw new Error('Завершённый заказ нельзя изменить')
  return {
    ...session,
    currentAddress: normalizeAddress(rawAddress),
    updatedAt: now,
  }
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
  const itemsChanged = Object.keys(nextItems).length !== Object.keys(savedItems).length
    || Object.keys(nextItems).some((key) => !(key in savedItems))
  const stopsChanged = Object.keys(nextStops).length !== Object.keys(savedStops).length
    || Object.keys(nextStops).some((key) => !(key in savedStops))
  const changed = itemsChanged
    || stopsChanged
    || session.startAddress === undefined
    || session.currentAddress === undefined
    || session.stops === undefined
  return changed
    ? {
        ...session,
        status: itemsChanged || (hadSavedStops && stopsChanged) ? 'in-progress' : session.status,
        completedAt: itemsChanged || (hadSavedStops && stopsChanged) ? null : session.completedAt,
        updatedAt: now,
        startAddress,
        currentAddress,
        stops: nextStops,
        items: nextItems,
      }
    : session
}

export function getFulfillmentProgress(session: FulfillmentSession | null | undefined): FulfillmentProgress {
  const values = Object.values(session?.items ?? {})
  const picked = values.filter((item) => item.status === 'picked').length
  const missing = values.filter((item) => item.status === 'missing').length
  const handled = picked + missing
  const total = values.length
  return { total, handled, picked, missing, pending: total - handled, percent: total ? Math.round(handled / total * 100) : 0 }
}

export function completeFulfillmentSession(session: FulfillmentSession, now = new Date().toISOString()): FulfillmentSession {
  const progress = getFulfillmentProgress(session)
  if (!progress.total || progress.pending > 0) throw new Error('Сначала обработайте все позиции заказа')
  if (Object.values(session.stops ?? {}).some((stop) => stop.status !== 'completed')) {
    throw new Error('Сначала завершите все остановки маршрута')
  }
  return { ...session, status: 'completed', completedAt: now, updatedAt: now }
}
