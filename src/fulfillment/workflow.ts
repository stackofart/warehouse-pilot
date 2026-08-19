export type FulfillmentItemStatus = 'pending' | 'picked' | 'missing'

export type FulfillmentItemProgress = {
  status: FulfillmentItemStatus
  updatedAt: string | null
}

export type FulfillmentSession = {
  orderId: string
  status: 'in-progress' | 'completed'
  startedAt: string
  completedAt: string | null
  updatedAt: string
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

export function createFulfillmentSession(orderId: string, rows: number[], now = new Date().toISOString()): FulfillmentSession {
  return {
    orderId,
    status: 'in-progress',
    startedAt: now,
    completedAt: null,
    updatedAt: now,
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

export function reconcileFulfillmentSession(session: FulfillmentSession, rows: number[], now = new Date().toISOString()): FulfillmentSession {
  const nextItems = Object.fromEntries(rows.map((row) => {
    const key = String(row)
    return [key, session.items[key] ?? { status: 'pending', updatedAt: null }]
  }))
  const changed = Object.keys(nextItems).length !== Object.keys(session.items).length
    || Object.keys(nextItems).some((key) => !(key in session.items))
  return changed ? { ...session, status: 'in-progress', completedAt: null, updatedAt: now, items: nextItems } : session
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
  return { ...session, status: 'completed', completedAt: now, updatedAt: now }
}
