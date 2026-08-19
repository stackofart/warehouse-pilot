import { AlertTriangle, Check, ChevronRight, ClipboardList, Clock3, Cuboid, Flag, MapPin, Navigation, PackageCheck, PackageX, Play, Route, Timer, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listOrders, type SavedOrder } from '../orders/storage'
import { optimizeOrderRoute } from '../routing/optimizer'
import type { RecognizedOrderItem } from '../recognition/ocr'
import { getFulfillmentSession, saveFulfillmentSession } from './storage'
import { completeFulfillmentSession, createFulfillmentSession, getFulfillmentProgress, reconcileFulfillmentSession, updateFulfillmentItem, type FulfillmentItemStatus, type FulfillmentSession } from './workflow'

type WorkflowStop = {
  address: string
  items: RecognizedOrderItem[]
  distanceFromPrevious: number | null
  unresolved: boolean
}

const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function formatTime(value: string | null | undefined) {
  return value ? timeFormatter.format(new Date(value)) : '—'
}

function formatDuration(start: string | undefined, end: string | null | undefined, now: number) {
  if (!start) return '0 мин'
  const milliseconds = Math.max(0, (end ? new Date(end).getTime() : now) - new Date(start).getTime())
  const minutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`
}

function buildWorkflowStops(order: SavedOrder): { stops: WorkflowStop[]; totalDistance: number | null; routeWarning: string } {
  const route = optimizeOrderRoute(order.items)
  const stops: WorkflowStop[] = []
  const includedRows = new Set<number>()
  let routeWarning = ''
  let totalDistance: number | null = null

  if (route.status === 'resolved' || route.status === 'partial') {
    totalDistance = route.totalDistance
    route.stops.forEach((stop) => {
      stop.items.forEach((item) => includedRows.add(item.row))
      stops.push({ address: stop.address, items: stop.items, distanceFromPrevious: stop.distanceFromPrevious, unresolved: false })
    })
    if (route.status === 'partial') routeWarning = `Часть адресов не имеет измеренной геометрии: ${route.unresolved.map((entry) => entry.address).join(', ')}`
  } else {
    routeWarning = route.status === 'invalid' ? 'Не удалось построить путь по измеренному графу' : 'У заказа нет адресов с измеренной геометрией'
  }

  const unresolvedGroups = new Map<string, RecognizedOrderItem[]>()
  order.items.filter((item) => !includedRows.has(item.row)).forEach((item) => {
    const address = item.address.trim().toUpperCase() || 'БЕЗ АДРЕСА'
    unresolvedGroups.set(address, [...(unresolvedGroups.get(address) ?? []), item])
  })
  for (const [address, items] of unresolvedGroups) stops.push({ address, items, distanceFromPrevious: null, unresolved: true })

  return { stops, totalDistance, routeWarning }
}

export function OrderWorkflow() {
  const hashOrderId = decodeURIComponent(window.location.hash.slice('#work/'.length))
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [selectedId, setSelectedId] = useState(hashOrderId)
  const [session, setSession] = useState<FulfillmentSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    listOrders().then((savedOrders) => {
      setOrders(savedOrders)
      if (savedOrders[0]) setSelectedId((current) => current || savedOrders[0].id)
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось открыть заказ')
    }).finally(() => setIsLoading(false))
  }, [])

  const order = orders.find((candidate) => candidate.id === selectedId) ?? orders[0]

  useEffect(() => {
    if (!order) {
      setSession(null)
      return
    }
    getFulfillmentSession(order.id).then(async (saved) => {
      if (!saved) {
        setSession(null)
        return
      }
      const reconciled = reconcileFulfillmentSession(saved, order.items.map((item) => item.row))
      setSession(reconciled)
      if (reconciled !== saved) await saveFulfillmentSession(reconciled)
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось загрузить прогресс заказа')
    })
  }, [order])

  useEffect(() => {
    if (session?.status !== 'in-progress') return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [session?.status])

  const route = useMemo(() => order ? buildWorkflowStops(order) : null, [order])
  const progress = getFulfillmentProgress(session)
  const currentStopIndex = route?.stops.findIndex((stop) => stop.items.some((item) => (session?.items[String(item.row)]?.status ?? 'pending') === 'pending')) ?? -1

  const selectOrder = (id: string) => {
    setSelectedId(id)
    setSession(null)
    setError('')
    window.location.hash = `work/${encodeURIComponent(id)}`
  }

  const startOrder = async () => {
    if (!order) return
    const next = createFulfillmentSession(order.id, order.items.map((item) => item.row))
    setIsSaving(true)
    try {
      await saveFulfillmentSession(next)
      setSession(next)
      setNow(Date.now())
    } catch (reason) {
      console.error(reason)
      setError('Не удалось начать комплектацию')
    } finally {
      setIsSaving(false)
    }
  }

  const setItemStatus = async (row: number, status: FulfillmentItemStatus) => {
    if (!session || session.status === 'completed') return
    const previous = session
    const currentStatus = session.items[String(row)]?.status ?? 'pending'
    const next = updateFulfillmentItem(session, row, currentStatus === status ? 'pending' : status)
    setSession(next)
    setIsSaving(true)
    try {
      await saveFulfillmentSession(next)
    } catch (reason) {
      console.error(reason)
      setSession(previous)
      setError('Не удалось сохранить отметку позиции')
    } finally {
      setIsSaving(false)
    }
  }

  const finishOrder = async () => {
    if (!session) return
    const previous = session
    setIsSaving(true)
    try {
      const next = completeFulfillmentSession(session)
      await saveFulfillmentSession(next)
      setSession(next)
      setNow(Date.now())
    } catch (reason) {
      console.error(reason)
      setSession(previous)
      setError(reason instanceof Error ? reason.message : 'Не удалось завершить заказ')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><p>Открываем заказ…</p></div></div>
  if (!order) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><strong>Нет сохранённых заказов</strong><a className="primary-button" href="#new-order">Создать заказ</a></div></div>

  return (
    <div className="page workflow-page">
      <div className="page-heading workflow-heading">
        <div><p className="eyebrow">РАБОЧИЙ РЕЖИМ</p><h1>Комплектация заказа</h1><p>Следуйте маршруту по остановкам и отмечайте результат каждой позиции.</p></div>
        <label className="order-selector"><span>Заказ</span><select aria-label="Заказ для комплектации" value={order.id} onChange={(event) => selectOrder(event.target.value)}>{orders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.orderNumber || 'Без номера'}</option>)}</select></label>
      </div>

      {error && <div className="order-import-feedback error workflow-error" role="alert">{error}</div>}

      <section className="workflow-overview">
        <div className="workflow-order-title"><span className={`workflow-status ${session?.status ?? 'not-started'}`}>{session?.status === 'completed' ? 'Завершён' : session ? 'В работе' : 'Не начат'}</span><h2>{order.orderNumber || 'Заказ без номера'}</h2><p dir="auto">{order.customer.name || 'Заказчик не указан'}</p></div>
        <div className="workflow-stat"><Clock3 size={17} /><span><small>Начало</small><strong>{formatTime(session?.startedAt)}</strong></span></div>
        <div className="workflow-stat"><Timer size={17} /><span><small>В работе</small><strong>{formatDuration(session?.startedAt, session?.completedAt, now)}</strong></span></div>
        <div className="workflow-stat"><Navigation size={17} /><span><small>Маршрут</small><strong>{route?.totalDistance === null ? 'частичный' : `${route?.totalDistance.toFixed(1)} м`}</strong></span></div>
        {!session ? <button className="primary-button workflow-main-action" disabled={isSaving} onClick={() => void startOrder()}><Play size={17} />Начать заказ</button> : session.status === 'completed' ? <div className="workflow-completed-time"><Flag size={18} /><span><small>Завершён в</small><strong>{formatTime(session.completedAt)}</strong></span></div> : <button className="primary-button workflow-main-action" disabled={isSaving || progress.pending > 0} onClick={() => void finishOrder()}><Flag size={17} />Завершить заказ</button>}
      </section>

      <section className="workflow-progress-card">
        <div><span><b>{progress.handled}</b> из {order.items.length} позиций</span><strong>{session ? progress.percent : 0}%</strong></div>
        <div className="workflow-progress-track"><span style={{ width: `${session ? progress.percent : 0}%` }} /></div>
        <ul><li className="picked"><Check size={12} />Собрано: {progress.picked}</li><li className="missing"><PackageX size={12} />Отсутствует: {progress.missing}</li><li>Осталось: {session ? progress.pending : order.items.length}</li></ul>
      </section>

      <div className="workflow-tools"><a className="secondary-button" href={`#route/${encodeURIComponent(order.id)}`}><Route size={15} />Расчёт и паллета</a><a className="secondary-button" href="#pallet"><Cuboid size={15} />3D-компоновка</a></div>

      {route?.routeWarning && <div className="optimization-warning workflow-route-warning"><AlertTriangle size={17} /><span>{route.routeWarning}. Такие позиции добавлены в конец как ручные остановки.</span></div>}

      <section className="workflow-timeline" aria-label="Остановки маршрута">
        {route?.stops.map((stop, index) => {
          const statuses = stop.items.map((item) => session?.items[String(item.row)]?.status ?? 'pending')
          const stopComplete = statuses.every((status) => status !== 'pending')
          const stopMissing = statuses.some((status) => status === 'missing')
          const active = Boolean(session) && session.status === 'in-progress' && index === currentStopIndex
          return (
            <article className={`workflow-stop ${stopComplete ? 'complete' : ''} ${stopMissing ? 'has-missing' : ''} ${active ? 'active' : ''} ${stop.unresolved ? 'unresolved' : ''}`} key={`${stop.address}-${index}`}>
              <div className="workflow-stop-marker">{stopComplete ? <Check size={17} /> : index + 1}</div>
              <div className="workflow-stop-card">
                <header><div><span className="workflow-stop-address"><MapPin size={15} />{stop.address}</span><h2>Остановка {index + 1}</h2></div><span className="workflow-stop-distance">{stop.distanceFromPrevious === null ? 'ручная точка' : `+${stop.distanceFromPrevious.toFixed(1)} м`}<ChevronRight size={14} /></span></header>
                <div className="workflow-stop-items">
                  {stop.items.map((item) => {
                    const status = session?.items[String(item.row)]?.status ?? 'pending'
                    return (
                      <div className={`workflow-pick-item ${status}`} key={item.row}>
                        <div className="workflow-item-copy"><b dir="auto">{item.description || `Позиция ${item.row}`}</b><span><strong>{item.boxCount || '?'} кор.</strong> · {item.quantity || '?'} шт. · מק״ט {item.sku || '—'}</span>{session?.items[String(item.row)]?.updatedAt && <small>Отмечено {formatTime(session.items[String(item.row)].updatedAt)}</small>}</div>
                        <div className="workflow-item-actions">
                          <button type="button" className="pick-button" disabled={!session || session.status === 'completed' || isSaving} aria-pressed={status === 'picked'} onClick={() => void setItemStatus(item.row, 'picked')}>{status === 'picked' ? <Undo2 size={15} /> : <PackageCheck size={15} />}{status === 'picked' ? 'Отменить' : 'Собрано'}</button>
                          <button type="button" className="missing-button" disabled={!session || session.status === 'completed' || isSaving} aria-pressed={status === 'missing'} onClick={() => void setItemStatus(item.row, 'missing')}>{status === 'missing' ? <Undo2 size={15} /> : <PackageX size={15} />}{status === 'missing' ? 'Отменить' : 'Нет товара'}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
