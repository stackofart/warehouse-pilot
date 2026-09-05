import { resolveAddress } from './geometry'
import { buildWarehouseGraph } from './graph'
import { warehouseLayout } from './layout'
import type { RouteResult, WarehouseGraph, WarehouseLayout } from './types'

const sourceCache = new WeakMap<WarehouseGraph, Map<string, { distances: Map<string, number>; previous: Map<string, string> }>>()
export function shortestGraphPath(graph: WarehouseGraph, startId: string, endId: string) {
  let sources = sourceCache.get(graph)
  if (!sources) { sources = new Map(); sourceCache.set(graph, sources) }
  let tree = sources.get(startId)
  if (!tree) { tree = shortestSourceTree(graph, startId); sources.set(startId, tree) }
  const { distances, previous } = tree
  const totalDistance = distances.get(endId)
  if (totalDistance === undefined) return null
  const nodeIds = [endId]
  while (nodeIds[0] !== startId) {
    const parent = previous.get(nodeIds[0])
    if (!parent) return null
    nodeIds.unshift(parent)
  }
  return { distance: totalDistance, nodeIds }
}
function shortestSourceTree(graph: WarehouseGraph, startId: string) {
  const distances = new Map<string, number>([[startId, 0]])
  const previous = new Map<string, string>()
  const unvisited = new Set(graph.nodes.keys())

  while (unvisited.size) {
    let currentId: string | undefined
    let currentDistance = Number.POSITIVE_INFINITY
    for (const nodeId of unvisited) {
      const candidate = distances.get(nodeId) ?? Number.POSITIVE_INFINITY
      if (candidate < currentDistance) {
        currentDistance = candidate
        currentId = nodeId
      }
    }

    if (!currentId || !Number.isFinite(currentDistance)) break
    unvisited.delete(currentId)

    for (const edge of graph.adjacency.get(currentId) ?? []) {
      if (!unvisited.has(edge.to)) continue
      const candidate = currentDistance + edge.distance
      if (candidate < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, candidate)
        previous.set(edge.to, currentId)
      }
    }
  }

  return { distances, previous }
}

export function shortestPath(from: string, to: string, layout: WarehouseLayout = warehouseLayout): RouteResult {
  const fromResolution = resolveAddress(from, layout)
  if (fromResolution.status !== 'resolved') return fromResolution
  const toResolution = resolveAddress(to, layout)
  if (toResolution.status !== 'resolved') return toResolution

  const graphResult = buildWarehouseGraph(layout)
  if (graphResult.status !== 'ok') {
    return { status: 'invalid', reason: 'WAREHOUSE_LAYOUT_INVALID', issues: graphResult.issues }
  }

  const path = shortestGraphPath(graphResult.graph, fromResolution.nodeId, toResolution.nodeId)
  if (!path) return { status: 'invalid', reason: 'PATH_NOT_FOUND' }
  return {
    status: 'resolved',
    distance: path.distance,
    nodeIds: path.nodeIds,
    points: path.nodeIds.map((nodeId) => {
      const node = graphResult.graph.nodes.get(nodeId)
      if (!node) throw new Error(`Graph node ${nodeId} disappeared while resolving a path`)
      return { x: node.x, y: node.y }
    }),
  }
}

export function distance(from: string, to: string, layout: WarehouseLayout = warehouseLayout): RouteResult {
  return shortestPath(from, to, layout)
}
