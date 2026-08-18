import layoutJson from './warehouse-layout.json'
import type { GeometryIssue, WarehouseArea, WarehouseLayout } from './types'

export const warehouseLayout = layoutJson as unknown as WarehouseLayout

const EPSILON = 1e-9

function sameDistance(left: number, right: number) {
  return Math.abs(left - right) < EPSILON
}

function validateArea(layout: WarehouseLayout, area: WarehouseArea, areaName: string, issues: GeometryIssue[]) {
  const aisleWidth = layout.dimensions.normalPickingAisleWidth.value
  const rackDepth = layout.dimensions.doubleRackDepth

  for (const [leftRow, rightRow] of area.walkableAislesBetweenRows) {
    const left = area.rows[String(leftRow)]
    const right = area.rows[String(rightRow)]
    if (!left || !right) {
      issues.push({ code: 'AISLE_ROW_MISSING', message: `${areaName}: aisle ${leftRow}-${rightRow} refers to a missing row` })
      continue
    }
    if (!sameDistance(Math.abs(right.x - left.x), aisleWidth)) {
      issues.push({ code: 'AISLE_WIDTH_MISMATCH', message: `${areaName}: fronts ${leftRow}-${rightRow} are not ${aisleWidth} m apart` })
    }
  }

  for (const block of area.rackBlocks) {
    if (block.type !== 'back_to_back') continue
    const [leftRow, rightRow] = block.rows
    const left = area.rows[String(leftRow)]
    const right = area.rows[String(rightRow)]
    if (!left || !right) {
      issues.push({ code: 'RACK_BLOCK_ROW_MISSING', message: `${areaName}: rack block ${leftRow}-${rightRow} refers to a missing row` })
      continue
    }
    if (!sameDistance(Math.abs(right.x - left.x), rackDepth)) {
      issues.push({ code: 'RACK_DEPTH_MISMATCH', message: `${areaName}: back-to-back fronts ${leftRow}-${rightRow} are not ${rackDepth} m apart` })
    }
    if (area.walkableAislesBetweenRows.some(([a, b]) => a === leftRow && b === rightRow || a === rightRow && b === leftRow)) {
      issues.push({ code: 'ROUTE_THROUGH_RACK', message: `${areaName}: back-to-back block ${leftRow}-${rightRow} is marked as walkable` })
    }
  }

  const sectorCoordinates = area.sectorOrder.map((sector) => area.sectorCentersY[sector])
  for (let index = 1; index < sectorCoordinates.length; index += 1) {
    if (!sameDistance(Math.abs(sectorCoordinates[index] - sectorCoordinates[index - 1]), layout.dimensions.sectorLength)) {
      issues.push({ code: 'SECTOR_LENGTH_MISMATCH', message: `${areaName}: adjacent sector centers are not ${layout.dimensions.sectorLength} m apart` })
    }
  }
}

export function validateWarehouseLayout(layout: WarehouseLayout = warehouseLayout) {
  const issues: GeometryIssue[] = []
  validateArea(layout, layout.upperArea, 'upperArea', issues)
  validateArea(layout, layout.lowerArea, 'lowerArea', issues)

  for (const [upperRow, lowerRow] of layout.oppositeRowsAcrossCentralAisle) {
    const upper = layout.upperArea.rows[String(upperRow)]
    const lower = layout.lowerArea.rows[String(lowerRow)]
    if (!upper || !lower || !sameDistance(upper.x, lower.x)) {
      issues.push({ code: 'OPPOSITE_ROWS_MISMATCH', message: `Rows ${upperRow} and ${lowerRow} do not share the same X coordinate` })
    }
  }

  if (!layout.centralCrossAisle.traversable) {
    issues.push({ code: 'CENTRAL_AISLE_NOT_TRAVERSABLE', message: 'Central cross aisle must be traversable' })
  }
  if (!sameDistance(layout.centralCrossAisle.maxY - layout.centralCrossAisle.minY, layout.dimensions.centralCrossAisleWidth)) {
    issues.push({ code: 'CENTRAL_AISLE_WIDTH_MISMATCH', message: 'Central cross aisle boundaries do not match its width' })
  }
  if (!sameDistance(layout.zone40.startsAtY, layout.upperArea.boundaryY)) {
    issues.push({ code: 'ZONE40_BOUNDARY_MISMATCH', message: 'Zone 40 start does not match the upper measured boundary' })
  }
  const topAisle = layout.zone40.topCrossAisle
  if (!topAisle.exists || !topAisle.traversable) {
    issues.push({ code: 'TOP_AISLE_NOT_TRAVERSABLE', message: 'Confirmed top cross aisle must be present and traversable' })
  }
  if (!topAisle.measured || !sameDistance(topAisle.width, 2) || !sameDistance(topAisle.maxY - topAisle.minY, topAisle.width) || !sameDistance(topAisle.centerY, (topAisle.minY + topAisle.maxY) / 2)) {
    issues.push({ code: 'TOP_AISLE_DIMENSIONS_MISMATCH', message: 'Top cross aisle must be measured as 2.0 m wide' })
  }
  if (!sameDistance(topAisle.minY, layout.upperArea.boundaryY)) {
    issues.push({ code: 'TOP_AISLE_BOUNDARY_MISMATCH', message: 'Top cross aisle must start at the upper rack boundary' })
  }
  for (const position of Object.values(layout.zone40.positions)) {
    const [leftRow, rightRow] = position.oppositeRackBlock
    const left = layout.upperArea.rows[String(leftRow)]
    const right = layout.upperArea.rows[String(rightRow)]
    if (!left || !right || !sameDistance(position.x, (left.x + right.x) / 2)) {
      issues.push({ code: 'ZONE40_X_MISMATCH', message: `${position.locationCode} is not centered over its declared rack block` })
    }
    if (!sameDistance(position.y, topAisle.centerY) || !sameDistance(position.footprint.maxY - position.footprint.minY, layout.zone40.sectorDepth)) {
      issues.push({ code: 'ZONE40_Y_MISMATCH', message: `${position.locationCode} does not match the top aisle or 2.4 m sector depth` })
    }
  }
  if (layout.lowerArea.wallCrossAisle?.exists !== null) {
    issues.push({ code: 'WALL_AISLE_SHOULD_BE_UNRESOLVED', message: 'Wall-side cross aisle must remain unresolved' })
  }
  for (let row = layout.unknownRows.from; row <= layout.unknownRows.to; row += 1) {
    if (layout.upperArea.rows[String(row)] || layout.lowerArea.rows[String(row)]) {
      issues.push({ code: 'UNKNOWN_ROW_HAS_GEOMETRY', message: `Unknown row ${row} must not have geometry` })
    }
  }

  return issues
}
