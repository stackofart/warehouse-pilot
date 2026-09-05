import type { RecognizedOrderItem } from '../recognition/ocr'
import { buildWarehouseGraph } from '../warehouse/graph'
import { resolveAddress } from '../warehouse/geometry'
import { shortestGraphPath } from '../warehouse/shortestPath'
import type { Point, UnresolvedReason, WarehouseGraph } from '../warehouse/types'

export type RouteStop = {
  address: string
  items: RecognizedOrderItem[]
  distanceFromPrevious: number
}

export type OptimizedRoute = {
  status: 'resolved' | 'partial'
  algorithm: 'held-karp' | 'nearest-neighbor-2opt'
  startNode: string
  startAddress: string
  finishAddress: string
  totalDistance: number
  distanceToFinish: number | null
  stops: RouteStop[]
  pathPoints: Point[]
  unresolved: Array<{ address: string; reason: UnresolvedReason }>
}

export type RouteOptimizationOptions = {
  /** Empty means the measured central entrance node. */
  startAddress?: string
  /** Optional fixed final point, visited after every picking stop. */
  finishAddress?: string
}

export type RouteOptimizationResult = OptimizedRoute
  | { status: 'unresolved'; unresolved: Array<{ address: string; reason: UnresolvedReason }> }
  | { status: 'invalid'; reason: string }

function buildDistanceMatrix(graph: WarehouseGraph, nodeIds: string[]) {
  return nodeIds.map((from) => nodeIds.map((to) => {
    if (from === to) return 0
    return shortestGraphPath(graph, from, to)?.distance ?? Number.POSITIVE_INFINITY
  }))
}

function heldKarpOpenPath(distances: number[][], stopCount: number, finishMatrixIndex: number | null) {
  const stateCount = 1 << stopCount
  const costs = Array.from({ length: stateCount }, () => Array(stopCount).fill(Number.POSITIVE_INFINITY))
  const parents = Array.from({ length: stateCount }, () => Array(stopCount).fill(-1))
  for (let stop = 0; stop < stopCount; stop += 1) costs[1 << stop][stop] = distances[0][stop + 1]

  for (let mask = 1; mask < stateCount; mask += 1) {
    for (let last = 0; last < stopCount; last += 1) {
      if (!(mask & (1 << last))) continue
      const previousMask = mask ^ (1 << last)
      if (!previousMask) continue
      for (let previous = 0; previous < stopCount; previous += 1) {
        if (!(previousMask & (1 << previous))) continue
        const candidate = costs[previousMask][previous] + distances[previous + 1][last + 1]
        if (candidate < costs[mask][last]) {
          costs[mask][last] = candidate
          parents[mask][last] = previous
        }
      }
    }
  }

  const fullMask = stateCount - 1
  let last = 0
  for (let candidate = 1; candidate < stopCount; candidate += 1) {
    const candidateCost = costs[fullMask][candidate] + (finishMatrixIndex === null ? 0 : distances[candidate + 1][finishMatrixIndex])
    const lastCost = costs[fullMask][last] + (finishMatrixIndex === null ? 0 : distances[last + 1][finishMatrixIndex])
    if (candidateCost < lastCost) last = candidate
  }
  const order: number[] = []
  let mask = fullMask
  while (mask) {
    order.unshift(last)
    const parent = parents[mask][last]
    mask ^= 1 << last
    last = parent
  }
  return order
}

function openPathCost(order: number[], distances: number[][], finishMatrixIndex: number | null) {
  if (!order.length) return finishMatrixIndex === null ? 0 : distances[0][finishMatrixIndex]
  let total = distances[0][order[0] + 1]
  for (let index = 1; index < order.length; index += 1) total += distances[order[index - 1] + 1][order[index] + 1]
  if (finishMatrixIndex !== null) total += distances[order.at(-1)! + 1][finishMatrixIndex]
  return total
}

function nearestNeighbor2Opt(distances: number[][], stopCount: number, finishMatrixIndex: number | null) {
  const remaining = new Set(Array.from({ length: stopCount }, (_, index) => index))
  const order: number[] = []
  let currentMatrixIndex = 0
  while (remaining.size) {
    let best = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of remaining) {
      const candidateDistance = distances[currentMatrixIndex][candidate + 1]
      if (candidateDistance < bestDistance) {
        best = candidate
        bestDistance = candidateDistance
      }
    }
    order.push(best)
    remaining.delete(best)
    currentMatrixIndex = best + 1
  }

  let improved = true
  while (improved) {
    improved = false
    const currentCost = openPathCost(order, distances, finishMatrixIndex)
    for (let start = 0; start < order.length - 1 && !improved; start += 1) {
      for (let end = start + 1; end < order.length; end += 1) {
        const candidate = [...order.slice(0, start), ...order.slice(start, end + 1).reverse(), ...order.slice(end + 1)]
        if (openPathCost(candidate, distances, finishMatrixIndex) + 1e-9 < currentCost) {
          order.splice(0, order.length, ...candidate)
          improved = true
          break
        }
      }
    }
  }
  return order
}

let defaultGraph: ReturnType<typeof buildWarehouseGraph> | undefined
export function optimizeOrderRoute(items: RecognizedOrderItem[], options: RouteOptimizationOptions = {}): RouteOptimizationResult {
  const graphResult = defaultGraph ??= buildWarehouseGraph()
  if (graphResult.status !== 'ok') return { status: 'invalid', reason: 'WAREHOUSE_LAYOUT_INVALID' }

  const itemsByAddress = new Map<string, RecognizedOrderItem[]>()
  for (const item of items) {
    const address = item.address.trim().toUpperCase()
    if (!address) continue
    const current = itemsByAddress.get(address) ?? []
    current.push(item)
    itemsByAddress.set(address, current)
  }

  const measured: Array<{ address: string; nodeId: string; items: RecognizedOrderItem[] }> = []
  const unresolved: Array<{ address: string; reason: UnresolvedReason }> = []
  for (const [address, addressItems] of itemsByAddress) {
    const resolution = resolveAddress(address)
    if (resolution.status === 'resolved') measured.push({ address: resolution.address.canonical, nodeId: resolution.nodeId, items: addressItems })
    else if (resolution.status === 'unresolved') unresolved.push({ address, reason: resolution.reason })
  }
  const requestedStart = options.startAddress?.trim().toUpperCase() ?? ''
  const startResolution = requestedStart ? resolveAddress(requestedStart) : null
  if (startResolution && startResolution.status !== 'resolved') {
    return { status: 'invalid', reason: 'START_ADDRESS_UNRESOLVED' }
  }
  const startNode = startResolution?.nodeId ?? 'central:0'
  const startAddress = startResolution?.address.canonical ?? ''
  const requestedFinish = options.finishAddress?.trim().toUpperCase() ?? ''
  const finishResolution = requestedFinish ? resolveAddress(requestedFinish) : null
  if (finishResolution && finishResolution.status !== 'resolved') {
    return { status: 'invalid', reason: 'FINISH_ADDRESS_UNRESOLVED' }
  }
  if (!measured.length && !finishResolution) return { status: 'unresolved', unresolved }

  const finishAddress = finishResolution?.address.canonical ?? ''
  const nodeIds = [startNode, ...measured.map((entry) => entry.nodeId), ...(finishResolution ? [finishResolution.nodeId] : [])]
  const finishMatrixIndex = finishResolution ? measured.length + 1 : null
  const distances = buildDistanceMatrix(graphResult.graph, nodeIds)
  if (distances.some((row) => row.some((value) => !Number.isFinite(value)))) return { status: 'invalid', reason: 'PATH_NOT_FOUND' }
  let order = measured.length
    ? measured.length <= 12 ? heldKarpOpenPath(distances, measured.length, finishMatrixIndex) : nearestNeighbor2Opt(distances, measured.length, finishMatrixIndex)
    : []
  const startStopIndex = measured.findIndex((entry) => entry.nodeId === startNode)
  if (startStopIndex >= 0 && order[0] !== startStopIndex) {
    order = [startStopIndex, ...order.filter((index) => index !== startStopIndex)]
  }

  const stops: RouteStop[] = []
  const pathPoints: Point[] = []
  let previousMatrixIndex = 0
  for (const stopIndex of order) {
    const entry = measured[stopIndex]
    const path = shortestGraphPath(graphResult.graph, nodeIds[previousMatrixIndex], entry.nodeId)
    if (!path) return { status: 'invalid', reason: 'PATH_NOT_FOUND' }
    const points = path.nodeIds.map((nodeId) => graphResult.graph.nodes.get(nodeId)).filter((node) => node).map((node) => ({ x: node!.x, y: node!.y }))
    pathPoints.push(...(pathPoints.length ? points.slice(1) : points))
    stops.push({ address: entry.address, items: entry.items, distanceFromPrevious: path.distance })
    previousMatrixIndex = stopIndex + 1
  }

  let distanceToFinish: number | null = null
  if (finishResolution && finishMatrixIndex !== null) {
    const path = shortestGraphPath(graphResult.graph, nodeIds[previousMatrixIndex], finishResolution.nodeId)
    if (!path) return { status: 'invalid', reason: 'PATH_NOT_FOUND' }
    const points = path.nodeIds.map((nodeId) => graphResult.graph.nodes.get(nodeId)).filter((node) => node).map((node) => ({ x: node!.x, y: node!.y }))
    pathPoints.push(...(pathPoints.length ? points.slice(1) : points))
    distanceToFinish = path.distance
  }

  return {
    status: unresolved.length ? 'partial' : 'resolved',
    algorithm: measured.length <= 12 ? 'held-karp' : 'nearest-neighbor-2opt',
    startNode,
    startAddress,
    finishAddress,
    totalDistance: stops.reduce((total, stop) => total + stop.distanceFromPrevious, 0) + (distanceToFinish ?? 0),
    distanceToFinish,
    stops,
    pathPoints,
    unresolved,
  }
}
