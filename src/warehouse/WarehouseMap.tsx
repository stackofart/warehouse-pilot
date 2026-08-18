import { AlertTriangle, Boxes, MapPin, PackageSearch, Route, Ruler, Warehouse } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { listProducts, type Product } from '../products/storage'
import { resolveAddress } from './geometry'
import { warehouseLayout } from './layout'
import { shortestPath } from './shortestPath'
import type { Point, RackBlock, RouteResult, WarehouseArea } from './types'

const SVG_WIDTH = 760
const SVG_HEIGHT = 980
const PADDING = 55
const MIN_X = -5.2
const MAX_X = 21.2
const MIN_Y = warehouseLayout.lowerArea.boundaryY
const MAX_Y = Math.max(...Object.values(warehouseLayout.zone40.positions).map((position) => position.footprint.maxY))
const SCALE = Math.min((SVG_WIDTH - PADDING * 2) / (MAX_X - MIN_X), (SVG_HEIGHT - PADDING * 2) / (MAX_Y - MIN_Y))
const MAP_WIDTH = (MAX_X - MIN_X) * SCALE
const MAP_HEIGHT = (MAX_Y - MIN_Y) * SCALE
const OFFSET_X = (SVG_WIDTH - MAP_WIDTH) / 2
const OFFSET_Y = (SVG_HEIGHT - MAP_HEIGHT) / 2

const reasonLabels: Record<string, string> = {
  ADDRESS_26_H_UNKNOWN: 'Геометрия адреса 26.H неизвестна',
  ROWS_11_TO_20_UNKNOWN: 'Геометрия рядов 11–20 неизвестна',
  ROW_GEOMETRY_UNKNOWN: 'Геометрия этого ряда неизвестна',
  SECTOR_GEOMETRY_UNKNOWN: 'Геометрия этого сектора неизвестна',
  INVALID_ADDRESS_FORMAT: 'Используйте формат адреса 23.F',
  WAREHOUSE_LAYOUT_INVALID: 'Спецификация склада геометрически некорректна',
  PATH_NOT_FOUND: 'Между адресами нет подтверждённого прохода',
}

function mapX(x: number) {
  return OFFSET_X + (x - MIN_X) * SCALE
}

function mapY(y: number) {
  return OFFSET_Y + (MAX_Y - y) * SCALE
}

function blockBounds(area: WarehouseArea, block: RackBlock) {
  const rowXs = block.rows.map((row) => area.rows[String(row)].x)
  if (block.type === 'back_to_back') return { minX: Math.min(...rowXs), maxX: Math.max(...rowXs) }
  const x = rowXs[0]
  const allXs = Object.values(area.rows).map((row) => row.x)
  return x === Math.min(...allXs)
    ? { minX: x - warehouseLayout.dimensions.singleRackDepth, maxX: x }
    : { minX: x, maxX: x + warehouseLayout.dimensions.singleRackDepth }
}

function productLocations(products: Product[]) {
  const measured = new Map<string, { point: Point; products: Product[] }>()
  const unresolved: Product[] = []
  for (const product of products) {
    const resolution = resolveAddress(product.location)
    if (resolution.status !== 'resolved') {
      unresolved.push(product)
      continue
    }
    const current = measured.get(resolution.address.canonical)
    if (current) current.products.push(product)
    else measured.set(resolution.address.canonical, { point: resolution.point, products: [product] })
  }
  return { measured: [...measured.entries()], unresolved }
}

function RackArea({ area, areaName }: { area: WarehouseArea; areaName: 'upper' | 'lower' }) {
  const minY = areaName === 'upper' ? warehouseLayout.centralCrossAisle.maxY : area.boundaryY
  const maxY = areaName === 'upper' ? area.boundaryY : warehouseLayout.centralCrossAisle.minY
  return (
    <g>
      {area.walkableAislesBetweenRows.map(([leftRow, rightRow]) => {
        const leftX = area.rows[String(leftRow)].x
        const rightX = area.rows[String(rightRow)].x
        const centerX = (leftX + rightX) / 2
        return <g key={`aisle-${areaName}-${leftRow}-${rightRow}`}><rect className="map-aisle" x={mapX(Math.min(leftX, rightX))} y={mapY(maxY)} width={Math.abs(rightX - leftX) * SCALE} height={(maxY - minY) * SCALE} />{area.sectorOrder.map((sector) => <text key={sector} className="map-sector-cell-label" x={mapX(centerX)} y={mapY(area.sectorCentersY[sector]) + 3}>{sector}</text>)}</g>
      })}
      {area.rackBlocks.map((block) => {
        const bounds = blockBounds(area, block)
        return (
          <g key={`rack-${areaName}-${block.rows.join('-')}`}>
            <rect className="map-rack" x={mapX(bounds.minX)} y={mapY(maxY)} width={(bounds.maxX - bounds.minX) * SCALE} height={(maxY - minY) * SCALE} rx="2" />
            {block.rows.map((row) => {
              const rowX = area.rows[String(row)].x
              const labelX = rowX + Math.sign((bounds.minX + bounds.maxX) / 2 - rowX) * .42
              const labelY = areaName === 'upper' ? maxY - .48 : minY + .48
              return <text key={row} className="map-row-label" x={mapX(labelX)} y={mapY(labelY) + 3}>{row}</text>
            })}
          </g>
        )
      })}
      {Object.entries(area.rows).map(([row, geometry]) => (
        <line key={`front-${areaName}-${row}`} className="map-picking-front" x1={mapX(geometry.x)} y1={mapY(maxY)} x2={mapX(geometry.x)} y2={mapY(minY)} />
      ))}
    </g>
  )
}

export function WarehouseMap() {
  const [products, setProducts] = useState<Product[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const [loadingError, setLoadingError] = useState('')

  useEffect(() => {
    listProducts().then(setProducts).catch((reason) => {
      console.error(reason)
      setLoadingError('Не удалось загрузить товары')
    })
  }, [])

  const locations = useMemo(() => productLocations(products), [products])
  const locationOptions = useMemo(() => [...new Set(products.map((product) => product.location).filter(Boolean))].sort(), [products])

  const buildRoute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRouteResult(shortestPath(from, to))
  }

  const routePoints = routeResult?.status === 'resolved'
    ? routeResult.points.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(' ')
    : ''

  return (
    <div className="page warehouse-page">
      <div className="page-heading warehouse-heading">
        <div>
          <p className="eyebrow">ИЗМЕРЕННАЯ ГЕОМЕТРИЯ</p>
          <h1>Карта склада</h1>
          <p>Стеллажи, проходы и маршруты построены только по данным warehouse-layout.json.</p>
        </div>
        <div className="map-scale-badge"><Ruler size={17} /><div><strong>1:1 по данным</strong><span>Все расстояния в метрах</span></div></div>
      </div>

      <div className="unresolved-map-strip confirmed-map-strip">
        <Ruler size={18} />
        <div><strong>Верхний проход включён в метрическую карту</strong><span>Ширина 2,0 м · глубина сектора 2,4 м · 40.A над 24–25 · 40.B над 26–27 · 40.D/финиш над 28–29.</span></div>
      </div>

      <div className="warehouse-map-layout">
        <section className="warehouse-map-card">
          <div className="map-card-heading"><div><Warehouse size={18} /><span><strong>Метрическая карта склада</strong><small>Y: −20.4 … 22.4 м</small></span></div><span>{locations.measured.length} адресов с товарами</span></div>
          <div className="warehouse-svg-wrap">
            <svg className="warehouse-svg" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="Карта измеренной части склада">
              <rect className="map-background" x={mapX(MIN_X)} y={mapY(MAX_Y)} width={MAP_WIDTH} height={MAP_HEIGHT} rx="5" />

              {warehouseLayout.upperArea.sectorOrder.map((sector) => {
                const y = warehouseLayout.upperArea.sectorCentersY[sector]
                return <line key={`upper-sector-${sector}`} className="map-sector-line" x1={mapX(MIN_X)} y1={mapY(y)} x2={mapX(MAX_X)} y2={mapY(y)} />
              })}
              {warehouseLayout.lowerArea.sectorOrder.map((sector) => {
                const y = warehouseLayout.lowerArea.sectorCentersY[sector]
                return <line key={`lower-sector-${sector}`} className="map-sector-line" x1={mapX(MIN_X)} y1={mapY(y)} x2={mapX(MAX_X)} y2={mapY(y)} />
              })}

              <RackArea area={warehouseLayout.upperArea} areaName="upper" />
              <RackArea area={warehouseLayout.lowerArea} areaName="lower" />

              <rect className="map-top-aisle" x={mapX(MIN_X)} y={mapY(warehouseLayout.zone40.topCrossAisle.maxY)} width={MAP_WIDTH} height={warehouseLayout.zone40.topCrossAisle.width * SCALE} />
              <line className="map-top-center" x1={mapX(MIN_X)} y1={mapY(warehouseLayout.zone40.topCrossAisle.centerY)} x2={mapX(MAX_X)} y2={mapY(warehouseLayout.zone40.topCrossAisle.centerY)} />
              <text className="map-top-label" x={mapX(MIN_X) + 10} y={mapY(warehouseLayout.zone40.topCrossAisle.centerY) - 7}>ВЕРХНИЙ ПРОХОД · 2,0 м</text>
              {Object.values(warehouseLayout.zone40.positions).map((position) => <g key={position.locationCode}><rect className={position.role === 'finish' ? 'map-zone40 map-zone40-finish' : 'map-zone40'} x={mapX(position.footprint.minX)} y={mapY(position.footprint.maxY)} width={(position.footprint.maxX - position.footprint.minX) * SCALE} height={(position.footprint.maxY - position.footprint.minY) * SCALE} rx="2" /><text className="map-zone40-label" x={mapX(position.x)} y={mapY((position.footprint.minY + position.footprint.maxY) / 2) + 3}>{position.locationCode}{position.role === 'finish' ? ' · ФИНИШ' : ''}</text></g>)}

              <rect className="map-central-aisle" x={mapX(MIN_X)} y={mapY(warehouseLayout.centralCrossAisle.maxY)} width={MAP_WIDTH} height={warehouseLayout.dimensions.centralCrossAisleWidth * SCALE} />
              <line className="map-central-center" x1={mapX(MIN_X)} y1={mapY(0)} x2={mapX(MAX_X)} y2={mapY(0)} />
              <text className="map-central-label" x={mapX(MIN_X) + 10} y={mapY(0) - 8}>ЦЕНТРАЛЬНЫЙ ПРОХОД · 2.4 м</text>

              {routePoints && <polyline className="map-route-line" points={routePoints} />}

              {locations.measured.map(([address, entry]) => (
                <g className="map-product-marker" key={address} transform={`translate(${mapX(entry.point.x)} ${mapY(entry.point.y)})`}>
                  <circle r="10" />
                  <text y="3">{entry.products.length}</text>
                  <title>{`${address}: ${entry.products.map((product) => product.name).join(', ')}`}</title>
                </g>
              ))}

              {routeResult?.status === 'resolved' && <><circle className="map-route-start" cx={mapX(routeResult.points[0].x)} cy={mapY(routeResult.points[0].y)} r="7" /><circle className="map-route-finish" cx={mapX(routeResult.points.at(-1)!.x)} cy={mapY(routeResult.points.at(-1)!.y)} r="7" /></>}

            </svg>
          </div>
          <div className="map-legend"><span><i className="legend-rack" />Стеллаж</span><span><i className="legend-aisle" />Проход</span><span><i className="legend-product" />Товар</span><span><i className="legend-route" />Маршрут</span></div>
        </section>

        <aside className="map-controls">
          <section className="route-card">
            <div className="map-side-heading"><Route size={19} /><div><p className="section-kicker">МАРШРУТ</p><h2>Между адресами</h2></div></div>
            <form onSubmit={buildRoute}>
              <label><span>Откуда</span><input aria-label="Начальный адрес маршрута" list="warehouse-addresses" placeholder="23.F" value={from} onChange={(event) => setFrom(event.target.value.toUpperCase())} /></label>
              <label><span>Куда</span><input aria-label="Конечный адрес маршрута" list="warehouse-addresses" placeholder="40.B" value={to} onChange={(event) => setTo(event.target.value.toUpperCase())} /></label>
              <datalist id="warehouse-addresses">{locationOptions.map((location) => <option key={location} value={location} />)}</datalist>
              <button className="primary-button" type="submit"><Route size={16} />Построить маршрут</button>
            </form>
            {routeResult?.status === 'resolved' && <div className="route-distance"><strong>{routeResult.distance.toFixed(1)} м</strong><span>{routeResult.nodeIds.length} точек графа</span></div>}
            {routeResult && routeResult.status !== 'resolved' && <div className="route-error"><AlertTriangle size={16} /><span>{reasonLabels[routeResult.reason] ?? routeResult.reason}</span></div>}
          </section>

          <section className="map-info-card">
            <div className="map-side-heading"><PackageSearch size={19} /><div><p className="section-kicker">ТОВАРЫ</p><h2>На карте</h2></div></div>
            <div className="map-stat"><Boxes size={16} /><span><strong>{products.length}</strong> товаров · <strong>{locations.measured.length}</strong> измеренных адресов</span></div>
            {loadingError && <p className="product-form-error">{loadingError}</p>}
            {locations.unresolved.length > 0 && <div className="unresolved-products"><strong>Без точной геометрии</strong>{locations.unresolved.map((product) => <span key={product.id}><MapPin size={12} />{product.location} · <b dir="auto">{product.name}</b></span>)}</div>}
          </section>

          <section className="map-info-card unresolved-object-card">
            <div className="map-side-heading"><AlertTriangle size={19} /><div><p className="section-kicker">UNRESOLVED</p><h2>Не на шкале</h2></div></div>
            <ul><li><b>26.H:</b> сектор не измерен</li><li><b>Выход паллет:</b> X неизвестен</li><li><b>Проход у стены:</b> существование не подтверждено</li></ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
