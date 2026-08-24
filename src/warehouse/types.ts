export type Sector = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

export type Address = {
  row: number
  sector: Sector
  canonical: string
}

export type Row = {
  x: number
}

export type RackBlock = {
  rows: number[]
  type: 'single' | 'back_to_back'
  passageBetweenRows?: boolean
}

export type Aisle = [number, number]

export type WarehouseArea = {
  direction: string
  sectorOrder: Sector[]
  sectorCentersY: Record<string, number>
  boundaryY: number
  rows: Record<string, Row>
  rackBlocks: RackBlock[]
  walkableAislesBetweenRows: Aisle[]
  wallCrossAisle?: { exists: boolean | null; status: string }
}

export type WarehouseLayout = {
  version: string
  units: 'meters'
  coordinateSystem: {
    origin: { x: number; y: number; description: string }
    positiveX: string
    positiveY: string
    negativeY: string
  }
  dimensions: {
    pallet: { length: number; width: number }
    sectorLength: number
    centralCrossAisleWidth: number
    normalPickingAisleWidth: { value: number; confidence: 'estimated' | 'measured' }
    singleRackDepth: number
    doubleRackDepth: number
  }
  centralCrossAisle: { centerY: number; minY: number; maxY: number; traversable: boolean }
  upperArea: WarehouseArea
  lowerArea: WarehouseArea
  oppositeRowsAcrossCentralAisle: Array<[number, number]>
  zone40: {
    startsAtY: number
    measured: true
    sectorDepth: number
    topCrossAisle: { exists: true; traversable: true; measured: true; width: number; centerY: number; minY: number; maxY: number; connectsUpperAisles: true }
    positions: {
      '40.A': Zone40Position & { locationCode: '40.A'; role: 'picking' }
      '40.B': Zone40Position & { locationCode: '40.B'; role: 'picking' }
      '40.D': Zone40Position & { locationCode: '40.D'; role: 'finish' }
    }
  }
  palletExit: { connectedTo: 'centralCrossAisle'; connectionX: null; connectionY: number; measured: false }
  unresolvedAddresses: Record<string, { status: 'observed_but_unresolved' }>
  unknownRows: { from: number; to: number; status: 'unknown' }
}

type Zone40Position = {
  oppositeRackBlock: [number, number]
  x: number
  y: number
  footprint: { minX: number; maxX: number; minY: number; maxY: number }
}

export type Point = { x: number; y: number }

export type GraphNode = Point & {
  id: string
  kind: 'address' | 'central' | 'top'
  address?: string
}

export type GraphEdge = {
  from: string
  to: string
  distance: number
  kind: 'along_aisle' | 'same_aisle_face' | 'central_cross_aisle' | 'central_access' | 'top_cross_aisle' | 'top_access' | 'zone40_access'
}

export type WarehouseGraph = {
  nodes: Map<string, GraphNode>
  adjacency: Map<string, GraphEdge[]>
}

export type GeometryIssue = {
  code: string
  message: string
}

export type GraphBuildResult =
  | { status: 'ok'; graph: WarehouseGraph }
  | { status: 'invalid_layout'; issues: GeometryIssue[] }

export type AddressResolution =
  | { status: 'resolved'; address: Address; nodeId: string; point: Point }
  | { status: 'unresolved'; address?: Address; reason: UnresolvedReason }
  | { status: 'invalid'; reason: 'INVALID_ADDRESS_FORMAT' }

export type UnresolvedReason =
  | 'ROWS_11_TO_20_UNKNOWN'
  | 'ROW_GEOMETRY_UNKNOWN'
  | 'SECTOR_GEOMETRY_UNKNOWN'

export type RouteResult =
  | { status: 'resolved'; distance: number; nodeIds: string[]; points: Point[] }
  | { status: 'unresolved'; reason: UnresolvedReason }
  | { status: 'invalid'; reason: 'INVALID_ADDRESS_FORMAT' | 'WAREHOUSE_LAYOUT_INVALID' | 'PATH_NOT_FOUND'; issues?: GeometryIssue[] }
