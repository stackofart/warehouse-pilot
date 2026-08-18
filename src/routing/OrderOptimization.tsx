import { AlertTriangle, Box, Check, ClipboardList, Cuboid, MapPin, PackageCheck, Route, Scale, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listOrders, type SavedOrder } from '../orders/storage'
import { optimizePallet } from '../pallet/packing'
import { PalletScene } from '../pallet/PalletScene'
import { listProducts, type Product } from '../products/storage'
import { optimizeOrderRoute } from './optimizer'

const issueLabels: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'товар отсутствует в базе',
  BOX_COUNT_UNKNOWN: 'неизвестно число коробок',
  BOX_DIMENSIONS_MISSING: 'не заполнены габариты коробки',
  BOX_WEIGHT_MISSING: 'не заполнен вес коробки',
  RATINGS_MISSING: 'не заданы жёсткость и хрупкость',
  NO_SAFE_POSITION: 'не найдено безопасное место',
}

export function OrderOptimization() {
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedId, setSelectedId] = useState(() => decodeURIComponent(window.location.hash.split('/')[1] ?? ''))
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listOrders(), listProducts()]).then(([savedOrders, savedProducts]) => {
      setOrders(savedOrders)
      setProducts(savedProducts)
      if (!selectedId && savedOrders[0]) setSelectedId(savedOrders[0].id)
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось загрузить данные заказа')
    })
  }, [selectedId])

  const order = orders.find((candidate) => candidate.id === selectedId) ?? orders[0]
  const routePlan = useMemo(() => order ? optimizeOrderRoute(order.items) : null, [order])
  const recommendedPlan = useMemo(() => order ? optimizePallet(order, products) : null, [order, products])
  const fixedPlacements = useMemo(() => recommendedPlan?.placements.filter((placement) => fixedIds.has(placement.id)).map((placement) => ({ ...placement, fixed: true })) ?? [], [fixedIds, recommendedPlan])

  const selectOrder = (id: string) => {
    setSelectedId(id)
    setFixedIds(new Set())
    window.location.hash = `route/${encodeURIComponent(id)}`
  }

  const toggleFixed = (id: string) => setFixedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  if (error) return <div className="page"><div className="orders-empty"><AlertTriangle size={29} /><strong>{error}</strong></div></div>
  if (!order) return <div className="page"><div className="orders-empty"><ClipboardList size={29} /><strong>Нет сохранённых заказов</strong><a className="primary-button" href="#new-order">Создать заказ</a></div></div>

  return (
    <div className="page optimization-page">
      <div className="page-heading optimization-heading">
        <div><p className="eyebrow">ОПТИМИЗАЦИЯ ЗАКАЗА</p><h1>Маршрут и паллета</h1><p>Сначала кратчайший обход по осям проходов склада, затем рекомендация укладки по данным коробок.</p></div>
        <label className="order-selector"><span>Заказ</span><select aria-label="Заказ для оптимизации" value={order.id} onChange={(event) => selectOrder(event.target.value)}>{orders.map((savedOrder) => <option key={savedOrder.id} value={savedOrder.id}>{savedOrder.orderNumber || 'Без номера'}</option>)}</select></label>
      </div>

      <section className="optimization-route-card">
        <div className="optimization-card-heading"><div><Route size={20} /><span><p className="section-kicker">БЫСТРЫЙ ОБХОД</p><h2>Рекомендуемый порядок комплектации</h2></span></div>{routePlan && (routePlan.status === 'resolved' || routePlan.status === 'partial') && <div className="route-total"><strong>{routePlan.totalDistance.toFixed(1)} м</strong><span>{routePlan.algorithm === 'held-karp' ? 'Held–Karp по измеренному графу' : 'NN + 2-opt по измеренному графу'}</span></div>}</div>
        {routePlan && (routePlan.status === 'resolved' || routePlan.status === 'partial') ? <>
          <div className="route-start-note"><MapPin size={15} /><span>Старт: измеренный центр центрального прохода `(0, 0)`. Выход паллет не используется, потому что его X пока неизвестен.</span></div>
          <div className="route-stop-list">{routePlan.stops.map((stop, index) => <article key={stop.address}><span>{index + 1}</span><div><strong>{stop.address}</strong><small>+{stop.distanceFromPrevious.toFixed(1)} м · {stop.items.length} поз.</small></div><ul>{stop.items.map((item) => <li key={item.row} dir="auto">{item.description} · {item.boxCount || '?'} кор.</li>)}</ul></article>)}</div>
          {routePlan.unresolved.length > 0 && <div className="optimization-warning"><AlertTriangle size={17} /><span>Маршрут частичный: {routePlan.unresolved.map((entry) => entry.address).join(', ')} имеют неизвестную геометрию.</span></div>}
        </> : <div className="optimization-warning"><AlertTriangle size={17} /><span>Невозможно построить измеренный маршрут для этого заказа.</span></div>}
      </section>

      <div className="pallet-section-heading"><div><Sparkles size={19} /><span><p className="section-kicker">3D-КОМПОНОВКА</p><h2>Рекомендованная и фактическая паллета 120×80 см</h2></span></div><p>Тяжёлые и крупные жёсткие коробки рассматриваются первыми. Укладка сверху разрешается только при заполненной допустимой нагрузке.</p></div>
      {recommendedPlan && recommendedPlan.requiredPallets > 1 && <div className="pallet-split-notice"><AlertTriangle size={17} /><span><strong>Для заказа требуется паллет: {recommendedPlan.requiredPallets}</strong><small>Ни на одной паллете не будет больше шести слоёв. Полный просмотр доступен в отдельной вкладке.</small></span><a className="secondary-button" href="#pallet">Открыть паллеты</a></div>}

      <div className="pallet-plans-grid">
        <section className="pallet-plan-card">
          <div className="pallet-card-heading"><div><Cuboid size={18} /><span><strong>Рекомендованная компоновка</strong><small>Не изменяется при отметке фактически установленных коробок</small></span></div>{recommendedPlan && <span>{recommendedPlan.placements.length} кор.</span>}</div>
          <PalletScene placements={recommendedPlan?.placements ?? []} emptyLabel="Заполните габариты коробок в базе товаров" />
          {recommendedPlan && <div className="pallet-metrics"><span><Scale size={14} /><b>{recommendedPlan.totalWeightKg.toFixed(1)} кг</b></span><span><Box size={14} /><b>{recommendedPlan.heightCm.toFixed(0)} см</b></span><span><Sparkles size={14} /><b>{(recommendedPlan.volumeUtilization * 100).toFixed(0)}%</b> объёма</span></div>}
        </section>

        <section className="pallet-plan-card actual-pallet-card">
          <div className="pallet-card-heading"><div><PackageCheck size={18} /><span><strong>Фактически установлено</strong><small>Отмечайте коробки по мере сборки</small></span></div><span>{fixedPlacements.length} кор.</span></div>
          <PalletScene placements={fixedPlacements} emptyLabel="Пока ни одна коробка не отмечена установленной" />
          <div className="placement-checklist">{(recommendedPlan?.placements ?? []).map((placement) => <label key={placement.id}><input type="checkbox" checked={fixedIds.has(placement.id)} onChange={() => toggleFixed(placement.id)} /><span><Check size={12} /></span><b dir="auto">{placement.name}</b><small>{placement.weightKg} кг · z {placement.z.toFixed(0)} см</small></label>)}</div>
        </section>
      </div>

      {recommendedPlan && recommendedPlan.issues.length > 0 && <section className="packing-issues"><div><AlertTriangle size={18} /><span><strong>Не включено в точную компоновку: {recommendedPlan.issues.length}</strong><small>Размеры и вес не подставляются автоматически.</small></span></div><ul>{recommendedPlan.issues.map((issue, index) => <li key={`${issue.orderRow}-${issue.reason}-${index}`}><b>Строка {issue.orderRow} · {issue.sku}</b><span dir="auto">{issue.name}</span><em>{issueLabels[issue.reason]}</em></li>)}</ul><a className="secondary-button" href="#products">Заполнить характеристики товаров</a></section>}
    </div>
  )
}
