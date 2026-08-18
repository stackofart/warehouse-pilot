import { AlertTriangle, Box, Boxes, Cuboid, Minus, PackageCheck, Plus, Scale, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listOrders, type SavedOrder } from '../orders/storage'
import { listProducts, type Product } from '../products/storage'
import { optimizePallet } from './packing'
import { PalletScene } from './PalletScene'
import { demoOrders, demoProducts } from './demoData'

export function PalletWorkspace() {
  const [orders, setOrders] = useState<SavedOrder[]>(demoOrders)
  const [products, setProducts] = useState<Product[]>(demoProducts)
  const [orderId, setOrderId] = useState('')
  const [actualIds, setActualIds] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'recommended' | 'actual'>('recommended')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [palletIndex, setPalletIndex] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listOrders(), listProducts()]).then(([savedOrders, savedProducts]) => {
      setOrders([...savedOrders, ...demoOrders])
      setProducts([...savedProducts, ...demoProducts])
      setOrderId((current) => current || savedOrders[0]?.id || demoOrders[0].id)
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось загрузить данные для паллеты')
    })
  }, [])

  const order = orders.find((candidate) => candidate.id === orderId)
  const plan = useMemo(() => order ? optimizePallet(order, products) : null, [order, products])
  const allPlacements = useMemo(() => plan?.pallets.flatMap((pallet) => pallet.placements) ?? [], [plan])
  const currentPallet = plan?.pallets[palletIndex]
  const actual = useMemo(() => allPlacements.filter((placement) => placement.palletIndex === palletIndex && actualIds.has(placement.id)).map((placement) => ({ ...placement, fixed: true })), [actualIds, allPlacements, palletIndex])
  const groups = useMemo(() => {
    const result = new Map<string, { productId: string; sku: string; name: string; placements: NonNullable<typeof plan>['placements'] }>()
    for (const placement of allPlacements) {
      const group = result.get(placement.productId) ?? { productId: placement.productId, sku: placement.sku, name: placement.name, placements: [] }
      group.placements.push(placement)
      result.set(placement.productId, group)
    }
    return [...result.values()]
  }, [allPlacements])
  const scenePlacements = view === 'recommended' ? currentPallet?.placements ?? [] : actual

  const changeActual = (productId: string, delta: 1 | -1) => {
    const group = groups.find((candidate) => candidate.productId === productId)
    if (!group) return
    setActualIds((current) => {
      const next = new Set(current)
      if (delta > 0) {
        const placement = group.placements.find((candidate) => !next.has(candidate.id))
        if (placement) next.add(placement.id)
      } else {
        const placement = [...group.placements].reverse().find((candidate) => next.has(candidate.id))
        if (placement) next.delete(placement.id)
      }
      return next
    })
  }

  if (error) return <div className="page"><div className="orders-empty"><AlertTriangle size={28} /><strong>{error}</strong></div></div>
  return (
    <div className="page pallet-workspace-page">
      <div className="page-heading pallet-workspace-heading">
        <div><p className="eyebrow">ПАЛЛЕТА 120×80 СМ</p><h1>3D-компоновка</h1><p>Отдельное рабочее место для проверки рекомендации и фиксации реально установленных коробок.</p></div>
        <label className="order-selector"><span>Заказ или сценарий</span><select aria-label="Заказ для 3D-компоновки" value={orderId} onChange={(event) => { setOrderId(event.target.value); setActualIds(new Set()); setSelectedProductId(''); setPalletIndex(0) }}>{orders.map((savedOrder) => <option key={savedOrder.id} value={savedOrder.id}>{savedOrder.orderNumber || 'Без номера'}</option>)}</select></label>
      </div>

      {plan && plan.requiredPallets > 1 && <div className="pallet-split-notice"><AlertTriangle size={17} /><span><strong>Заказ требует {plan.requiredPallets} паллеты</strong><small>На каждой не более шести слоёв. Крупные коробки размещаются первыми, более мелкие остатки переносятся на следующую паллету.</small></span></div>}

      <div className="pallet-workspace-grid">
        <section className="pallet-workspace-scene-card">
          <div className="pallet-workspace-toolbar">
            <div className="pallet-view-tabs"><button className={view === 'recommended' ? 'active' : ''} type="button" onClick={() => setView('recommended')}><Sparkles size={15} />Рекомендация</button><button className={view === 'actual' ? 'active' : ''} type="button" onClick={() => setView('actual')}><PackageCheck size={15} />Фактически установлено · {actual.length}</button></div>
            <label><span>Выделить товар</span><select aria-label="Выделить товар на паллете" value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}><option value="">Все товары</option>{groups.map((group) => <option key={group.productId} value={group.productId}>{group.sku} · {group.name}</option>)}</select></label>
          </div>
          {plan && plan.pallets.length > 1 && <div className="pallet-load-tabs">{plan.pallets.map((pallet) => <button key={pallet.index} className={palletIndex === pallet.index ? 'active' : ''} type="button" onClick={() => setPalletIndex(pallet.index)}>Паллета {pallet.index + 1}<small>{pallet.placements.length} кор. · {pallet.layerCount} сл.</small></button>)}</div>}
          <PalletScene placements={scenePlacements} selectedProductId={selectedProductId} emptyLabel={view === 'actual' ? 'Ни одна коробка пока не отмечена как установленная' : 'Нет коробок с заполненными характеристиками'} />
          {currentPallet && <div className="pallet-workspace-metrics"><span><Boxes size={15} /><b>{currentPallet.placements.length}</b> коробок</span><span><Scale size={15} /><b>{currentPallet.totalWeightKg.toFixed(1)}</b> кг</span><span><Cuboid size={15} /><b>{currentPallet.heightCm.toFixed(0)}</b> см</span><span><Box size={15} /><b>{currentPallet.layerCount}</b> из 6 слоёв</span><span><Sparkles size={15} /><b>{(currentPallet.volumeUtilization * 100).toFixed(0)}%</b> объёма</span></div>}
        </section>

        <aside className="pallet-inventory-card">
          <div className="pallet-inventory-heading"><PackageCheck size={19} /><span><p className="section-kicker">ФАКТИЧЕСКАЯ СБОРКА</p><h2>Коробки заказа</h2></span></div>
          <p className="pallet-inventory-note">Кнопки меняют только фактическое состояние. Рекомендованная раскладка остаётся неизменной.</p>
          <div className="pallet-product-groups">{groups.map((group) => {
            const actualCount = group.placements.filter((placement) => actualIds.has(placement.id)).length
            return <article key={group.productId} className={selectedProductId === group.productId ? 'selected' : ''} onClick={() => setSelectedProductId(group.productId)}><div><strong dir="auto">{group.name}</strong><small>{group.sku} · {actualCount} из {group.placements.length} установлено</small></div><div><button type="button" aria-label={`Убрать коробку ${group.name}`} disabled={!actualCount} onClick={(event) => { event.stopPropagation(); changeActual(group.productId, -1) }}><Minus size={14} /></button><b>{actualCount}</b><button type="button" aria-label={`Добавить коробку ${group.name}`} disabled={actualCount >= group.placements.length} onClick={(event) => { event.stopPropagation(); changeActual(group.productId, 1) }}><Plus size={14} /></button></div></article>
          })}</div>
          {plan?.issues.length ? <div className="pallet-workspace-issues"><AlertTriangle size={16} /><span>{plan.issues.length} коробок или строк не удалось включить. Проверьте данные товаров.</span></div> : null}
        </aside>
      </div>
    </div>
  )
}
