import { resolveAddress } from '../warehouse/geometry'
import { warehouseLayout } from '../warehouse/layout'
import type { AddressHeat } from './analytics'

const WIDTH = 760
const HEIGHT = 410
const PAD = 32
const MIN_X = -5.2
const MAX_X = 21.2
const MIN_Y = warehouseLayout.lowerArea.boundaryY
const MAX_Y = Math.max(...Object.values(warehouseLayout.zone40.positions).map((position) => position.footprint.maxY))
const SCALE = Math.min((WIDTH - PAD * 2) / (MAX_X - MIN_X), (HEIGHT - PAD * 2) / (MAX_Y - MIN_Y))
const OFFSET_X = (WIDTH - (MAX_X - MIN_X) * SCALE) / 2
const OFFSET_Y = (HEIGHT - (MAX_Y - MIN_Y) * SCALE) / 2

const mapX = (x: number) => OFFSET_X + (x - MIN_X) * SCALE
const mapY = (y: number) => OFFSET_Y + (MAX_Y - y) * SCALE

type HeatPoint = {
  key: string
  x: number
  y: number
  boxes: number
  lines: number
  addresses: string[]
}

export function OverviewHeatmap({ entries }: { entries: AddressHeat[] }) {
  const points = new Map<string, HeatPoint>()
  for (const entry of entries) {
    const resolution = resolveAddress(entry.address)
    if (resolution.status !== 'resolved') continue
    const key = `${resolution.point.x}:${resolution.point.y}`
    const current = points.get(key) ?? { key, ...resolution.point, boxes: 0, lines: 0, addresses: [] }
    current.boxes += entry.boxes
    current.lines += entry.lines
    current.addresses.push(entry.address)
    points.set(key, current)
  }
  const heatPoints = [...points.values()]
  const maximum = Math.max(1, ...heatPoints.map((point) => point.boxes))

  return (
    <svg className="overview-heatmap-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Тепловая карта частоты комплектации по адресам склада">
      <rect className="overview-map-background" x={mapX(MIN_X)} y={mapY(MAX_Y)} width={(MAX_X - MIN_X) * SCALE} height={(MAX_Y - MIN_Y) * SCALE} rx="7" />
      <rect className="overview-map-cross-aisle" x={mapX(MIN_X)} y={mapY(warehouseLayout.centralCrossAisle.maxY)} width={(MAX_X - MIN_X) * SCALE} height={warehouseLayout.dimensions.centralCrossAisleWidth * SCALE} />
      <rect className="overview-map-cross-aisle top" x={mapX(MIN_X)} y={mapY(warehouseLayout.zone40.topCrossAisle.maxY)} width={(MAX_X - MIN_X) * SCALE} height={warehouseLayout.zone40.topCrossAisle.width * SCALE} />

      {[warehouseLayout.upperArea, warehouseLayout.lowerArea].flatMap((area) => area.walkableAislesBetweenRows.map(([left, right]) => {
        const x = (area.rows[String(left)].x + area.rows[String(right)].x) / 2
        return <line key={`${left}-${right}`} className="overview-map-aisle-axis" x1={mapX(x)} y1={mapY(area.boundaryY)} x2={mapX(x)} y2={mapY(area === warehouseLayout.upperArea ? warehouseLayout.centralCrossAisle.maxY : warehouseLayout.centralCrossAisle.minY)} />
      }))}

      {Object.values(warehouseLayout.zone40.positions).map((position) => (
        <g key={position.locationCode}>
          <rect className="overview-map-gate" x={mapX(position.footprint.minX)} y={mapY(position.footprint.maxY)} width={(position.footprint.maxX - position.footprint.minX) * SCALE} height={(position.footprint.maxY - position.footprint.minY) * SCALE} rx="2" />
          <text className="overview-map-gate-label" x={mapX(position.x)} y={mapY((position.footprint.minY + position.footprint.maxY) / 2) + 3}>{position.locationCode}</text>
        </g>
      ))}

      {heatPoints.map((point) => {
        const ratio = point.boxes / maximum
        const radius = 8 + Math.sqrt(ratio) * 18
        return (
          <g className="overview-heat-point" key={point.key} transform={`translate(${mapX(point.x)} ${mapY(point.y)})`}>
            <circle r={radius} style={{ opacity: .28 + ratio * .62 }} />
            <text y="4">{Math.round(point.boxes)}</text>
            <title>{`${point.addresses.join(' / ')}: ${point.boxes.toFixed(0)} кор., ${point.lines} поз.`}</title>
          </g>
        )
      })}
      {!heatPoints.length && <text className="overview-map-empty" x={WIDTH / 2} y={HEIGHT / 2}>В выбранном периоде нет адресов</text>}
    </svg>
  )
}
