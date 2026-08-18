import { addressNodeId, aisleCenterForRow } from './geometry'
import { validateWarehouseLayout, warehouseLayout } from './layout'
import type { Address, GraphBuildResult, GraphEdge, GraphNode, Sector, WarehouseArea, WarehouseGraph, WarehouseLayout } from './types'

function addNode(graph: WarehouseGraph, node: GraphNode) {
  graph.nodes.set(node.id, node)
  if (!graph.adjacency.has(node.id)) graph.adjacency.set(node.id, [])
}

function addEdge(graph: WarehouseGraph, from: string, to: string, distance: number, kind: GraphEdge['kind']) {
  graph.adjacency.get(from)?.push({ from, to, distance, kind })
  graph.adjacency.get(to)?.push({ from: to, to: from, distance, kind })
}

const centralNodeId = (x: number) => `central:${x}`
const topNodeId = (x: number) => `top:${x}`
const addressFor = (row: number, sector: Sector): Address => ({ row, sector, canonical: `${row}.${sector}` })

function areaAisleCenters(area: WarehouseArea) {
  return area.walkableAislesBetweenRows.map(([left, right]) => (area.rows[String(left)].x + area.rows[String(right)].x) / 2)
}

function addArea(graph: WarehouseGraph, layout: WarehouseLayout, area: WarehouseArea) {
  for (const rowKey of Object.keys(area.rows)) {
    const rowNumber = Number(rowKey)
    const aisleX = aisleCenterForRow(area, rowNumber)
    if (aisleX === null) continue
    for (const sector of area.sectorOrder) {
      const address = addressFor(rowNumber, sector)
      addNode(graph, { id: addressNodeId(address), kind: 'address', address: address.canonical, x: aisleX, y: area.sectorCentersY[sector] })
    }
    for (let index = 1; index < area.sectorOrder.length; index += 1) {
      addEdge(graph, addressNodeId(addressFor(rowNumber, area.sectorOrder[index - 1])), addressNodeId(addressFor(rowNumber, area.sectorOrder[index])), layout.dimensions.sectorLength, 'along_aisle')
    }
    const first = addressFor(rowNumber, area.sectorOrder[0])
    addEdge(graph, centralNodeId(aisleX), addressNodeId(first), Math.abs(area.sectorCentersY[area.sectorOrder[0]] - layout.centralCrossAisle.centerY), 'central_access')
  }

  for (const [leftRow, rightRow] of area.walkableAislesBetweenRows) {
    for (const sector of area.sectorOrder) addEdge(graph, addressNodeId(addressFor(leftRow, sector)), addressNodeId(addressFor(rightRow, sector)), 0, 'same_aisle_face')
  }
}

function addTopArea(graph: WarehouseGraph, layout: WarehouseLayout) {
  const topY = layout.zone40.topCrossAisle.centerY
  const topXs = [...new Set([...areaAisleCenters(layout.upperArea), ...Object.values(layout.zone40.positions).map((position) => position.x)])].sort((a, b) => a - b)
  for (const x of topXs) addNode(graph, { id: topNodeId(x), kind: 'top', x, y: topY })
  for (let index = 1; index < topXs.length; index += 1) addEdge(graph, topNodeId(topXs[index - 1]), topNodeId(topXs[index]), topXs[index] - topXs[index - 1], 'top_cross_aisle')

  const lastSector = layout.upperArea.sectorOrder.at(-1)!
  for (const [leftRow, rightRow] of layout.upperArea.walkableAislesBetweenRows) {
    const x = aisleCenterForRow(layout.upperArea, leftRow)!
    for (const row of [leftRow, rightRow]) addEdge(graph, addressNodeId(addressFor(row, lastSector)), topNodeId(x), topY - layout.upperArea.sectorCentersY[lastSector], 'top_access')
  }

  for (const position of Object.values(layout.zone40.positions)) {
    const address = addressFor(40, position.locationCode.slice(-1) as Sector)
    addNode(graph, { id: addressNodeId(address), kind: 'address', address: address.canonical, x: position.x, y: position.y })
    addEdge(graph, topNodeId(position.x), addressNodeId(address), 0, 'zone40_access')
  }
}

export function buildWarehouseGraph(layout: WarehouseLayout = warehouseLayout): GraphBuildResult {
  const issues = validateWarehouseLayout(layout)
  if (issues.length) return { status: 'invalid_layout', issues }

  const graph: WarehouseGraph = { nodes: new Map(), adjacency: new Map() }
  const centralXs = [...new Set([0, ...areaAisleCenters(layout.upperArea), ...areaAisleCenters(layout.lowerArea)])].sort((a, b) => a - b)
  for (const x of centralXs) addNode(graph, { id: centralNodeId(x), kind: 'central', x, y: layout.centralCrossAisle.centerY })
  for (let index = 1; index < centralXs.length; index += 1) addEdge(graph, centralNodeId(centralXs[index - 1]), centralNodeId(centralXs[index]), centralXs[index] - centralXs[index - 1], 'central_cross_aisle')

  addArea(graph, layout, layout.upperArea)
  addArea(graph, layout, layout.lowerArea)
  addTopArea(graph, layout)
  return { status: 'ok', graph }
}
