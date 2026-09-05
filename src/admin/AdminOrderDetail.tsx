import { ArrowLeft, Barcode, ClipboardList, Cuboid, MapPin, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiRequest } from '../storage/apiClient'
import { fromServerOrder, type ServerOrder } from '../orders/model'
import type { SavedOrder } from '../orders/storage'
import { getFulfillmentProgress, type FulfillmentSession } from '../fulfillment/workflow'
import { productsForOrders } from '../products/catalogRepository'
import type { Product } from '../products/storage'

const statuses: Record<string, string> = { unassigned: 'Не назначен', assigned: 'Назначен', 'in-progress': 'В работе', paused: 'На паузе', completed: 'Завершён' }
const itemStatuses = { pending: 'Не отмечено', picked: 'Собрано', checking: 'Идёт проверка', missing: 'Нет товара' }

export function AdminOrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<SavedOrder | null>(null)
  const [session, setSession] = useState<FulfillmentSession | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const [result, progress] = await Promise.all([
          apiRequest<{ order: ServerOrder }>(`/api/orders/${orderId}`),
          apiRequest<{ session: FulfillmentSession | null }>(`/api/orders/${orderId}/session`),
        ])
        const saved = fromServerOrder(result.order)
        const cards = await productsForOrders([saved])
        if (!cancelled) { setOrder(saved); setSession(progress.session); setProducts(cards); setError('') }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не удалось открыть заказ.') }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [orderId, revision])
  const progress = getFulfillmentProgress(session)
  const visible = order?.items.filter(item => `${item.description} ${item.barcode} ${item.sku} ${item.address}`.toLowerCase().includes(query.toLowerCase())) || []
  return <div className="page operations-page admin-order-detail">
    <a className="operations-back" href="#admin/orders"><ArrowLeft size={17} />К распределению заказов</a>
    <div className="page-heading"><div><p className="eyebrow">КОНТРОЛЬ ЗАКАЗА</p><h1>{order ? `Заказ ${order.orderNumber || 'без номера'}` : 'Открываем заказ…'}</h1><p>Состав и отметки комплектовщика. Прогресс обновляется автоматически.</p></div><button className="operations-button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={17} />Обновить</button></div>
    {error && <p className="operations-message" role="alert">{error}</p>}
    {order && <>
      <section className="admin-order-overview">
        <div><span className={`order-state ${order.status}`}>{statuses[order.status || ''] || 'Ожидает сборки'}</span><h2>{order.assigneeName || (order.assignedTo ? 'Комплектовщик назначен' : 'Назначьте комплектовщика в очереди')}</h2><p>{order.items.length} позиций · {progress.picked} собрано · {progress.checking + progress.missing} требуют внимания</p></div>
        <a className="secondary-button" href={`#admin/pallet/${orderId}`}><Cuboid size={17} />Компоновка паллеты</a>
      </section>
      {order.notes && <section className="workflow-order-notes"><b>Примечание</b><p>{order.notes}</p></section>}
      <div className="operations-readonly"><ShieldCheck size={17} /><span>Режим просмотра. Сборку и отметки выполняет назначенный комплектовщик.</span></div>
      <label className="operations-search"><Search size={18} /><input type="search" aria-label="Поиск по составу заказа" placeholder="Товар, штрихкод или адрес" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <section className="admin-order-lines" aria-label="Состав заказа">{visible.map(item => {
        const product = products.find(card => Boolean(item.barcode) && card.barcode === item.barcode) || products.find(card => Boolean(item.sku) && card.sku === item.sku)
        const state = session?.items[String(item.row)]
        const status = state?.status || 'pending'
        return <details key={item.row} className={`admin-order-line ${status}`}><summary><span className="admin-order-line-main"><b dir="auto">{product?.name || item.description}</b><span><strong><MapPin size={14} />{product?.location || item.address || 'Нет адреса'}</strong><small><Barcode size={14} />{item.barcode || 'Без штрихкода'}</small></span></span><span className="admin-order-line-quantity"><b>{item.boxCount || '—'} кор.</b><small>{item.quantity || '—'} шт.</small></span><span className={`order-line-state ${status}`}>{itemStatuses[status]}</span></summary>
          <div className="admin-order-line-details">{(product?.imageUrl || product?.imageDataUrl) && <img src={product.imageUrl || product.imageDataUrl} alt={product.name} />}<div><p dir="auto">{product?.description || 'Описание пока не добавлено.'}</p><p>מק״ט: {item.sku || '—'} · В коробке: {item.unitsPerBox || product?.unitsPerBox || '—'} шт.</p>{state?.note && <p className="operations-message">{state.note}</p>}</div></div>
        </details>
      })}{!visible.length && <div className="operations-empty"><ClipboardList size={28} /><b>Нет подходящих позиций</b></div>}</section>
    </>}
  </div>
}
