import { getFulfillmentActiveDurationBetween, type FulfillmentSession } from '../fulfillment/workflow'
import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'
import type { RecognizedOrderItem } from '../recognition/ocr'
import { distance } from '../warehouse/shortestPath'

export type AnalyticsPeriod = { from: number | null; to: number | null }

export type ProductAnalytics = {
  key: string
  name: string
  barcode: string
  address: string
  orderCount: number
  lineCount: number
  boxes: number
  units: number
  weightKg: number
  estimatedCollectionMs: number | null
  missingCount: number
}

export type AddressHeat = {
  address: string
  boxes: number
  lines: number
  orderCount: number
}

export type DailyAnalytics = {
  date: string
  label: string
  orders: number
  boxes: number
  completed: number
  durationMs: number
}

export type OverviewAnalytics = {
  orders: number
  completedOrders: number
  activeOrders: number
  positions: number
  boxes: number
  units: number
  totalWeightKg: number
  weightOrderCount: number
  averagePositionsPerOrder: number
  averageBoxesPerOrder: number
  averageUnitsPerOrder: number
  averageWeightPerOrderKg: number
  averageOrderMs: number | null
  averageCollectionMs: number | null
  averageTravelMs: number | null
  totalDistanceMeters: number
  averageSpeedMetersPerMinute: number | null
  handledWeightKg: number
  loadDistanceKgM: number
  estimatedCalories: number
  weightCoveragePercent: number
  timeCoveragePercent: number
  missingItems: number
  handledItems: number
  missingRatePercent: number
  ignoredTimingOutliers: number
  products: ProductAnalytics[]
  heatmap: AddressHeat[]
  daily: DailyAnalytics[]
}

const WORKER_WEIGHT_KG = 75
const WALKING_KCAL_PER_KG_KM = 0.5
const HANDLING_KCAL_PER_KG = 0.05
const MAX_ORDER_DURATION_MS = 16 * 60 * 60 * 1_000
const MAX_STAGE_DURATION_MS = 4 * 60 * 60 * 1_000

const numeric = (value: string | number | null | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const normalizeDigits = (value: string | undefined) => (value ?? '').replace(/\D/g, '')
const normalizeAddress = (value: string | undefined) => (value ?? '').trim().toUpperCase()

function itemKey(item: RecognizedOrderItem) {
  return normalizeDigits(item.barcode) || normalizeDigits(item.sku) || item.description.trim().toLocaleLowerCase()
}

function buildProductLookup(products: Product[]) {
  const byId = new Map(products.map((product) => [product.id, product]))
  const byBarcode = new Map(products.filter((product) => product.barcode).map((product) => [normalizeDigits(product.barcode), product]))
  const bySku = new Map(products.filter((product) => product.sku).map((product) => [normalizeDigits(product.sku), product]))
  return { byId, byBarcode, bySku }
}

function findProduct(item: RecognizedOrderItem, lookup: ReturnType<typeof buildProductLookup>) {
  return (item.catalogProductId ? lookup.byId.get(item.catalogProductId) : undefined)
    ?? lookup.byBarcode.get(normalizeDigits(item.barcode))
    ?? lookup.bySku.get(normalizeDigits(item.sku))
}

function itemWeight(item: RecognizedOrderItem, product: Product | undefined) {
  const boxes = numeric(item.boxCount)
  if (product?.boxSpec?.weightKg && boxes) return product.boxSpec.weightKg * boxes
  const units = numeric(item.quantity)
  if (product?.itemSpec?.weightKg && units) return product.itemSpec.weightKg * units
  return 0
}

function itemTimestamp(order: SavedOrder, session: FulfillmentSession | undefined) {
  return new Date(session?.startedAt ?? order.createdAt).getTime()
}

function included(timestamp: number, period: AnalyticsPeriod) {
  return Number.isFinite(timestamp)
    && (period.from === null || timestamp >= period.from)
    && (period.to === null || timestamp <= period.to)
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function average(total: number, count: number) {
  return count ? total / count : 0
}

export function calculateOverviewAnalytics(
  orders: SavedOrder[],
  sessions: FulfillmentSession[],
  products: Product[],
  period: AnalyticsPeriod,
): OverviewAnalytics {
  const sessionByOrder = new Map(sessions.map((session) => [session.orderId, session]))
  const lookup = buildProductLookup(products)
  const selectedOrders = orders.filter((order) => included(itemTimestamp(order, sessionByOrder.get(order.id)), period))
  const selectedIds = new Set(selectedOrders.map((order) => order.id))
  const selectedSessions = sessions.filter((session) => selectedIds.has(session.orderId))
  const orderById = new Map(selectedOrders.map((order) => [order.id, order]))

  let positions = 0
  let boxes = 0
  let units = 0
  let totalWeightKg = 0
  let weightOrderCount = 0
  let knownWeightBoxes = 0
  const productRows = new Map<string, ProductAnalytics & { orderIds: Set<string>; collectionMs: number; collectionSamples: number }>()
  const heatRows = new Map<string, AddressHeat & { orderIds: Set<string> }>()
  const dailyRows = new Map<string, DailyAnalytics>()

  for (const order of selectedOrders) {
    const orderLookup = order.productSnapshots?.length ? buildProductLookup(order.productSnapshots) : lookup
    const session = sessionByOrder.get(order.id)
    const timestamp = itemTimestamp(order, session)
    const key = dayKey(timestamp)
    const daily = dailyRows.get(key) ?? {
      date: key,
      label: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(timestamp)),
      orders: 0,
      boxes: 0,
      completed: 0,
      durationMs: 0,
    }
    daily.orders += 1
    if (session?.status === 'completed') {
      daily.completed += 1
      daily.durationMs += getFulfillmentActiveDurationBetween(session, session.startedAt, session.completedAt)
    }
    dailyRows.set(key, daily)

    positions += order.items.length
    let calculatedOrderWeight = 0
    let orderBoxes = 0
    for (const item of order.items) {
      const itemBoxes = numeric(item.boxCount)
      const itemUnits = numeric(item.quantity)
      const product = findProduct(item, orderLookup)
      const weight = itemWeight(item, product)
      orderBoxes += itemBoxes
      boxes += itemBoxes
      units += itemUnits
      calculatedOrderWeight += weight
      if (weight > 0) knownWeightBoxes += itemBoxes

      const productKey = itemKey(item) || `${order.id}:${item.row}`
      const aggregate = productRows.get(productKey) ?? {
        key: productKey,
        name: product?.name || item.description || `Позиция ${item.row}`,
        barcode: product?.barcode || item.barcode,
        address: product?.location || item.address,
        orderCount: 0,
        lineCount: 0,
        boxes: 0,
        units: 0,
        weightKg: 0,
        estimatedCollectionMs: null,
        missingCount: 0,
        orderIds: new Set<string>(),
        collectionMs: 0,
        collectionSamples: 0,
      }
      aggregate.orderIds.add(order.id)
      aggregate.lineCount += 1
      aggregate.boxes += itemBoxes
      aggregate.units += itemUnits
      aggregate.weightKg += weight
      if (session?.items?.[String(item.row)]?.status === 'missing') aggregate.missingCount += 1
      productRows.set(productKey, aggregate)

      const address = normalizeAddress(item.address)
      if (address) {
        const heat = heatRows.get(address) ?? { address, boxes: 0, lines: 0, orderCount: 0, orderIds: new Set<string>() }
        heat.boxes += itemBoxes || 1
        heat.lines += 1
        heat.orderIds.add(order.id)
        heatRows.set(address, heat)
      }
    }
    daily.boxes += orderBoxes
    const recognizedWeight = numeric(order.summary?.totalWeightKg)
    const orderWeight = recognizedWeight || calculatedOrderWeight
    if (orderWeight > 0) {
      totalWeightKg += orderWeight
      weightOrderCount += 1
    }
  }

  let totalOrderMs = 0
  let completedOrders = 0
  let timedOrderCount = 0
  let totalCollectionMs = 0
  let collectionSessionCount = 0
  let totalTravelMs = 0
  let travelSessionCount = 0
  let totalDistanceMeters = 0
  let timedDistanceMeters = 0
  let handledWeightKg = 0
  let loadDistanceKgM = 0
  let missingItems = 0
  let handledItems = 0
  let ignoredTimingOutliers = 0

  for (const session of selectedSessions) {
    const order = orderById.get(session.orderId)
    if (!order) continue
    const orderLookup = order.productSnapshots?.length ? buildProductLookup(order.productSnapshots) : lookup
    if (session.status === 'completed' && session.completedAt) {
      completedOrders += 1
      const orderDuration = getFulfillmentActiveDurationBetween(session, session.startedAt, session.completedAt)
      if (orderDuration > 0 && orderDuration <= MAX_ORDER_DURATION_MS) {
        totalOrderMs += orderDuration
        timedOrderCount += 1
      } else if (orderDuration > MAX_ORDER_DURATION_MS) ignoredTimingOutliers += 1
    }
    const orderedStops = Object.entries(session.stops ?? {})
      .filter(([, stop]) => Boolean(stop.arrivedAt))
      .sort((left, right) => (left[1].arrivedAt ?? '').localeCompare(right[1].arrivedAt ?? ''))

    let sessionCollectionMs = 0
    let sessionTravelMs = 0
    let carriedWeight = 0
    let lastAddress = session.startAddress
    // Picked mass is known from quantities even when no route checkpoints exist.
    for (const item of order.items) {
      if (session.items?.[String(item.row)]?.status === 'picked') {
        handledWeightKg += itemWeight(item, findProduct(item, orderLookup))
      }
    }
    for (const [address, stop] of orderedStops) {
      const transitionDistance = stop.distanceFromPreviousMeters ?? 0
      totalDistanceMeters += transitionDistance
      loadDistanceKgM += carriedWeight * transitionDistance
      const transitionMs = getFulfillmentActiveDurationBetween(session, stop.travelStartedAt, stop.arrivedAt)
      if (transitionMs <= MAX_STAGE_DURATION_MS) {
        sessionTravelMs += transitionMs
        if (transitionMs > 0) timedDistanceMeters += transitionDistance
      }
      else ignoredTimingOutliers += 1
      const measuredCollectionMs = getFulfillmentActiveDurationBetween(session, stop.collectingAt, stop.completedAt)
      const stopCollectionMs = measuredCollectionMs <= MAX_STAGE_DURATION_MS ? measuredCollectionMs : 0
      if (measuredCollectionMs > MAX_STAGE_DURATION_MS) ignoredTimingOutliers += 1
      sessionCollectionMs += stopCollectionMs
      lastAddress = address

      const stopItems = order.items.filter((item) => normalizeAddress(item.address) === address)
      const allocationBoxes = stopItems.reduce((total, item) => total + (numeric(item.boxCount) || 1), 0)
      for (const item of stopItems) {
        const product = findProduct(item, orderLookup)
        const weight = itemWeight(item, product)
        const status = session.items?.[String(item.row)]?.status
        if (status === 'picked') {
          carriedWeight += weight
        }
        const aggregate = productRows.get(itemKey(item))
        if (aggregate && stopCollectionMs > 0) {
          aggregate.collectionMs += stopCollectionMs * (numeric(item.boxCount) || 1) / Math.max(1, allocationBoxes)
          aggregate.collectionSamples += 1
        }
      }
    }

    if (session.mode !== 'fast' && orderedStops.length && session.status === 'completed' && lastAddress && session.finishAddress) {
      const finalLeg = distance(lastAddress, session.finishAddress)
      if (finalLeg.status === 'resolved') {
        totalDistanceMeters += finalLeg.distance
        loadDistanceKgM += carriedWeight * finalLeg.distance
      }
    }
    if (sessionCollectionMs > 0) {
      totalCollectionMs += sessionCollectionMs
      collectionSessionCount += 1
    }
    if (sessionTravelMs > 0) {
      totalTravelMs += sessionTravelMs
      travelSessionCount += 1
    }
    for (const item of Object.values(session.items ?? {})) {
      if (item.status === 'missing') missingItems += 1
      if (item.status === 'picked' || item.status === 'missing') handledItems += 1
    }
  }

  const estimatedCalories = totalDistanceMeters / 1_000 * WORKER_WEIGHT_KG * WALKING_KCAL_PER_KG_KM
    + loadDistanceKgM / 1_000 * WALKING_KCAL_PER_KG_KM
    + handledWeightKg * HANDLING_KCAL_PER_KG

  const productAnalytics = [...productRows.values()].map((row): ProductAnalytics => ({
    ...row,
    orderCount: row.orderIds.size,
    estimatedCollectionMs: row.collectionSamples ? row.collectionMs / row.collectionSamples : null,
  })).sort((left, right) => right.boxes - left.boxes || right.orderCount - left.orderCount)
  const heatmap = [...heatRows.values()].map((row): AddressHeat => ({ ...row, orderCount: row.orderIds.size })).sort((left, right) => right.boxes - left.boxes)
  const daily = [...dailyRows.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-31)

  return {
    orders: selectedOrders.length,
    completedOrders,
    activeOrders: selectedSessions.filter((session) => session.status !== 'completed').length,
    positions,
    boxes,
    units,
    totalWeightKg,
    weightOrderCount,
    averagePositionsPerOrder: average(positions, selectedOrders.length),
    averageBoxesPerOrder: average(boxes, selectedOrders.length),
    averageUnitsPerOrder: average(units, selectedOrders.length),
    averageWeightPerOrderKg: average(totalWeightKg, weightOrderCount),
    averageOrderMs: timedOrderCount ? totalOrderMs / timedOrderCount : null,
    averageCollectionMs: collectionSessionCount ? totalCollectionMs / collectionSessionCount : null,
    averageTravelMs: travelSessionCount ? totalTravelMs / travelSessionCount : null,
    totalDistanceMeters,
    averageSpeedMetersPerMinute: totalTravelMs > 0 ? timedDistanceMeters / (totalTravelMs / 60_000) : null,
    handledWeightKg,
    loadDistanceKgM,
    estimatedCalories,
    weightCoveragePercent: boxes ? Math.min(100, knownWeightBoxes / boxes * 100) : 0,
    timeCoveragePercent: selectedOrders.length ? timedOrderCount / selectedOrders.length * 100 : 0,
    missingItems,
    handledItems,
    missingRatePercent: handledItems ? missingItems / handledItems * 100 : 0,
    ignoredTimingOutliers,
    products: productAnalytics,
    heatmap,
    daily,
  }
}

export const calorieFormula = {
  workerWeightKg: WORKER_WEIGHT_KG,
  walkingKcalPerKgKm: WALKING_KCAL_PER_KG_KM,
  handlingKcalPerKg: HANDLING_KCAL_PER_KG,
}
