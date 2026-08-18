import { warehouseLayout } from './layout'
import type { Address, AddressResolution, Sector, WarehouseArea, WarehouseLayout } from './types'

const ADDRESS_PATTERN = /^(\d{1,3})\.([A-H])$/i

export function parseAddress(value: string): Address | null {
  const match = value.trim().match(ADDRESS_PATTERN)
  if (!match) return null
  const row = Number(match[1])
  const sector = match[2].toUpperCase() as Sector
  return { row, sector, canonical: `${row}.${sector}` }
}

export function addressNodeId(address: Address) {
  return `address:${address.canonical}`
}

export function aisleCenterForRow(area: WarehouseArea, row: number) {
  const aisle = area.walkableAislesBetweenRows.find(([left, right]) => left === row || right === row)
  if (!aisle) return null
  return (area.rows[String(aisle[0])].x + area.rows[String(aisle[1])].x) / 2
}

export function resolveAddress(value: string, layout: WarehouseLayout = warehouseLayout): AddressResolution {
  const address = parseAddress(value)
  if (!address) return { status: 'invalid', reason: 'INVALID_ADDRESS_FORMAT' }
  if (address.row === 40) {
    const position = layout.zone40.positions[address.canonical as keyof typeof layout.zone40.positions]
    if (!position) return { status: 'unresolved', address, reason: 'SECTOR_GEOMETRY_UNKNOWN' }
    return { status: 'resolved', address, nodeId: addressNodeId(address), point: { x: position.x, y: position.y } }
  }
  if (address.canonical === '26.H') return { status: 'unresolved', address, reason: 'ADDRESS_26_H_UNKNOWN' }
  if (address.row >= layout.unknownRows.from && address.row <= layout.unknownRows.to) {
    return { status: 'unresolved', address, reason: 'ROWS_11_TO_20_UNKNOWN' }
  }

  const area = layout.upperArea.rows[String(address.row)] ? layout.upperArea
    : layout.lowerArea.rows[String(address.row)] ? layout.lowerArea
      : null
  if (!area) return { status: 'unresolved', address, reason: 'ROW_GEOMETRY_UNKNOWN' }
  if (!area.sectorOrder.includes(address.sector)) {
    return { status: 'unresolved', address, reason: 'SECTOR_GEOMETRY_UNKNOWN' }
  }

  const aisleX = aisleCenterForRow(area, address.row)
  if (aisleX === null) return { status: 'unresolved', address, reason: 'ROW_GEOMETRY_UNKNOWN' }
  return {
    status: 'resolved',
    address,
    nodeId: addressNodeId(address),
    point: { x: aisleX, y: area.sectorCentersY[address.sector] },
  }
}
