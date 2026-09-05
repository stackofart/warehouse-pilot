import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import type { AuthenticatedUser } from '../auth/session'
import { listManagedUsers, type ManagedUser } from '../auth/adminApi'
import { listOrders, saveOrder, type SavedOrder } from './storage'
import { apiRequest } from '../storage/apiClient'
import { importOrderDocument, parseOrderDocument, orderImportInstructions, orderImportExample } from './transfer'
import { listFulfillmentSessions } from '../fulfillment/storage'
import { openDatabase, ORDERS_STORE, requestToPromise } from '../storage/database'

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
    <div className="page-heading"><div><p className="eyebrow">{admin ? 'РАСПРЕДЕЛЕНИЕ' : 'МОЯ РАБОТА'}</p><h1>{admin ? 'Общая очередь заказов' : 'Назначенные мне заказы'}</h1><p>{admin ? 'Фото и JSON — временные источники до подключения WMS1.' : 'Собирайте в удобном порядке. Отмечайте исключения, а не каждый шаг.'}</p></div><button disabled={busy} onClick={() => void reload()}>Обновить</button></div>
    {admin && <div className="operations-toolbar"><a className="primary-button" href="#admin/new-order">Добавить по фото</a><label className="secondary-button file-picker-trigger">Импорт JSON<input className="file-picker-input" type="file" accept=".json,application/json" disabled={busy} onChange={importFile} /></label><button disabled={busy} onClick={() => void backup()}>Экспорт заказов и прогресса</button><details><summary>Инструкции и старые данные</summary><button onClick={() => download('order-import.md', orderImportInstructions)}>Инструкция JSON</button><button onClick={() => download('order-example.json', orderImportExample)}>Пример</button><button disabled={busy} onClick={() => void migrate()}>Перенести старые заказы</button></details></div>}
    <div className="operations-toolbar"><input aria-label="Найти заказ" placeholder="Номер заказа или примечание" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Статус заказов" value={status} onChange={e => setStatus(e.target.value)}><option value="active">Текущие</option><option value="completed">Завершённые</option><option value="all">Все</option></select></div>
    {error && <p role="status" className="operations-message">{error}</p>}
    {busy && <p role="status">Загрузка…</p>}
    {!busy && !visible.length && <p>Нет заказов в этом фильтре.{!admin && ' Новый заказ появится после назначения администратором.'}</p>}
    <div className="operations-orders">{visible.map(order => <article key={order.id}><div><strong>{order.orderNumber || 'Без номера'}</strong><span>{order.items.length} позиций · {labels[order.status || ''] || 'Локальный'}</span><small>{order.notes}</small><small>{order.assigneeName || (order.assignedTo ? 'Комплектовщик назначен' : 'Не назначен')}</small></div>{admin && <select aria-label={`Исполнитель заказа ${order.orderNumber}`} value={order.assignedTo || ''} disabled={busy || order.status === 'completed'} onChange={e => void assign(order, e.target.value)}><option value="">Не назначен</option>{pickers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}<a href={`#work/${encodeURIComponent(order.id)}`}>{order.status === 'completed' ? 'Посмотреть' : admin ? 'Открыть' : order.status === 'assigned' ? 'Начать сборку' : 'Продолжить'}</a></article>)}</div>
  </div>
}
