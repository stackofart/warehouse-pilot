import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Barcode,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock3,
  Cuboid,
  Flag,
  Info,
  MapPin,
  Navigation,
  PackageCheck,
  PackageOpen,
  PackageX,
  Play,
  Route,
  ShieldCheck,
  Timer,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listOrders, type SavedOrder } from '../orders/storage'
import { isProductVerified, listProducts, type Product } from '../products/storage'
import type { RecognizedOrderItem } from '../recognition/ocr'
import { optimizeOrderRoute } from '../routing/optimizer'
import { buildWarehouseGraph } from '../warehouse/graph'
import { getFulfillmentSession, saveFulfillmentSession } from './storage'
import {
  completeFulfillmentSession,
  createFulfillmentSession,
  getFulfillmentProgress,
  reconcileFulfillmentSession,
  updateFulfillmentItem,
  updateFulfillmentLocation,
  updateFulfillmentStop,
  type FulfillmentItemStatus,
  type FulfillmentSession,
  type FulfillmentStopStatus,
} from './workflow'

type WorkflowStop = {
  address: string
  items: RecognizedOrderItem[]
  distanceFromPrevious: number | null
  unresolved: boolean
  historical: boolean
}

type WorkflowRoute = {
  stops: WorkflowStop[]
  totalDistance: number | null
  routeWarning: string
}

const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const CENTRAL_START_LABEL = 'Центральный вход'

function orderIdFromHash() {
  const encodedId = window.location.hash.match(/^#(?:work|route)\/(.+)$/)?.[1] ?? ''
  try {
    return decodeURIComponent(encodedId)
  } catch {
    return ''
  }
}

function normalizeAddress(value: string) {
  return value.trim().toUpperCase()
}

function itemAddress(item: RecognizedOrderItem) {
  return normalizeAddress(item.address) || 'БЕЗ АДРЕСА'
}

function uniqueOrderAddresses(order: SavedOrder) {
  return [...new Set(order.items.map(itemAddress))]
}

function formatTime(value: string | null | undefined) {
  return value ? timeFormatter.format(new Date(value)) : '—'
}

function durationMilliseconds(start: string | null | undefined, end: string | null | undefined, now: number) {
  if (!start) return 0
  return Math.max(0, (end ? new Date(end).getTime() : now) - new Date(start).getTime())
}

function formatMilliseconds(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`
}

function formatDuration(start: string | null | undefined, end: string | null | undefined, now: number) {
  return formatMilliseconds(durationMilliseconds(start, end, now))
}

function formatPhysicalSpec(spec: Product['boxSpec'] | Product['itemSpec']) {
  if (!spec) return 'нет данных'
  const dimensions = [spec.lengthCm, spec.widthCm, spec.heightCm]
  const size = dimensions.every((value) => Number(value) > 0) ? `${dimensions.join(' × ')} см` : 'габариты не указаны'
  return spec.weightKg ? `${size}, ${spec.weightKg} кг` : size
}

function buildWorkflowStops(order: SavedOrder, session: FulfillmentSession | null, draftStartAddress: string): WorkflowRoute {
  const itemsByAddress = new Map<string, RecognizedOrderItem[]>()
  order.items.forEach((item) => itemsByAddress.set(itemAddress(item), [...(itemsByAddress.get(itemAddress(item)) ?? []), item]))

  const completedAddresses = Object.entries(session?.stops ?? {})
    .filter(([, progress]) => progress.status === 'completed')
    .sort((left, right) => (left[1].completedAt ?? '').localeCompare(right[1].completedAt ?? ''))
    .map(([address]) => address)
  const completedSet = new Set(completedAddresses)
  const completedStops: WorkflowStop[] = completedAddresses
    .filter((address) => itemsByAddress.has(address))
    .map((address) => ({ address, items: itemsByAddress.get(address)!, distanceFromPrevious: null, unresolved: false, historical: true }))
  const remainingItems = order.items.filter((item) => !completedSet.has(itemAddress(item)))
  if (!remainingItems.length) return { stops: completedStops, totalDistance: 0, routeWarning: '' }

  const startAddress = session?.currentAddress || session?.startAddress || draftStartAddress
  const route = optimizeOrderRoute(remainingItems, { startAddress })
  const plannedStops: WorkflowStop[] = []
  const includedRows = new Set<number>()
  let routeWarning = ''
  let totalDistance: number | null = null

  if (route.status === 'resolved' || route.status === 'partial') {
    totalDistance = route.totalDistance
    route.stops.forEach((stop) => {
      stop.items.forEach((item) => includedRows.add(item.row))
      plannedStops.push({ address: stop.address, items: stop.items, distanceFromPrevious: stop.distanceFromPrevious, unresolved: false, historical: false })
    })
    if (route.status === 'partial') routeWarning = `Часть адресов не имеет измеренной геометрии: ${route.unresolved.map((entry) => entry.address).join(', ')}`
  } else if (route.status === 'invalid' && route.reason === 'START_ADDRESS_UNRESOLVED') {
    routeWarning = `Для фактической точки ${startAddress} нет измеренной геометрии. Укажите ближайшую измеренную точку.`
  } else {
    routeWarning = route.status === 'invalid' ? 'Не удалось построить путь по измеренному графу' : 'У заказа нет адресов с измеренной геометрией'
  }

  const unresolvedGroups = new Map<string, RecognizedOrderItem[]>()
  remainingItems.filter((item) => !includedRows.has(item.row)).forEach((item) => {
    const address = itemAddress(item)
    unresolvedGroups.set(address, [...(unresolvedGroups.get(address) ?? []), item])
  })
  for (const [address, items] of unresolvedGroups) {
    plannedStops.push({ address, items, distanceFromPrevious: null, unresolved: true, historical: false })
  }

  return { stops: [...completedStops, ...plannedStops], totalDistance, routeWarning }
}

function stopStatusLabel(status: FulfillmentStopStatus) {
  if (status === 'arrived') return 'Прибыл'
  if (status === 'collecting') return 'Идёт сборка'
  if (status === 'completed') return 'Завершена'
  return 'В пути'
}

function travelStartForStop(session: FulfillmentSession, arrivedAt: string | null) {
  if (!arrivedAt) return session.startedAt
  const arrivalTime = new Date(arrivedAt).getTime()
  return Object.values(session.stops)
    .map((stop) => stop.completedAt)
    .filter((value): value is string => Boolean(value) && new Date(value!).getTime() <= arrivalTime)
    .sort()
    .at(-1) ?? session.startedAt
}

function chunkStops(stops: WorkflowStop[], size = 4) {
  const chunks: WorkflowStop[][] = []
  for (let index = 0; index < stops.length; index += size) chunks.push(stops.slice(index, index + size))
  return chunks
}

function scrollToStop(address: string) {
  document.getElementById(`workflow-stop-${encodeURIComponent(address)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export function OrderWorkflow() {
  const hashOrderId = orderIdFromHash()
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedId, setSelectedId] = useState(hashOrderId)
  const [session, setSession] = useState<FulfillmentSession | null>(null)
  const [startAddress, setStartAddress] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isSessionLoading, setIsSessionLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    Promise.all([listOrders(), listProducts()]).then(([savedOrders, savedProducts]) => {
      setOrders(savedOrders)
      setProducts(savedProducts)
      if (savedOrders[0]) setSelectedId((current) => current || savedOrders[0].id)
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось открыть заказ')
    }).finally(() => setIsLoading(false))
  }, [])

  const order = orders.find((candidate) => candidate.id === selectedId) ?? orders[0]

  useEffect(() => {
    let cancelled = false
    setExpandedRows(new Set())
    if (!order) {
      setSession(null)
      setIsSessionLoading(false)
      return () => { cancelled = true }
    }
    setIsSessionLoading(true)
    getFulfillmentSession(order.id).then(async (saved) => {
      if (cancelled) return
      if (!saved) {
        setSession(null)
        setStartAddress('')
        return
      }
      const reconciled = reconcileFulfillmentSession(saved, order.items.map((item) => item.row), uniqueOrderAddresses(order))
      setSession(reconciled)
      setStartAddress(reconciled.startAddress)
      if (reconciled !== saved) await saveFulfillmentSession(reconciled)
    }).catch((reason) => {
      console.error(reason)
      if (!cancelled) setError('Не удалось загрузить прогресс заказа')
    }).finally(() => {
      if (!cancelled) setIsSessionLoading(false)
    })
    return () => { cancelled = true }
  }, [order])

  useEffect(() => {
    if (session?.status !== 'in-progress') return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [session?.status])

  const warehouseAddresses = useMemo(() => {
    const result = buildWarehouseGraph()
    if (result.status !== 'ok') return []
    return [...result.graph.nodes.values()]
      .filter((node) => node.kind === 'address' && node.address)
      .map((node) => node.address!)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  }, [])
  const productsByBarcode = useMemo(() => new Map(products.filter((product) => product.barcode).map((product) => [product.barcode.replace(/\D/g, ''), product])), [products])
  const productsBySku = useMemo(() => new Map(products.filter((product) => product.sku).map((product) => [product.sku.replace(/\D/g, ''), product])), [products])
  const route = useMemo(() => order ? buildWorkflowStops(order, session, startAddress) : null, [order, session, startAddress])
  const progress = getFulfillmentProgress(session)
  const firstPendingStopIndex = route?.stops.findIndex((stop) => (session?.stops[stop.address]?.status ?? 'pending') !== 'completed') ?? -1
  const routeRows = useMemo(() => chunkStops(route?.stops ?? []), [route])

  const selectOrder = (id: string) => {
    setSelectedId(id)
    setSession(null)
    setError('')
    window.location.hash = `work/${encodeURIComponent(id)}`
  }

  const persistSession = async (next: FulfillmentSession, previous: FulfillmentSession | null, failureMessage: string) => {
    setSession(next)
    setIsSaving(true)
    try {
      await saveFulfillmentSession(next)
      setNow(Date.now())
    } catch (reason) {
      console.error(reason)
      setSession(previous)
      setError(failureMessage)
    } finally {
      setIsSaving(false)
    }
  }

  const startOrder = async () => {
    if (!order) return
    const next = createFulfillmentSession(order.id, order.items.map((item) => item.row), {
      addresses: uniqueOrderAddresses(order),
      startAddress,
    })
    await persistSession(next, session, 'Не удалось начать комплектацию')
  }

  const setCurrentLocation = async (address: string) => {
    if (!session || session.status === 'completed') return
    await persistSession(updateFulfillmentLocation(session, address), session, 'Не удалось сохранить текущую точку')
  }

  const setStopStatus = async (stop: WorkflowStop, status: Exclude<FulfillmentStopStatus, 'pending'>) => {
    if (!session || session.status === 'completed') return
    if (status === 'completed' && stop.items.some((item) => (session.items[String(item.row)]?.status ?? 'pending') === 'pending')) {
      setError('Сначала отметьте все товары на этой остановке')
      return
    }
    setError('')
    await persistSession(updateFulfillmentStop(session, stop.address, status), session, 'Не удалось сохранить статус остановки')
  }

  const setItemStatus = async (row: number, status: FulfillmentItemStatus) => {
    if (!session || session.status === 'completed') return
    const currentStatus = session.items[String(row)]?.status ?? 'pending'
    const next = updateFulfillmentItem(session, row, currentStatus === status ? 'pending' : status)
    await persistSession(next, session, 'Не удалось сохранить отметку позиции')
  }

  const finishOrder = async () => {
    if (!session) return
    setIsSaving(true)
    try {
      const next = completeFulfillmentSession(session)
      await saveFulfillmentSession(next)
      setSession(next)
      setNow(Date.now())
    } catch (reason) {
      console.error(reason)
      setError(reason instanceof Error ? reason.message : 'Не удалось завершить заказ')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleRowDetails = (row: number) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  if (isLoading) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><p>Открываем заказ…</p></div></div>
  if (!order) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><strong>Нет сохранённых заказов</strong><a className="primary-button" href="#new-order">Создать заказ</a></div></div>

  return (
    <div className="page workflow-page">
      <div className="page-heading workflow-heading">
        <div><p className="eyebrow">РАБОЧИЙ РЕЖИМ</p><h1>Заказ: маршрут и сборка</h1><p>Маршрут перестраивается от выбранной фактической точки после каждого прибытия.</p></div>
        <label className="order-selector"><span>Заказ</span><select aria-label="Заказ для комплектации" value={order.id} onChange={(event) => selectOrder(event.target.value)}>{orders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.orderNumber || 'Без номера'}</option>)}</select></label>
      </div>

      {error && <div className="order-import-feedback error workflow-error" role="alert">{error}</div>}

      <nav className="workflow-order-navigation" aria-label="Разделы заказа">
        <a className="secondary-button" href="#orders"><ClipboardList size={15} />Все заказы</a>
        <a className="active" aria-current="page" href={`#work/${encodeURIComponent(order.id)}`}><Route size={15} />Маршрут и сборка</a>
        <a className="secondary-button" href={`#pallet/${encodeURIComponent(order.id)}`}><Cuboid size={15} />Паллета</a>
      </nav>

      <section className="workflow-overview">
        <div className="workflow-order-title"><span className={`workflow-status ${session?.status ?? 'not-started'}`}>{session?.status === 'completed' ? 'Завершён' : session ? 'В работе' : 'Не начат'}</span><h2>{order.orderNumber || 'Заказ без номера'}</h2><p>{order.items.length} позиций в заказе</p></div>
        <div className="workflow-stat"><Clock3 size={17} /><span><small>Начало</small><strong>{formatTime(session?.startedAt)}</strong></span></div>
        <div className="workflow-stat"><Timer size={17} /><span><small>В работе</small><strong>{formatDuration(session?.startedAt, session?.completedAt, now)}</strong></span></div>
        <div className="workflow-stat"><Navigation size={17} /><span><small>Осталось пройти</small><strong>{route?.totalDistance === null ? 'частично' : `${route?.totalDistance.toFixed(1)} м`}</strong></span></div>
        {!session ? (
          <div className="workflow-start-action">
            <label><span>Стартовая точка</span><select aria-label="Стартовая точка заказа" value={startAddress} onChange={(event) => setStartAddress(event.target.value)}><option value="">{CENTRAL_START_LABEL}</option>{warehouseAddresses.map((address) => <option key={address} value={address}>{address}</option>)}</select></label>
            <button className="primary-button workflow-main-action" disabled={isSaving || isSessionLoading} onClick={() => void startOrder()}><Play size={17} />Начать заказ</button>
          </div>
        ) : session.status === 'completed' ? (
          <div className="workflow-completed-time"><Flag size={18} /><span><small>Завершён в</small><strong>{formatTime(session.completedAt)}</strong></span></div>
        ) : (
          <button className="primary-button workflow-main-action" disabled={isSaving || progress.pending > 0 || Object.values(session.stops).some((stop) => stop.status !== 'completed')} onClick={() => void finishOrder()}><Flag size={17} />Завершить заказ</button>
        )}
      </section>

      {session?.status === 'in-progress' && (
        <section className="workflow-location-bar">
          <div><MapPin size={17} /><span><b>Фактическая точка</b><small>Изменение сразу пересчитает оставшийся маршрут</small></span></div>
          <select aria-label="Фактическая текущая точка" value={session.currentAddress} disabled={isSaving} onChange={(event) => void setCurrentLocation(event.target.value)}><option value="">{CENTRAL_START_LABEL}</option>{warehouseAddresses.map((address) => <option key={address} value={address}>{address}</option>)}</select>
        </section>
      )}

      {routeRows.length > 0 && (
        <section className="workflow-route-scheme" aria-label="Схема остановок маршрута">
          <div className="workflow-scheme-heading"><div><Route size={18} /><span><b>Схема маршрута</b><small>Нажмите на остановку, чтобы перейти к ней в списке</small></span></div><strong>{session?.currentAddress || session?.startAddress || startAddress || CENTRAL_START_LABEL}</strong></div>
          <div className="workflow-route-snake">
            {routeRows.map((row, rowIndex) => (
              <div className="workflow-snake-lane" key={rowIndex}>
                <div className={`workflow-snake-row ${rowIndex % 2 ? 'reverse' : ''}`}>
                  {row.map((stop, stopIndex) => {
                    const index = route!.stops.indexOf(stop)
                    const stopStatus = session?.stops[stop.address]?.status ?? 'pending'
                    return (
                      <div className={`workflow-snake-step ${stopIndex < row.length - 1 ? 'with-arrow' : ''}`} key={`${stop.address}-${index}`}>
                        <button type="button" className={`workflow-snake-stop ${stopStatus} ${index === firstPendingStopIndex ? 'recommended' : ''}`} onClick={() => scrollToStop(stop.address)}><span>{stopStatus === 'completed' ? <Check size={13} /> : index + 1}</span><b>{stop.address}</b><small>{stopStatusLabel(stopStatus)}</small></button>
                        {stopIndex < row.length - 1 && <span className="workflow-snake-arrow" aria-hidden="true">{rowIndex % 2 ? <ArrowLeft size={24} strokeWidth={3.8} /> : <ArrowRight size={24} strokeWidth={3.8} />}</span>}
                      </div>
                    )
                  })}
                </div>
                {rowIndex < routeRows.length - 1 && <div className={`workflow-snake-turn ${rowIndex % 2 ? 'left' : 'right'}`} aria-hidden="true"><ArrowDown size={27} strokeWidth={3.8} /></div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {order.notes && <section className="workflow-order-notes"><b>Примечание к заказу</b><p>{order.notes}</p></section>}

      <section className="workflow-progress-card">
        <div><span><b>{progress.handled}</b> из {order.items.length} позиций</span><strong>{session ? progress.percent : 0}%</strong></div>
        <div className="workflow-progress-track"><span style={{ width: `${session ? progress.percent : 0}%` }} /></div>
        <ul><li className="picked"><Check size={12} />Собрано: {progress.picked}</li><li className="missing"><PackageX size={12} />Отсутствует: {progress.missing}</li><li>Осталось: {session ? progress.pending : order.items.length}</li></ul>
      </section>

      {route?.routeWarning && <div className="optimization-warning workflow-route-warning"><AlertTriangle size={17} /><span>{route.routeWarning} Ручные точки остаются в списке.</span></div>}

      <section className="workflow-timeline" aria-label="Остановки маршрута">
        {route?.stops.map((stop, index) => {
          const stopProgress = session?.stops[stop.address]
          const stopStatus = stopProgress?.status ?? 'pending'
          const itemStatuses = stop.items.map((item) => session?.items[String(item.row)]?.status ?? 'pending')
          const allItemsHandled = itemStatuses.every((status) => status !== 'pending')
          const stopMissing = itemStatuses.some((status) => status === 'missing')
          const active = Boolean(session) && session!.status === 'in-progress' && (session!.currentAddress === stop.address || index === firstPendingStopIndex)
          const travelStart = session && stopProgress?.arrivedAt ? travelStartForStop(session, stopProgress.arrivedAt) : null
          return (
            <article id={`workflow-stop-${encodeURIComponent(stop.address)}`} className={`workflow-stop ${stopStatus === 'completed' ? 'complete' : ''} ${stopMissing ? 'has-missing' : ''} ${active ? 'active' : ''} ${stop.unresolved ? 'unresolved' : ''}`} key={`${stop.address}-${index}`}>
              <div className="workflow-stop-marker">{stopStatus === 'completed' ? <Check size={17} /> : index + 1}</div>
              <div className="workflow-stop-card">
                <header>
                  <div><span className="workflow-stop-address"><MapPin size={15} />{stop.address}</span><h2>Остановка {index + 1}{stop.historical ? ' · выполнена' : ''}</h2></div>
                  <div className="workflow-stop-header-meta"><span className={`workflow-stop-status ${stopStatus}`}>{stopStatusLabel(stopStatus)}</span><span className="workflow-stop-distance">{stop.distanceFromPrevious === null ? (stop.historical ? 'пройдено' : 'ручная точка') : `+${stop.distanceFromPrevious.toFixed(1)} м`}<ChevronRight size={14} /></span></div>
                </header>

                {session && (
                  <div className="workflow-stop-control">
                    <div className="workflow-stop-timings">
                      <span><small>Прибытие</small><b>{formatTime(stopProgress?.arrivedAt)}</b></span>
                      <span><small>Переход</small><b>{stopProgress?.arrivedAt && travelStart ? formatDuration(travelStart, stopProgress.arrivedAt, now) : '—'}</b></span>
                      <span><small>Сборка</small><b>{stopProgress?.collectingAt ? formatDuration(stopProgress.collectingAt, stopProgress.completedAt, now) : '—'}</b></span>
                    </div>
                    {session.status === 'in-progress' && stopStatus === 'pending' && <button type="button" className="secondary-button stop-stage-button" disabled={isSaving} onClick={() => void setStopStatus(stop, 'arrived')}><MapPin size={16} />Я прибыл</button>}
                    {session.status === 'in-progress' && stopStatus === 'arrived' && <button type="button" className="primary-button stop-stage-button" disabled={isSaving} onClick={() => void setStopStatus(stop, 'collecting')}><PackageOpen size={16} />Начать сборку</button>}
                    {session.status === 'in-progress' && stopStatus === 'collecting' && <button type="button" className="primary-button stop-stage-button" disabled={isSaving || !allItemsHandled} title={!allItemsHandled ? 'Сначала отметьте все товары' : undefined} onClick={() => void setStopStatus(stop, 'completed')}><Check size={16} />Завершить остановку</button>}
                    {stopStatus === 'completed' && <span className="workflow-stop-finished"><Check size={15} />{formatTime(stopProgress?.completedAt)}</span>}
                  </div>
                )}

                <div className="workflow-stop-items">
                  {stop.items.map((item) => {
                    const status = session?.items[String(item.row)]?.status ?? 'pending'
                    const product = productsByBarcode.get(item.barcode.replace(/\D/g, '')) ?? productsBySku.get(item.sku.replace(/\D/g, ''))
                    const expanded = expandedRows.has(item.row)
                    const barcode = item.barcode || product?.barcode || '—'
                    const name = product?.name || item.description || `Позиция ${item.row}`
                    const verification = item.productVerification ?? (product && isProductVerified(product) ? 'verified' : 'unverified')
                    const canHandle = Boolean(session) && session!.status === 'in-progress' && stopStatus === 'collecting'
                    return (
                      <div className={`workflow-pick-item ${status}`} key={item.row}>
                        <div className="workflow-item-copy">
                          <b dir="auto">{name}</b>
                          <span className={`verification-pill ${verification}`}>{verification === 'verified' ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}{verification === 'verified' ? 'Проверен' : 'Не проверен'}</span>
                          <span><Barcode size={13} /><span className="workflow-item-barcode">{barcode}</span> · <strong>{item.boxCount || '?'} кор.</strong> · {item.quantity || '?'} шт.</span>
                          <button type="button" className="workflow-item-details-toggle" aria-expanded={expanded} onClick={() => toggleRowDetails(item.row)}><Info size={13} />{expanded ? 'Скрыть подробности' : 'Подробнее о товаре'}{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
                          {expanded && (
                            <div className="workflow-item-details">
                              {product?.imageDataUrl && <img src={product.imageDataUrl} alt={name} />}
                              <div><span><small>מק״ט</small><b>{item.sku || product?.sku || '—'}</b></span><span><small>Адрес</small><b>{product?.location || stop.address}</b></span><span><small>В коробке</small><b>{product?.unitsPerBox || item.unitsPerBox || '—'} шт.</b></span><span><small>Коробка</small><b>{formatPhysicalSpec(product?.boxSpec)}</b></span><span><small>Единица</small><b>{formatPhysicalSpec(product?.itemSpec)}</b></span></div>
                              {product?.description && <p>{product.description}</p>}
                              {!product && <p>Подробные технические данные появятся после привязки позиции к товару в базе.</p>}
                            </div>
                          )}
                          {session?.items[String(item.row)]?.updatedAt && <small>Отмечено {formatTime(session.items[String(item.row)].updatedAt)}</small>}
                        </div>
                        <div className="workflow-item-actions">
                          <button type="button" className="pick-button" disabled={!canHandle || isSaving} aria-pressed={status === 'picked'} onClick={() => void setItemStatus(item.row, 'picked')}>{status === 'picked' ? <Undo2 size={15} /> : <PackageCheck size={15} />}{status === 'picked' ? 'Отменить' : 'Собрано'}</button>
                          <button type="button" className="missing-button" disabled={!canHandle || isSaving} aria-pressed={status === 'missing'} onClick={() => void setItemStatus(item.row, 'missing')}>{status === 'missing' ? <Undo2 size={15} /> : <PackageX size={15} />}{status === 'missing' ? 'Отменить' : 'Нет товара'}</button>
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
