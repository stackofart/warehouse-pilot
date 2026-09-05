import { AlertTriangle, Box, Boxes, Cuboid, Minus, PackageCheck, Plus, Scale, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listOrders, type SavedOrder } from '../orders/storage'
import { type Product } from '../products/storage'
import { productsForOrders } from '../products/catalogRepository'
import { type PalletPlacement } from './packing'
import { usePalletPlan } from './usePalletPlan'
import { flushPallets, loadPalletState, savePalletState, type PalletState } from './storage'
import { PalletScene } from './PalletScene'
import { demoOrders, demoProducts } from './demoData'

function palletOrderIdFromHash() {
  const encodedId = window.location.hash.match(/^#(?:admin\/)?pallet\/(.+)$/)?.[1] ?? ''
  try {
    return decodeURIComponent(encodedId)
  } catch {
    return ''
  }
}

export function PalletWorkspace() {
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showDemos, setShowDemos] = useState(false)
  const [orderId, setOrderId] = useState(palletOrderIdFromHash)
  const [fixed, setFixed] = useState<PalletPlacement[]>([])
  const [stored, setStored] = useState<PalletState | null>(null)
  const [saving, setSaving] = useState(false)
  const actualIds = useMemo(() => new Set(fixed.map(box => box.id)), [fixed])
  const [loadedKey, setLoadedKey] = useState('')
  const [maxHeightCm, setMaxHeightCm] = useState(180)
  const [maxWeightKg, setMaxWeightKg] = useState(800)
  const [inspectable, setInspectable] = useState(true)
  const options = useMemo(() => ({ maxHeightCm, maxWeightKg, inspectable }), [maxHeightCm, maxWeightKg, inspectable])
  const [view, setView] = useState<'recommended' | 'actual'>('recommended')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [palletIndex, setPalletIndex] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    listOrders().then(async savedOrders => {
      const savedProducts = await productsForOrders(savedOrders)
      setOrders([...savedOrders, ...(showDemos ? demoOrders : [])])
      setProducts([...savedProducts, ...demoProducts])
      setOrderId((current) => [...savedOrders, ...(showDemos ? demoOrders : [])].some(order => order.id === current) ? current : savedOrders[0]?.id || (showDemos ? demoOrders[0].id : ''))
    }).catch((reason) => {
      console.error(reason)
      setError('Не удалось загрузить данные для паллеты')
    })
  }, [showDemos])

  useEffect(() => {
    let cancelled = false
    setLoadedKey('')
    if (!orderId) return
    const load = async () => {
      const saved = await loadPalletState(orderId, demoOrders.some(order => order.id === orderId))
      if (!cancelled) { setFixed(saved.placements); setStored(saved); setLoadedKey(orderId); setError('') }
    }
    void load().catch(reason => setError(String(reason)))
    return () => { cancelled = true }
  }, [orderId])

  const order = orders.find((candidate) => candidate.id === orderId)
  const { plan, working, error: calculationError } = usePalletPlan(loadedKey === orderId ? order : undefined, products, fixed, options)
  const allPlacements = useMemo(() => plan?.pallets.flatMap((pallet) => pallet.placements) ?? [], [plan])
  const currentPallet = plan?.pallets.find(pallet => pallet.index === palletIndex)
  useEffect(() => { if (plan?.pallets.length && !plan.pallets.some(pallet => pallet.index === palletIndex)) setPalletIndex(plan.pallets[0].index) }, [plan, palletIndex])
  const actual = useMemo(() => fixed.filter(placement => placement.palletIndex === palletIndex), [fixed, palletIndex])
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

  const changeActual = async (productId: string, delta: 1 | -1) => {
    const group = groups.find((candidate) => candidate.productId === productId)
    if (!group || !stored || saving || working) return
    let next = [...fixed]
      if (delta > 0) {
        const placement = group.placements.find((candidate) => !next.some(box => box.id === candidate.id))
        if (placement) next.push({ ...placement, fixed: true })
      } else {
        const placement = [...group.placements].reverse().find((candidate) => next.some(box => box.id === candidate.id))
        if (placement) next = next.filter(box => box.id !== placement.id)
      }
    setSaving(true)
    try { const saved = await savePalletState(stored, next, demoOrders.some(order => order.id === orderId)); setStored(saved); setFixed(saved.placements); setError('') }
    catch (reason) { setError(String(reason)) } finally { setSaving(false) }
  }
  const reload = async (discard = false) => {
    if (discard && !confirm('Отменить локальные изменения компоновки и принять серверную версию?')) return
    setSaving(true)
    try { await flushPallets(); const state = await loadPalletState(orderId, demoOrders.some(order => order.id === orderId), discard); setStored(state); setFixed(state.placements); setLoadedKey(orderId); setError('') } catch (reason) { setError(String(reason)) } finally { setSaving(false) }
  }
  return (
    <div className="page pallet-workspace-page">
      {error && <p role="alert" className="operations-message">{error}</p>}
      {stored && <div className="operations-toolbar"><span>{demoOrders.some(order => order.id === orderId) ? 'Демо, только на устройстве' : stored.status === 'synced' ? 'Компоновка сохранена в общей базе' : stored.status === 'pending' ? 'Компоновка на устройстве, ожидает отправки' : stored.error}</span><button disabled={saving} onClick={() => void reload()}>Синхронизировать</button>{stored.status === 'conflict' && <button disabled={saving} onClick={() => void reload(true)}>Принять серверную версию</button>}</div>}
      <div className="page-heading pallet-workspace-heading">
        <div><p className="eyebrow">ПАЛЛЕТА 120×80 СМ</p><h1>3D-компоновка</h1><p>Отдельное рабочее место для проверки рекомендации и фиксации реально установленных коробок.</p></div>
        <label className="order-selector"><span>Заказ</span><select aria-label="Заказ для 3D-компоновки" value={orderId} onChange={(event) => { const id = event.target.value; setOrderId(id); setLoadedKey(''); setSelectedProductId(''); setPalletIndex(0); window.location.hash = `pallet/${encodeURIComponent(id)}` }}>{orders.map((savedOrder) => <option key={savedOrder.id} value={savedOrder.id}>{demoOrders.some(demo => demo.id === savedOrder.id) ? 'ДЕМО · ' : ''}{savedOrder.orderNumber || 'Без номера'}</option>)}</select></label>
      </div>

      {plan && plan.requiredPallets > 1 && <div className="pallet-split-notice"><AlertTriangle size={17} /><span><strong>Заказ требует {plan.requiredPallets} паллеты</strong><small>На каждой не более шести слоёв. Крупные коробки размещаются первыми, более мелкие остатки переносятся на следующую паллету.</small></span></div>}

      <div className="operations-toolbar"><label><input type="checkbox" checked={showDemos} onChange={e => setShowDemos(e.target.checked)} />Показать демонстрационные заказы</label><label>Высота, см <input type="number" min="1" max="300" value={maxHeightCm} onChange={e => setMaxHeightCm(Math.max(1, Math.min(300, Number(e.target.value) || 1)))} /></label><label>Масса, кг <input type="number" min="1" max="2000" value={maxWeightKg} onChange={e => setMaxWeightKg(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} /></label><label><input type="checkbox" checked={inspectable} onChange={e => setInspectable(e.target.checked)} />Каждая коробка видна снаружи</label></div>
      <p className="operations-muted">Лимиты 180 см / 800 кг — настраиваемые параметры расчёта, не паспортные характеристики вашей палеты. Ограничение шести слоёв сохраняется.</p>
      {working && <p role="status">Расчёт в фоновом потоке…</p>}{calculationError && <p role="alert">{calculationError}</p>}
      {plan?.warnings.map(message => <p className="operations-message" key={message}>{message}</p>)}
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
          <p className="pallet-inventory-note">Установленные коробки сохраняются в заказе с синхронизацией. Рекомендация пересчитывается вокруг их зафиксированных координат.</p>
          <div className="pallet-product-groups">{groups.map((group) => {
            const actualCount = group.placements.filter((placement) => actualIds.has(placement.id)).length
            return <article key={group.productId} className={selectedProductId === group.productId ? 'selected' : ''} onClick={() => setSelectedProductId(group.productId)}><div><strong dir="auto">{group.name}</strong><small>{group.sku} · {actualCount} из {group.placements.length} установлено</small></div><div><button type="button" aria-label={`Убрать коробку ${group.name}`} disabled={saving || working || order?.status === 'completed' || !actualCount} onClick={(event) => { event.stopPropagation(); changeActual(group.productId, -1) }}><Minus size={14} /></button><b>{actualCount}</b><button type="button" aria-label={`Добавить коробку ${group.name}`} disabled={saving || working || order?.status === 'completed' || actualCount >= group.placements.length} onClick={(event) => { event.stopPropagation(); changeActual(group.productId, 1) }}><Plus size={14} /></button></div></article>
          })}</div>
          {plan?.issues.length ? <div className="pallet-workspace-issues"><AlertTriangle size={16} /><span>{plan.issues.map(issue => `${issue.sku}: ${issue.reason}${issue.boxCount ? ` (${issue.boxCount} кор.)` : ''}`).join('; ')}</span></div> : null}
        </aside>
      </div>
    </div>
  )
}
