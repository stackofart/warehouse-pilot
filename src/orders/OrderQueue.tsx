import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import type { AuthenticatedUser } from '../auth/session'
import { listManagedUsers, type ManagedUser } from '../auth/adminApi'
import { listOrders, saveOrder, type SavedOrder } from './storage'
import { apiRequest } from '../storage/apiClient'
import { importOrderDocument, parseOrderDocument, orderImportInstructions, orderImportExample } from './transfer'
import { listFulfillmentSessions } from '../fulfillment/storage'
import { openDatabase, ORDERS_STORE, requestToPromise } from '../storage/database'
import { ArrowRight, ClipboardList, Download, FileJson, Plus, RefreshCw, Search } from 'lucide-react'

function download(name: string, content: unknown) {
  const url = URL.createObjectURL(new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: typeof content === 'string' ? 'text/plain' : 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const labels: Record<string, string> = { unassigned: 'Не назначен', assigned: 'Назначен', 'in-progress': 'В работе', paused: 'Пауза', completed: 'Завершён' }
export function OrderQueue({ user }: { user: AuthenticatedUser }) {
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [pickers, setPickers] = useState<ManagedUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const admin = user.role === 'admin'
  const reload = useCallback(async () => {
    setBusy(true); setError('')
    try { setOrders(await listOrders()); if (admin) setPickers((await listManagedUsers()).filter(p => p.role === 'picker' && p.status === 'active')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить заказы.') }
    finally { setBusy(false) }
  }, [admin])
  useEffect(() => { void reload() }, [reload, user.id])
  const assign = async (order: SavedOrder, assignedTo: string) => {
    if (['in-progress', 'paused'].includes(order.status || '') && !confirm('Передать начатый заказ? Прогресс сохранится; прежний сборщик потеряет доступ.')) return
    setBusy(true)
    try { await apiRequest(`/api/orders/${order.id}/assignment`, { method: 'PATCH', body: JSON.stringify({ assignedTo: assignedTo || null, version: order.version }) }); await reload() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    setBusy(true)
    try { await importOrderDocument(parseOrderDocument(await file.text()), file.name, orders); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка импорта.') } finally { setBusy(false) }
  }
  const migrate = async () => {
    if (!confirm('Перенести старые локальные заказы в общую очередь? Назначения не создаются автоматически.')) return
    setBusy(true)
    const db = await openDatabase(true)
    try {
      const legacy = await requestToPromise(db.transaction(ORDERS_STORE).objectStore(ORDERS_STORE).getAll()) as SavedOrder[]
      download('warehouse-legacy-orders-backup.json', legacy)
      let count = 0
      for (const order of legacy) { if (orders.some(current => current.id === order.id)) continue; await saveOrder({ ...order, source: 'legacy', version: undefined }); count++ }
      await reload(); setError(`Перенесено ${count}. Старые данные не удалены. Старый прогресс остаётся в локальной резервной базе.`)
    } catch (reason) { setError(String(reason)) } finally { db.close(); setBusy(false) }
  }
  const backup = async () => {
    setBusy(true)
    try { download('warehouse-operations-backup.json', { schema: 'warehouse-pilot.operations-backup', version: 1, exportedAt: new Date().toISOString(), orders: await listOrders(), sessions: await listFulfillmentSessions() }) }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const visible = orders.filter(order => (status === 'all' || status === 'completed' ? status === 'all' || order.status === 'completed' : order.status !== 'completed') && `${order.orderNumber} ${order.notes || ''}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page operations-page">
    <div className="page-heading"><div><p className="eyebrow">{admin ? 'РАСПРЕДЕЛЕНИЕ' : 'МОЯ РАБОТА'}</p><h1>{admin ? 'Очередь заказов' : 'Мои заказы'}</h1><p>{admin ? 'Добавляйте заказы, назначайте комплектовщиков и следите за сборкой.' : 'Заказы, назначенные вам. Собирайте в удобном порядке.'}</p></div><button className="operations-button" disabled={busy} onClick={() => void reload()}><RefreshCw size={17} className={busy ? 'spin' : ''} />Обновить</button></div>
    {admin && <><div className="operations-toolbar order-intake-actions"><a className="primary-button" href="#admin/new-order"><Plus size={18} />Добавить по фото</a><label className="secondary-button file-picker-trigger"><FileJson size={17} />Импорт JSON<input className="file-picker-input" aria-label="Импорт заказов JSON" type="file" accept=".json,application/json" disabled={busy} onChange={importFile} /></label><button className="operations-button" disabled={busy} onClick={() => void backup()}><Download size={17} />Экспорт</button></div><details className="operations-tools"><summary>Инструкции и перенос старых заказов</summary><div className="operations-toolbar"><button className="operations-button" onClick={() => download('order-import.md', orderImportInstructions)}>Инструкция JSON</button><button className="operations-button" onClick={() => download('order-example.json', orderImportExample)}>Пример файла</button><button className="operations-button" disabled={busy} onClick={() => void migrate()}>Перенести с устройства</button></div></details></>}
    <div className="operations-filters"><label className="operations-search"><Search size={18} /><input type="search" aria-label="Найти заказ" placeholder="Номер заказа или примечание" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Статус заказов" value={status} onChange={e => setStatus(e.target.value)}><option value="active">Текущие</option><option value="completed">Завершённые</option><option value="all">Все заказы</option></select></div>
    {error && <p role="status" className="operations-message">{error}</p>}
    {busy && <p role="status">Загрузка…</p>}
    {!busy && !visible.length && <div className="operations-empty"><ClipboardList size={32} /><b>Здесь пока нет заказов</b><p>{admin ? 'Добавьте заказ или измените фильтр.' : 'Заказ появится после назначения администратором.'}</p></div>}
    <div className="operations-orders">{visible.map(order => <article className="order-queue-card" key={order.id}>
      <div className="order-queue-main"><div className="order-queue-title"><strong>{order.orderNumber || 'Без номера'}</strong><span className={`order-state ${order.status || 'unassigned'}`}>{labels[order.status || ''] || 'Не назначен'}</span></div><p>{order.items.length} позиций{order.assigneeName ? ` · ${order.assigneeName}` : ''}</p>{order.notes && <p className="order-queue-note">{order.notes}</p>}</div>
      {admin && <label className="order-assignment"><span>Комплектовщик</span><select aria-label={`Исполнитель заказа ${order.orderNumber}`} value={order.assignedTo || ''} disabled={busy || order.status === 'completed'} onChange={e => void assign(order, e.target.value)}><option value="">Не назначен</option>{order.assignedTo && !pickers.some(p => p.id === order.assignedTo) && <option value={order.assignedTo}>{order.assigneeName || 'Недоступный комплектовщик'}</option>}{pickers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <a className={admin || order.status === 'completed' ? 'secondary-button order-open' : 'primary-button order-open'} href={`#${admin ? 'admin/orders' : 'work'}/${encodeURIComponent(order.id)}`}>{admin || order.status === 'completed' ? 'Посмотреть' : order.status === 'assigned' ? 'Начать сборку' : 'Продолжить'}<ArrowRight size={17} /></a>
    </article>)}</div>
  </div>
}
