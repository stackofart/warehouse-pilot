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
  MessageSquare,
  Navigation,
  PackageCheck,
  PackageX,
  Pause,
  Play,
  Route,
  Search,
  ShieldCheck,
  Timer,
  Undo2,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { listOrders, type SavedOrder } from '../orders/storage'
import { isProductVerified, type Product } from '../products/storage'
import { productsForOrders } from '../products/catalogRepository'
import { getSyncedSession, flushSessions } from './sync'
import { getReports, sendReport, reportStatus, type Report } from '../reports/api'
import { prepareReportDraft } from '../reports/draft'
import { ReportPhotoInput } from '../reports/ReportPhotoInput'
import { OrderCompletion } from './OrderCompletion'
import { formatMilliseconds } from './time'
import type { RecognizedOrderItem } from '../recognition/ocr'
import { optimizeOrderRoute } from '../routing/optimizer'
import { buildWarehouseGraph } from '../warehouse/graph'
import { getFulfillmentSession, saveFulfillmentSession } from './storage'
import { searchFulfillmentEntries, type FulfillmentSearchEntry } from './search'
import {
  completeFulfillmentSession,
  completeFastFulfillmentSession,
  createFulfillmentSession,
  getFulfillmentActiveDuration,
  getFulfillmentActiveDurationBetween,
  getFulfillmentProgress,
  pauseFulfillmentSession,
  reconcileFulfillmentSession,
  resumeFulfillmentSession,
  updateFulfillmentItem,
  updateFulfillmentItemNote,
  updateFulfillmentItemAtStop,
  updateFulfillmentFinish,
  updateFulfillmentLocation,
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
  finishAddress: string
  distanceToFinish: number | null
  routeWarning: string
}

type WorkflowMode = 'fast' | 'route'
type FastFilter = 'all' | 'pending' | 'issues' | 'picked'
type FastSort = 'sheet' | 'family'

const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const CENTRAL_START_LABEL = 'Центральный вход'
const FINISH_ADDRESSES = ['40.A', '40.B', '40.D'] as const
const DEFAULT_FINISH_ADDRESS = '40.D'
const WORKFLOW_MODE_KEY = 'warehouse-pilot.workflow-mode'

function initialWorkflowMode(): WorkflowMode {
  try {
    return window.localStorage.getItem(WORKFLOW_MODE_KEY) === 'route' ? 'route' : 'fast'
  } catch {
    return 'fast'
  }
}

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

function formatActiveDuration(session: FulfillmentSession, start: string | null | undefined, end: string | null | undefined, now: number) {
  return formatMilliseconds(getFulfillmentActiveDurationBetween(session, start, end, now))
}

function formatPhysicalSpec(spec: Product['boxSpec'] | Product['itemSpec']) {
  if (!spec) return 'нет данных'
  const dimensions = [spec.lengthCm, spec.widthCm, spec.heightCm]
  const size = dimensions.every((value) => Number(value) > 0) ? `${dimensions.join(' × ')} см` : 'габариты не указаны'
  return spec.weightKg ? `${size}, ${spec.weightKg} кг` : size
}

function productFamily(product: Product | undefined, fallbackName: string) {
  const dimensions = product?.boxSpec
    ? [product.boxSpec.lengthCm, product.boxSpec.widthCm, product.boxSpec.heightCm].filter(Boolean).join('×')
    : ''
  const label = [product?.brand?.trim(), dimensions && `${dimensions} см`].filter(Boolean).join(' · ')
  return {
    key: `${product?.brand?.trim().toLocaleLowerCase() || fallbackName.trim().split(/\s+/)[0]?.toLocaleLowerCase() || 'прочее'}|${dimensions || 'без-габаритов'}`,
    label: label || 'Без определённой товарной группы',
  }
}

function buildWorkflowStops(order: SavedOrder, session: FulfillmentSession | null, draftStartAddress: string, draftFinishAddress: string): WorkflowRoute {
  const itemsByAddress = new Map<string, RecognizedOrderItem[]>()
  order.items.forEach((item) => itemsByAddress.set(itemAddress(item), [...(itemsByAddress.get(itemAddress(item)) ?? []), item]))

  const completedAddresses = Object.entries(session?.stops ?? {})
    .filter(([, progress]) => progress.status === 'completed')
    .sort((left, right) => (left[1].completedAt ?? '').localeCompare(right[1].completedAt ?? ''))
    .map(([address]) => address)
  const completedSet = new Set(completedAddresses)
  const completedStops: WorkflowStop[] = completedAddresses
    .filter((address) => itemsByAddress.has(address))
    .map((address) => ({
      address,
      items: itemsByAddress.get(address)!,
      distanceFromPrevious: session?.stops[address]?.distanceFromPreviousMeters ?? null,
      unresolved: false,
      historical: true,
    }))
  const remainingItems = order.items.filter((item) => !completedSet.has(itemAddress(item)))

  const startAddress = session?.currentAddress || session?.startAddress || draftStartAddress
  const finishAddress = session?.finishAddress || draftFinishAddress
  const route = optimizeOrderRoute(remainingItems, { startAddress, finishAddress })
  const plannedStops: WorkflowStop[] = []
  const includedRows = new Set<number>()
  let routeWarning = ''
  let totalDistance: number | null = null
  let distanceToFinish: number | null = null

  if (route.status === 'resolved' || route.status === 'partial') {
    totalDistance = route.totalDistance
    distanceToFinish = route.distanceToFinish
    route.stops.forEach((stop) => {
      stop.items.forEach((item) => includedRows.add(item.row))
      plannedStops.push({ address: stop.address, items: stop.items, distanceFromPrevious: stop.distanceFromPrevious, unresolved: false, historical: false })
    })
    if (route.status === 'partial') routeWarning = `Часть адресов не имеет измеренной геометрии: ${route.unresolved.map((entry) => entry.address).join(', ')}`
  } else if (route.status === 'invalid' && route.reason === 'START_ADDRESS_UNRESOLVED') {
    routeWarning = `Для фактической точки ${startAddress} нет измеренной геометрии. Укажите ближайшую измеренную точку.`
  } else if (route.status === 'invalid' && route.reason === 'FINISH_ADDRESS_UNRESOLVED') {
    routeWarning = `Для выбранного финиша ${finishAddress} нет измеренной геометрии.`
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

  return { stops: [...completedStops, ...plannedStops], totalDistance, finishAddress, distanceToFinish, routeWarning }
}

function stopStatusLabel(status: FulfillmentStopStatus) {
  if (status === 'arrived') return 'На точке'
  if (status === 'collecting') return 'Идёт сборка'
  if (status === 'completed') return 'Завершена'
  return 'К сборке'
}

function travelStartForStop(session: FulfillmentSession, arrivedAt: string | null) {
  if (!arrivedAt) return session.startedAt
  const currentStop = Object.values(session.stops).find((stop) => stop.arrivedAt === arrivedAt)
  if (currentStop?.travelStartedAt) return currentStop.travelStartedAt
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

function stopElementId(address: string) {
  return `workflow-stop-${encodeURIComponent(address)}`
}

function itemElementId(row: number) {
  return `workflow-item-${row}`
}

function scrollToStop(address: string) {
  document.getElementById(stopElementId(address))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function scrollToItem(row: number) {
  const element = document.getElementById(itemElementId(row))
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element?.focus({ preventScroll: true })
}

function restoreStopViewportPosition(address: string, previousTop: number | null) {
  if (previousTop === null) return
  window.requestAnimationFrame(() => {
    const element = document.getElementById(stopElementId(address))
    if (!element) return
    const offset = element.getBoundingClientRect().top - previousTop
    if (Math.abs(offset) > 1) window.scrollBy(0, offset)
  })
}

export function OrderWorkflow() {
  const hashOrderId = orderIdFromHash()
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedId, setSelectedId] = useState(hashOrderId)
  const [session, setSession] = useState<FulfillmentSession | null>(null)
  const [startAddress, setStartAddress] = useState('')
  const [finishAddress, setFinishAddress] = useState(DEFAULT_FINISH_ADDRESS)
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>(initialWorkflowMode)
  const [fastFilter, setFastFilter] = useState<FastFilter>('all')
  const [fastSort, setFastSort] = useState<FastSort>('sheet')
  const [fastActionRow, setFastActionRow] = useState<number | null>(null)
  const [reportDrafts, setReportDrafts] = useState<Record<number, string>>({})
  const [reportKinds, setReportKinds] = useState<Record<number, Report['kind']>>({})
  const [reportAddresses, setReportAddresses] = useState<Record<number, string>>({})
  const [reportFeedback, setReportFeedback] = useState<Record<number, string>>({})
  const [reportPhotos, setReportPhotos] = useState<Record<number, string>>({})
  const [photoBusy, setPhotoBusy] = useState(false)
  const [reports, setReports] = useState<Report[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSessionLoading, setIsSessionLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    listOrders().then(async savedOrders => {
      const savedProducts = await productsForOrders(savedOrders)
      setOrders(savedOrders)
      setProducts(savedProducts)
      if (savedOrders[0]) setSelectedId((current) => current || savedOrders[0].id)
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось открыть заказ')
    }).finally(() => setIsLoading(false))
  }, [])

  const order = orders.find((candidate) => candidate.id === selectedId)

  useEffect(() => {
    if (!order) return
    let cancelled = false
    const refresh = async () => { try { const [alerts, cards] = await Promise.all([getReports(order.id), productsForOrders([order])]); if (!cancelled) { setReports(alerts); setProducts(previous => [...new Map([...previous, ...cards].map(card => [card.id, card])).values()]) } } catch { /* Existing alerts stay visible during a connection outage. */ } }
    void refresh(); const timer = setInterval(() => void refresh(), 30000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [order])

  useEffect(() => {
    let cancelled = false
    setExpandedRows(new Set())
    setSearchQuery('')
    setSearchOpen(false)
    setHighlightedRow(null)
    setFastActionRow(null)
    setReportDrafts({})
    setReportKinds({})
    setReportAddresses({})
    setReportFeedback({}); setReportPhotos({}); setPhotoBusy(false)
    setFastFilter('all')
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
        setFinishAddress(DEFAULT_FINISH_ADDRESS)
        return
      }
      const reconciled = reconcileFulfillmentSession(saved, order.items.map((item) => item.row), uniqueOrderAddresses(order))
      setSession(reconciled)
      setWorkflowMode(reconciled.mode)
      setStartAddress(reconciled.startAddress)
      setFinishAddress(reconciled.finishAddress)
      if (reconciled !== saved) setSession(await saveFulfillmentSession(reconciled))
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
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [session?.status])

  useEffect(() => {
    try { window.localStorage.setItem(WORKFLOW_MODE_KEY, workflowMode) } catch { /* Private mode can disable storage. */ }
  }, [workflowMode])

  useEffect(() => {
    if (highlightedRow === null) return
    const timer = window.setTimeout(() => setHighlightedRow((current) => current === highlightedRow ? null : current), 3_000)
    return () => window.clearTimeout(timer)
  }, [highlightedRow])

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
  const route = useMemo(() => order && workflowMode === 'route' ? buildWorkflowStops(order, session, startAddress, finishAddress) : null, [order, session, startAddress, finishAddress, workflowMode])
  const progress = getFulfillmentProgress(session)
  const fastPendingCount = session ? Object.values(session.items).filter((item) => item.status === 'pending').length : order?.items.length || 0
  const firstPendingStopIndex = route?.stops.findIndex((stop) => (session?.stops[stop.address]?.status ?? 'pending') !== 'completed') ?? -1
  const routeRows = useMemo(() => chunkStops(route?.stops ?? []), [route])
  const searchEntries = useMemo(() => {
    const entries: FulfillmentSearchEntry[] = []
    for (const stop of route?.stops ?? order?.items.map(item => ({ address: item.address, items: [item] })) ?? []) {
      for (const item of stop.items) {
        const product = productsByBarcode.get(item.barcode.replace(/\D/g, '')) ?? productsBySku.get(item.sku.replace(/\D/g, ''))
        entries.push({
          row: item.row,
          address: workflowMode === 'fast' ? product?.location || stop.address : stop.address,
          name: product?.name || item.description || `Позиция ${item.row}`,
          barcode: item.barcode || product?.barcode || '',
          sku: item.sku || product?.sku || '',
          status: session?.items[String(item.row)]?.status ?? 'pending',
        })
      }
    }
    return entries
  }, [productsByBarcode, productsBySku, route, session, order, workflowMode])
  const searchResults = useMemo(() => searchFulfillmentEntries(searchEntries, searchQuery), [searchEntries, searchQuery])
  const visibleSearchResults = searchResults.slice(0, 8)
  const issueRows = useMemo(() => new Set((order?.items || []).filter(item => {
    const state = session?.items[String(item.row)]
    return state?.status === 'missing' || state?.status === 'checking' || Boolean(state?.note) || reports.some(report => (Boolean(item.sku) && report.sku === item.sku) || (Boolean(item.barcode) && report.barcode === item.barcode))
  }).map(item => item.row)), [order, session, reports])
  const fastItems = useMemo(() => {
    if (!order) return []
    const entries = order.items.map((item, sheetIndex) => {
      const product = productsByBarcode.get(item.barcode.replace(/\D/g, '')) ?? productsBySku.get(item.sku.replace(/\D/g, ''))
      const status = session?.items[String(item.row)]?.status ?? 'pending'
      const name = product?.name || item.description || `Позиция ${item.row}`
      return { item, product, status, name, sheetIndex, family: productFamily(product, name) }
    })
    if (fastSort === 'family') entries.sort((left, right) => left.family.key.localeCompare(right.family.key) || left.sheetIndex - right.sheetIndex)
    return entries.filter(({ status, item }) => {
      if (fastFilter === 'pending') return status === 'pending'
      if (fastFilter === 'issues') return issueRows.has(item.row)
      if (fastFilter === 'picked') return status === 'picked'
      return true
    })
  }, [fastFilter, fastSort, order, productsByBarcode, productsBySku, session, issueRows])

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
      setSession(await saveFulfillmentSession(next))
      setNow(Date.now())
      return true
    } catch (reason) {
      console.error(reason)
      setSession(previous)
      setError(reason instanceof Error ? reason.message : failureMessage)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const startOrder = async () => {
    if (!order) return
    const next = createFulfillmentSession(order.id, order.items.map((item) => item.row), {
      addresses: uniqueOrderAddresses(order),
      startAddress,
      finishAddress,
      mode: workflowMode,
    })
    await persistSession(next, session, 'Не удалось начать комплектацию')
  }

  const setCurrentLocation = async (address: string) => {
    if (!session || session.status !== 'in-progress') return
    await persistSession(updateFulfillmentLocation(session, address), session, 'Не удалось сохранить текущую точку')
  }

  const setFinishGate = async (address: string) => {
    if (!session || session.status !== 'in-progress') return
    setFinishAddress(address)
    await persistSession(updateFulfillmentFinish(session, address), session, 'Не удалось сохранить финишные ворота')
  }

  const setItemStatus = async (stop: WorkflowStop, row: number, status: FulfillmentItemStatus) => {
    if (!session || session.status !== 'in-progress') return
    setError('')
    const stopElement = document.getElementById(stopElementId(stop.address))
    const previousTop = stopElement?.getBoundingClientRect().top ?? null
    const currentStatus = session.items[String(row)]?.status ?? 'pending'
    const timestamp = new Date().toISOString()
    const next = updateFulfillmentItemAtStop(
      session,
      stop.address,
      stop.items.map((item) => item.row),
      row,
      currentStatus === status ? 'pending' : status,
      timestamp,
      {
        fromAddress: session.currentAddress || session.startAddress,
        distanceMeters: stop.distanceFromPrevious,
      },
    )
    const saving = persistSession(next, session, 'Не удалось сохранить отметку позиции')
    restoreStopViewportPosition(stop.address, previousTop)
    await saving
    restoreStopViewportPosition(stop.address, previousTop)
  }

  const setFastItemStatus = async (row: number, status: FulfillmentItemStatus) => {
    if (!session || session.status !== 'in-progress') return
    setError('')
    const currentStatus = session.items[String(row)]?.status ?? 'pending'
    const nextStatus = currentStatus === status ? 'pending' : status
    if (!await persistSession(updateFulfillmentItem(session, row, nextStatus), session, 'Не удалось сохранить отметку позиции')) return
    if (nextStatus === 'missing' && order) {
      try {
        const pending = await sendReport({ id: crypto.randomUUID(), orderId: order.id, row, kind: 'missing', note: 'Нет товара на подборе. Проверьте резерв.' })
        if (pending) setError('Сообщение сохранено на устройстве и будет отправлено при восстановлении сети.')
        else setReports(await getReports(order.id))
      } catch (reason) { setError(String(reason)) }
    }
    setFastActionRow(null)
  }

  const saveFastItemReport = async (row: number) => {
    if (!session || session.status !== 'in-progress') return
    if (photoBusy || isSaving) return
    const draft = prepareReportDraft(reportKinds[row] || 'comment', reportDrafts[row] || '', reportAddresses[row], Boolean(reportPhotos[row]))
    if (draft.error) {
      setReportFeedback(current => ({ ...current, [row]: draft.error }))
      return
    }
    setError('')
    setReportFeedback(current => ({ ...current, [row]: '' }))
    setIsSaving(true)
    if (order) {
      try {
        const pending = await sendReport({ id: crypto.randomUUID(), orderId: order.id, row, kind: draft.kind, note: draft.note, suggestedAddress: draft.suggestedAddress, ...(reportPhotos[row] ? { photoDataUrl: reportPhotos[row] } : {}) })
        setReportFeedback(current => ({ ...current, [row]: pending ? 'Сохранено на устройстве · отправим при подключении.' : draft.kind === 'moved' ? 'Адрес отправлен администратору на подтверждение.' : draft.kind === 'missing' ? 'Сообщение отправлено на проверку резерва.' : 'Сообщение отправлено.' }))
        const next = draft.kind === 'missing' ? updateFulfillmentItem(session, row, 'missing') : draft.note ? updateFulfillmentItemNote(session, row, draft.note) : session
        if (next !== session) { setSession(await saveFulfillmentSession(next)); setNow(Date.now()) }
        if (!pending) setReports(await getReports(order.id))
        setReportDrafts(current => ({ ...current, [row]: '' }))
        setReportPhotos(current => ({ ...current, [row]: '' }))
        setFastActionRow(null)
      } catch (reason) { setReportFeedback(current => ({ ...current, [row]: reason instanceof Error ? reason.message : 'Не удалось отправить сообщение.' })) }
      finally { setIsSaving(false) }
    }
  }

  const toggleOrderPause = async () => {
    if (!session || session.status === 'completed') return
    setError('')
    const next = session.status === 'paused'
      ? resumeFulfillmentSession(session)
      : pauseFulfillmentSession(session)
    await persistSession(next, session, session.status === 'paused' ? 'Не удалось продолжить заказ' : 'Не удалось поставить заказ на паузу')
  }

  const finishOrder = async () => {
    if (!session) return
    const untouched = Object.values(session.items).filter((item) => item.status === 'pending').length
    if (workflowMode === 'fast') {
      if (progress.checking > 0) {
        setError('Сначала завершите проверку отмеченных позиций')
        return
      }
      if (untouched > 0 && !window.confirm(`Завершить заказ? ${untouched} неотмеченных позиций будут записаны как собранные.`)) return
    }
    setIsSaving(true)
    try {
      const next = workflowMode === 'fast' ? completeFastFulfillmentSession(session) : completeFulfillmentSession(session)
      setSession(await saveFulfillmentSession(next))
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

  const goToSearchResult = (entry: FulfillmentSearchEntry) => {
    setHighlightedRow(entry.row)
    setFastFilter('all')
    setSearchQuery('')
    setSearchOpen(false)
    window.setTimeout(() => scrollToItem(entry.row), 0)
  }

  const toggleSearch = () => {
    setSearchOpen((current) => {
      const next = !current
      if (next) window.setTimeout(() => searchInputRef.current?.focus(), 0)
      return next
    })
  }

  const searchStatusLabel = (status: FulfillmentItemStatus) => {
    if (status === 'picked') return 'Собрано'
    if (status === 'checking') return 'Проверяется'
    if (status === 'missing') return 'Нет товара'
    return 'Ожидает'
  }

  if (isLoading) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><p>Открываем заказ…</p></div></div>
  if (!order) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><strong>Заказ не найден или не назначен вам</strong><a className="primary-button" href="#orders">К моим заказам</a></div></div>

  return (
    <div className={`page workflow-page ${workflowMode === 'fast' && session ? 'active-fast-work' : ''} ${isSaving && session?.status === 'in-progress' ? 'saving-mark' : ''}`}>
      {session?.status === 'completed' && <OrderCompletion session={session} orderNumber={order.orderNumber} />}
      {workflowMode === 'fast' && session && session.status !== 'completed' && <nav className="compact-work-links" aria-label="Быстрые действия заказа"><a href="#orders">← Заказы</a><a href={`#pallet/${encodeURIComponent(order.id)}`}>Паллета</a><a href="#work-finish" onClick={event => { event.preventDefault(); document.getElementById('work-finish')?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }}>К завершению ↓</a></nav>}
      {session?.syncStatus && session.syncStatus !== 'synced' && <div className="operations-sync" role="status"><span>{session.syncStatus === 'conflict' ? session.syncError || 'Конфликт синхронизации' : 'Сохранено на устройстве · ожидает отправки'}</span><button onClick={() => void flushSessions().then(async () => setSession(await getFulfillmentSession(order.id) || null))}>Синхронизировать</button>{session.syncStatus === 'conflict' && <button onClick={() => { if (confirm('Заменить локальный прогресс серверной версией? Несинхронизированные отметки будут удалены.')) void getSyncedSession(order.id, true).then(value => setSession(value || null)).catch(reason => setError(String(reason))) }}>Принять серверную версию</button>}</div>}
      <div className="page-heading workflow-heading">
        <div><p className="eyebrow">РАБОЧИЙ РЕЖИМ</p><h1>{workflowMode === 'fast' ? 'Сборка заказа' : 'Заказ: маршрут и сборка'}</h1><p>{workflowMode === 'fast' ? 'Отмечайте собранное по ходу работы или подтвердите всё вместе в конце. Кнопка «Сообщить» — для замечаний.' : 'Отмечайте результат по товару — прибытие и остановки фиксируются автоматически.'}</p></div>
        <label className="order-selector"><span>Заказ</span><select aria-label="Заказ для комплектации" value={order.id} onChange={(event) => selectOrder(event.target.value)}>{orders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.orderNumber || 'Без номера'}</option>)}</select></label>
      </div>

      {error && <div className="order-import-feedback error workflow-error" role="alert">{error}</div>}

      <nav className="workflow-order-navigation" aria-label="Разделы заказа">
        <a className="secondary-button" href="#orders"><ClipboardList size={15} />Все заказы</a>
        <a className="active" aria-current="page" href={`#work/${encodeURIComponent(order.id)}`}><Route size={15} />Сборка</a>
        <a className="secondary-button" href={`#pallet/${encodeURIComponent(order.id)}`}><Cuboid size={15} />Паллета</a>
      </nav>

      <section className="workflow-mode-switch" aria-label="Режим комплектации">
        <div><button type="button" className={workflowMode === 'fast' ? 'active' : ''} aria-pressed={workflowMode === 'fast'} disabled={Boolean(session)} onClick={() => setWorkflowMode('fast')}><PackageCheck size={16} />Быстрый режим</button><button type="button" className={workflowMode === 'route' ? 'active' : ''} aria-pressed={workflowMode === 'route'} disabled={Boolean(session)} onClick={() => setWorkflowMode('route')}><Route size={16} />С маршрутом</button></div>
        <p>{workflowMode === 'fast' ? 'Основной сценарий для телефона: полный список остаётся на месте, фиксируются только проблемы.' : 'Экспериментальный старый сценарий с остановками, расстояниями и картой маршрута.'}</p>
      </section>

      <section className={`workflow-overview ${workflowMode === 'fast' && session ? 'mobile-fast-overview' : ''}`}>
        <div className="workflow-order-title"><span className={`workflow-status ${session?.status ?? 'not-started'}`}>{session?.status === 'completed' ? 'Завершён' : session?.status === 'paused' ? 'На паузе' : session ? 'В работе' : 'Не начат'}</span><h2>{order.orderNumber || 'Заказ без номера'}</h2><p>{order.items.length} позиций в заказе</p></div>
        <div className="workflow-stat"><Clock3 size={17} /><span><small>Начало</small><strong>{formatTime(session?.startedAt)}</strong></span></div>
        <div className="workflow-stat"><Timer size={17} /><span><small>Активное время</small><strong>{session ? formatMilliseconds(getFulfillmentActiveDuration(session, now)) : '0 мин 00 сек'}</strong></span></div>
        <div className="workflow-stat">{workflowMode === 'fast' ? <AlertTriangle size={17} /> : <Navigation size={17} />}<span><small>{workflowMode === 'fast' ? 'Исключения' : 'Осталось пройти'}</small><strong>{workflowMode === 'fast' ? progress.checking + progress.missing : route?.totalDistance === null ? 'частично' : `${route?.totalDistance.toFixed(1)} м`}</strong></span></div>
        {!session ? (
          <div className="workflow-start-action">
            {workflowMode === 'route' && <><label><span>Стартовая точка</span><select aria-label="Стартовая точка заказа" value={startAddress} onChange={(event) => setStartAddress(event.target.value)}><option value="">{CENTRAL_START_LABEL}</option>{warehouseAddresses.map((address) => <option key={address} value={address}>{address}</option>)}</select></label><label><span>Ворота погрузки</span><select aria-label="Финишные ворота заказа" value={finishAddress} onChange={(event) => setFinishAddress(event.target.value)}>{FINISH_ADDRESSES.map((address) => <option key={address} value={address}>{address}</option>)}</select></label></>}
            <button className="primary-button workflow-main-action" disabled={isSaving || isSessionLoading} onClick={() => void startOrder()}><Play size={17} />{workflowMode === 'fast' ? 'Начать быструю сборку' : 'Начать заказ'}</button>
          </div>
        ) : session.status === 'completed' ? (
          <div className="workflow-completed-time"><Flag size={18} /><span><small>Завершён в</small><strong>{formatTime(session.completedAt)}</strong></span></div>
        ) : (
          <div className="workflow-main-actions">
            <button className={session.status === 'paused' ? 'primary-button workflow-main-action' : 'secondary-button workflow-main-action'} disabled={isSaving} onClick={() => void toggleOrderPause()}>{session.status === 'paused' ? <Play size={17} /> : <Pause size={17} />}{session.status === 'paused' ? 'Продолжить' : 'Пауза'}</button>
            {workflowMode === 'route' && session.status === 'in-progress' && <button className="primary-button workflow-main-action" disabled={isSaving || progress.pending > 0 || Object.values(session.stops).some((stop) => stop.status !== 'completed')} onClick={() => void finishOrder()}><Flag size={17} />Завершить заказ</button>}
            {session.status === 'paused' && <small>Пауза с {formatTime(session.pausedAt)}</small>}
          </div>
        )}
      </section>

      {workflowMode === 'fast' && session && <section className={`mobile-fast-summary ${session.status}`}>
        <div><small>{order.orderNumber || 'Заказ без номера'} · {session.status === 'paused' ? 'Пауза' : session.status === 'completed' ? 'Завершён' : formatMilliseconds(getFulfillmentActiveDuration(session, now))}</small><b>{order.items.length} позиций · {progress.picked} собрано · {issueRows.size} с замечаниями</b></div>
        {session.status !== 'completed' && <button type="button" disabled={isSaving} aria-label={session.status === 'paused' ? 'Продолжить заказ' : 'Поставить заказ на паузу'} onClick={() => void toggleOrderPause()}>{session.status === 'paused' ? <Play size={18} /> : <Pause size={18} />}</button>}
      </section>}

      {workflowMode === 'route' && session && session.status !== 'completed' && (
        <section className={`workflow-location-bar ${session.status}`}>
          <div><MapPin size={17} /><span><b>Фактическая точка</b><small>Изменение сразу пересчитает оставшийся маршрут</small></span></div>
          <div className="workflow-location-selectors">
            <label><span>Сейчас</span><select aria-label="Фактическая текущая точка" value={session.currentAddress} disabled={isSaving || session.status === 'paused'} onChange={(event) => void setCurrentLocation(event.target.value)}><option value="">{CENTRAL_START_LABEL}</option>{warehouseAddresses.map((address) => <option key={address} value={address}>{address}</option>)}</select></label>
            <label><span>Финиш</span><select aria-label="Финишные ворота заказа" value={session.finishAddress} disabled={isSaving || session.status === 'paused'} onChange={(event) => void setFinishGate(event.target.value)}>{FINISH_ADDRESSES.map((address) => <option key={address} value={address}>{address}</option>)}</select></label>
          </div>
        </section>
      )}

      {workflowMode === 'route' && route && (routeRows.length > 0 || route.finishAddress) && (
        <section className="workflow-route-scheme" aria-label="Схема остановок маршрута">
          <div className="workflow-scheme-heading"><div><Route size={18} /><span><b>Схема маршрута</b><small>Нажмите на остановку, чтобы перейти к ней в списке</small></span></div><div className="workflow-route-endpoints"><strong>{session?.currentAddress || session?.startAddress || startAddress || CENTRAL_START_LABEL}</strong><ChevronRight size={14} /><strong><Flag size={12} />{route.finishAddress}</strong></div></div>
          <div className="workflow-route-snake">
            {routeRows.map((row, rowIndex) => (
              <div className="workflow-snake-lane" key={rowIndex}>
                <div className={`workflow-snake-row ${rowIndex % 2 ? 'reverse' : ''}`}>
                  {row.map((stop, stopIndex) => {
                    const index = route!.stops.indexOf(stop)
                    const stopStatus = session?.stops[stop.address]?.status ?? 'pending'
                    return (
                      <div className={`workflow-snake-step ${stopIndex < row.length - 1 ? 'with-arrow' : ''}`} key={`${stop.address}-${index}`}>
                        <button type="button" className={`workflow-snake-stop ${stopStatus} ${index === firstPendingStopIndex ? 'recommended' : ''}`} onClick={() => scrollToStop(stop.address)}><span>{stopStatus === 'completed' ? <Check size={13} /> : index + 1}</span><b>{stop.address}</b><small>{stopStatusLabel(stopStatus)}{stop.distanceFromPrevious !== null ? ` · +${stop.distanceFromPrevious.toFixed(1)} м` : ''}</small></button>
                        {stopIndex < row.length - 1 && <span className="workflow-snake-arrow" aria-hidden="true">{rowIndex % 2 ? <ArrowLeft size={24} strokeWidth={3.8} /> : <ArrowRight size={24} strokeWidth={3.8} />}</span>}
                      </div>
                    )
                  })}
                </div>
                {rowIndex < routeRows.length - 1 && <div className={`workflow-snake-turn ${rowIndex % 2 ? 'left' : 'right'}`} aria-hidden="true"><ArrowDown size={27} strokeWidth={3.8} /></div>}
              </div>
            ))}
          </div>
          <div className="workflow-route-finish"><Flag size={17} /><span><small>После последнего товара</small><b>Ворота {route.finishAddress}</b></span><strong>{route.distanceToFinish === null ? '—' : `+${route.distanceToFinish.toFixed(1)} м`}</strong></div>
        </section>
      )}

      {order.notes && <section className="workflow-order-notes"><b>Примечание к заказу</b><p>{order.notes}</p></section>}

      <section className={`workflow-progress-card ${workflowMode === 'fast' ? 'fast-mode' : ''}`}>
        <div><span><b>{progress.handled}</b> из {order.items.length} позиций</span><strong>{session ? progress.percent : 0}%</strong></div>
        <div className="workflow-progress-track"><span style={{ width: `${session ? progress.percent : 0}%` }} /></div>
        <ul><li className="picked"><Check size={12} />Собрано: {progress.picked}</li><li className="checking"><ShieldCheck size={12} />Проверяется: {progress.checking}</li><li className="missing"><PackageX size={12} />Отсутствует: {progress.missing}</li><li>Осталось: {session ? progress.pending : order.items.length}</li></ul>
        <form className={`workflow-item-search ${searchOpen ? 'open' : ''}`} role="search" onSubmit={(event) => { event.preventDefault(); if (searchResults[0]) goToSearchResult(searchResults[0]) }}>
          <button className="workflow-search-toggle" type="button" aria-expanded={searchOpen} onClick={toggleSearch}><Search size={18} /><span>Найти товар в заказе</span><ChevronDown size={16} /></button>
          <div className="workflow-search-expand">
          <label htmlFor="workflow-product-search">Быстрый переход к товару</label>
          <div className="workflow-search-control">
            <Search size={18} />
            <input
              ref={searchInputRef}
              id="workflow-product-search"
              type="search"
              inputMode="search"
              autoComplete="off"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults[0]) {
                  event.preventDefault()
                  goToSearchResult(searchResults[0])
                }
              }}
              placeholder="Название, штрихкод, מק״ט или адрес"
            />
            {searchQuery && <button type="button" aria-label="Очистить поиск товара" onClick={() => setSearchQuery('')}><X size={17} /></button>}
          </div>
          {searchQuery.trim() && (
            <div className="workflow-search-results" aria-live="polite">
              <div className="workflow-search-results-heading"><span>Найдено: {searchResults.length}</span>{searchResults.length > 0 && <small>Enter — перейти к первому</small>}</div>
              {visibleSearchResults.length ? visibleSearchResults.map((entry) => (
                <button type="button" key={entry.row} onClick={() => goToSearchResult(entry)}>
                  <span><b dir="auto">{entry.name}</b><small><MapPin size={12} />{entry.address} · <Barcode size={12} />{entry.barcode || 'без штрихкода'}{entry.sku ? ` · מק״ט ${entry.sku}` : ''}</small></span>
                  <em className={entry.status}>{searchStatusLabel(entry.status)}</em>
                </button>
              )) : <p>В этом заказе ничего не найдено.</p>}
              {searchResults.length > visibleSearchResults.length && <p>Показаны первые {visibleSearchResults.length} результатов — уточните запрос.</p>}
            </div>
          )}
          </div>
        </form>
      </section>

      {workflowMode === 'fast' && <section className="fast-picking-panel" aria-label="Быстрый список заказа">
        <header className="fast-picking-toolbar">
          <div className="fast-filter-tabs" role="group" aria-label="Фильтр позиций">
            <button type="button" className={fastFilter === 'all' ? 'active' : ''} onClick={() => setFastFilter('all')}>Все <b>{order.items.length}</b></button>
            <button type="button" className={fastFilter === 'pending' ? 'active' : ''} onClick={() => setFastFilter('pending')}>Не отмечены <b>{fastPendingCount}</b></button>
            <button type="button" className={fastFilter === 'issues' ? 'active issue' : ''} onClick={() => setFastFilter('issues')}>Замечания <b>{issueRows.size}</b></button>
            <button type="button" className={fastFilter === 'picked' ? 'active' : ''} onClick={() => setFastFilter('picked')}>Собрано <b>{progress.picked}</b></button>
          </div>
          <details className="fast-sort-menu"><summary>Порядок: {fastSort === 'sheet' ? 'как в листе' : 'товарные группы'}<ChevronDown size={15} /></summary><label className="fast-sort-select"><span>Порядок списка</span><select value={fastSort} onChange={(event) => setFastSort(event.target.value as FastSort)}><option value="sheet">Как в листе</option><option value="family">Товарные группы</option></select></label></details>
        </header>

        <div className="fast-picking-list">
          {fastItems.length ? fastItems.map((entry, index) => {
            const { item, product, status, name, family } = entry
            const expanded = expandedRows.has(item.row)
            const actionOpen = fastActionRow === item.row
            const canHandle = Boolean(session) && session!.status === 'in-progress' && !isSaving
            const verification = item.productVerification ?? (product && isProductVerified(product) ? 'verified' : 'unverified')
            const statusLabel = status === 'picked' ? 'Собрано' : status === 'checking' ? 'Идёт проверка' : status === 'missing' ? 'Нет товара' : 'Сообщить'
            const itemNote = session?.items[String(item.row)]?.note ?? ''
            const showFamily = fastSort === 'family' && (index === 0 || fastItems[index - 1].family.key !== family.key)
            return <Fragment key={item.row}>
              {showFamily && <div className="fast-family-heading"><span>{family.label}</span><small>одинаковый бренд или форм-фактор</small></div>}
              <article id={itemElementId(item.row)} tabIndex={-1} className={`fast-pick-row ${status} ${highlightedRow === item.row ? 'search-highlight' : ''}`}>
                <span className="fast-row-number">{item.row}</span>
                <button className="fast-row-main" type="button" aria-expanded={expanded} onClick={() => toggleRowDetails(item.row)}>
                  <b dir="auto">{name}</b>
                  <span className="fast-row-meta"><strong><MapPin size={13} />{product?.location || itemAddress(item)}</strong><em className="fast-row-quantity"><b>{item.boxCount || '?'}</b> кор. · {item.quantity || '?'} шт.</em><small className="fast-row-barcode"><Barcode size={13} />{item.barcode || product?.barcode || 'без штрихкода'}</small></span>
                  {itemNote && !reports.some(report => ((Boolean(item.sku) && report.sku === item.sku) || (Boolean(item.barcode) && report.barcode === item.barcode)) && report.note === itemNote) && <span className="fast-row-report-note"><MessageSquare size={13} />{itemNote}</span>}
                  {reports.filter(report => (Boolean(item.sku) && report.sku === item.sku) || (Boolean(item.barcode) && report.barcode === item.barcode)).map(report => <span className="operations-report-alert" key={report.id}>{reportStatus[report.status]} · {report.suggestedAddress ? 'Возможный адрес ' + report.suggestedAddress + ' · ' : ''}{report.note}</span>)}
                </button>
                <div className="fast-row-controls">
                  <button className="fast-pick-button" type="button" aria-pressed={status === 'picked'} aria-label={`${status === 'picked' ? 'Отменить отметку собрано' : 'Собрано'}: ${name}`} disabled={!canHandle} onClick={() => void setFastItemStatus(item.row, 'picked')}><Check size={17} /><span>Собрано</span></button>
                  <button className="fast-report-button" type="button" aria-label={`Сообщить: ${name}`} disabled={!canHandle} aria-expanded={actionOpen} onClick={() => setFastActionRow(current => current === item.row ? null : item.row)}><MessageSquare size={15} /><span>Сообщить</span></button>
                  {(status === 'checking' || status === 'missing') && <small className={`fast-item-state ${status}`}>{statusLabel}</small>}
                </div>

                {expanded && <div className="workflow-item-details fast-row-details">
                  {(product?.imageUrl || product?.imageDataUrl) && <img src={product.imageUrl || product.imageDataUrl} alt={name} />}
                  {(product?.variant || product?.packagingColor || product?.identificationNotes) && <p><b>{product.variant} {product.packagingColor}</b> {product.identificationNotes}</p>}
                  <div><span><small>Штрихкод</small><b>{item.barcode || product?.barcode || '—'}</b></span><span><small>מק״ט</small><b>{item.sku || product?.sku || '—'}</b></span><span><small>Адрес</small><b>{product?.location || itemAddress(item)}</b></span><span><small>В коробке</small><b>{product?.unitsPerBox || item.unitsPerBox || '—'} шт.</b></span><span><small>Коробка</small><b>{formatPhysicalSpec(product?.boxSpec)}</b></span><span><small>Единица</small><b>{formatPhysicalSpec(product?.itemSpec)}</b></span><span><small>Проверка</small><b>{verification === 'verified' ? 'Товар проверен' : 'Нужна проверка карточки'}</b></span></div>
                  {product?.description && <p>{product.description}</p>}
                  {!product && <p>Подробные технические данные появятся после привязки позиции к общей базе товаров.</p>}
                </div>}

                {actionOpen && <form className="fast-row-actions" onSubmit={event => { event.preventDefault(); void saveFastItemReport(item.row) }}>
                  <header><b>Сообщить о товаре</b><button type="button" className="close-button" aria-label="Закрыть сообщение" onClick={() => setFastActionRow(null)}><X size={18} /></button></header>
                  <div className="report-kind-options" role="group" aria-label="Тип сообщения">{([{ kind: 'missing', label: 'Нет товара', icon: PackageX }, { kind: 'moved', label: 'Другое место', icon: MapPin }, { kind: 'damaged', label: 'Повреждение', icon: AlertTriangle }, { kind: 'comment', label: 'Комментарий', icon: MessageSquare }] as const).map(({ kind, label, icon: Icon }) => <button type="button" key={kind} aria-pressed={(reportKinds[item.row] || 'comment') === kind} onClick={() => { setReportKinds(current => ({ ...current, [item.row]: kind })); setReportFeedback(current => ({ ...current, [item.row]: '' })) }}><Icon size={17} />{label}</button>)}</div>
                  {reportKinds[item.row] === 'moved' && <label className="fast-report-field"><span>Где находится товар</span><input aria-label="Фактический адрес товара" autoCapitalize="characters" autoComplete="off" placeholder="Например, 24.F" value={reportAddresses[item.row] || ''} onChange={event => setReportAddresses(current => ({ ...current, [item.row]: event.target.value }))} /><small>Новый адрес проверит и подтвердит администратор.</small></label>}
                  {reportKinds[item.row] === 'missing' && <p className="report-help">Сообщение попадёт на проверку резерва и пополнение.</p>}
                  <label className="fast-report-comment"><span>Комментарий{reportKinds[item.row] && reportKinds[item.row] !== 'comment' ? ' · необязательно' : ''}</span><textarea value={reportDrafts[item.row] || ''} maxLength={500} placeholder="Дополнительные подробности" onChange={event => setReportDrafts(current => ({ ...current, [item.row]: event.target.value }))} /></label>
                  <ReportPhotoInput value={reportPhotos[item.row]} onChange={data => setReportPhotos(current => ({ ...current, [item.row]: data }))} onBusy={setPhotoBusy} disabled={!canHandle} />
                  {reportFeedback[item.row] && <p className="report-feedback" role="status">{reportFeedback[item.row]}</p>}
                  <div className="report-submit-actions"><button type="submit" className="report-send-button" disabled={!canHandle || photoBusy}>{isSaving ? 'Отправляем…' : 'Отправить сообщение'}</button></div>
                </form>}
                {!actionOpen && reportFeedback[item.row] && <p className="report-feedback" role="status">{reportFeedback[item.row]}</p>}
              </article>
            </Fragment>
          }) : <div className="fast-picking-empty"><Search size={25} /><b>В этом фильтре нет позиций</b><button type="button" onClick={() => setFastFilter('all')}>Показать весь заказ</button></div>}
        </div>

        {session?.status === 'in-progress' && <footer id="work-finish" className="fast-complete-bar"><div><b>{fastPendingCount ? `${fastPendingCount} позиций ещё не отмечено` : 'Все позиции отмечены'}</b><span>{progress.checking ? `Нужно завершить проверку: ${progress.checking}` : fastPendingCount ? 'При завершении они будут записаны как собранные.' : 'Заказ готов к завершению.'}</span></div><button className="primary-button" type="button" disabled={isSaving || progress.checking > 0} onClick={() => void finishOrder()}><Flag size={18} />Завершить заказ</button></footer>}
      </section>}

      {workflowMode === 'route' && route?.routeWarning && <div className="optimization-warning workflow-route-warning"><AlertTriangle size={17} /><span>{route.routeWarning} Ручные точки остаются в списке.</span></div>}

      {workflowMode === 'route' && <section className="workflow-timeline" aria-label="Остановки маршрута">
        {route?.stops.map((stop, index) => {
          const stopProgress = session?.stops[stop.address]
          const stopStatus = stopProgress?.status ?? 'pending'
          const itemStatuses = stop.items.map((item) => session?.items[String(item.row)]?.status ?? 'pending')
          const stopMissing = itemStatuses.some((status) => status === 'missing')
          const active = Boolean(session) && session!.status === 'in-progress' && (session!.currentAddress === stop.address || index === firstPendingStopIndex)
          const travelStart = session && stopProgress?.arrivedAt ? travelStartForStop(session, stopProgress.arrivedAt) : null
          return (
            <article id={stopElementId(stop.address)} className={`workflow-stop ${stopStatus === 'completed' ? 'complete' : ''} ${stopMissing ? 'has-missing' : ''} ${active ? 'active' : ''} ${stop.unresolved ? 'unresolved' : ''}`} key={stop.address}>
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
                        <span><small>Переход</small><b>{stopProgress?.arrivedAt && travelStart ? formatActiveDuration(session, travelStart, stopProgress.arrivedAt, now) : '—'}</b></span>
                        <span><small>Сборка</small><b>{stopProgress?.collectingAt ? formatActiveDuration(session, stopProgress.collectingAt, stopProgress.completedAt, now) : '—'}</b></span>
                      </div>
                      {session.status === 'in-progress' && stopStatus === 'pending' && <span className="workflow-stop-auto-note"><PackageCheck size={15} />Первая отметка зафиксирует прибытие</span>}
                      {session.status === 'in-progress' && (stopStatus === 'arrived' || stopStatus === 'collecting') && <span className="workflow-stop-auto-note active"><PackageCheck size={15} />Последняя позиция завершит остановку</span>}
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
                      const canHandle = Boolean(session) && session!.status === 'in-progress'
                      return (
                        <div id={itemElementId(item.row)} tabIndex={-1} className={`workflow-pick-item ${status} ${highlightedRow === item.row ? 'search-highlight' : ''}`} key={item.row}>
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
                            {status === 'checking' && <small className="workflow-checking-note">Проверка начата — выберите итоговый статус</small>}
                            {session?.items[String(item.row)]?.updatedAt && <small>Отмечено {formatTime(session.items[String(item.row)].updatedAt)}</small>}
                          </div>
                          <div className="workflow-item-actions">
                            <button type="button" className="checking-button" disabled={!canHandle || isSaving} aria-pressed={status === 'checking'} onClick={() => void setItemStatus(stop, item.row, 'checking')}>{status === 'checking' ? <Undo2 size={15} /> : <ShieldCheck size={15} />}{status === 'checking' ? 'Отменить проверку' : 'Идёт проверка'}</button>
                            <button type="button" className="pick-button" disabled={!canHandle || isSaving} aria-pressed={status === 'picked'} onClick={() => void setItemStatus(stop, item.row, 'picked')}>{status === 'picked' ? <Undo2 size={15} /> : <PackageCheck size={15} />}{status === 'picked' ? 'Отменить' : 'Собрано'}</button>
                            <button type="button" className="missing-button" disabled={!canHandle || isSaving} aria-pressed={status === 'missing'} onClick={() => void setItemStatus(stop, item.row, 'missing')}>{status === 'missing' ? <Undo2 size={15} /> : <PackageX size={15} />}{status === 'missing' ? 'Отменить' : 'Нет товара'}</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
              </div>
            </article>
          )
        })}
      </section>}
    </div>
  )
}
