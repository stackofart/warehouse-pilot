import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Download, FileJson, FileText, FileUp, MapPin, PackagePlus, Pause, Play, ShieldCheck } from 'lucide-react'
import { type ChangeEvent, useEffect, useState } from 'react'
import { listFulfillmentSessions } from '../fulfillment/storage'
import { getFulfillmentProgress, type FulfillmentSession } from '../fulfillment/workflow'
import { listOrders, type SavedOrder } from './storage'
import { createOrdersDatabaseExport, importOrderDocument, orderImportExample, orderImportInstructions, OrderImportValidationError, orderJsonSchema, parseOrderDocument } from './transfer'

function orderQuantity(order: SavedOrder) {
  return order.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0)
}

function orderLocations(order: SavedOrder) {
  return new Set(order.items.map((item) => item.address).filter(Boolean)).size
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function OrdersDatabase() {
  const [orders, setOrders] = useState<SavedOrder[]>([])
  const [sessions, setSessions] = useState<Map<string, FulfillmentSession>>(new Map())
  const [expandedId, setExpandedId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState('')
  const [importIssues, setImportIssues] = useState<string[]>([])
  const [message, setMessage] = useState('')

  const refreshData = async () => {
    const [saved, savedSessions] = await Promise.all([listOrders(), listFulfillmentSessions()])
    setOrders(saved)
    setSessions(new Map(savedSessions.map((session) => [session.orderId, session])))
    return saved
  }

  useEffect(() => {
    const load = async () => {
      try {
        await refreshData()
      } catch (reason) {
        console.error(reason)
        setError('Не удалось открыть локальную базу заказов')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [])

  const downloadFile = (filename: string, contents: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadJson = (filename: string, value: unknown) => downloadFile(filename, JSON.stringify(value, null, 2), 'application/json')

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setMessage('')
    setImportIssues([])
    if (file.size > 2 * 1024 * 1024) {
      setImportIssues(['Размер JSON-файла не должен превышать 2 МБ'])
      return
    }
    setIsImporting(true)
    try {
      const document = parseOrderDocument(await file.text())
      const result = await importOrderDocument(document, file.name, orders)
      await refreshData()
      setExpandedId(result.savedOrder.id)
      setMessage(`Заказ ${result.savedOrder.orderNumber} импортирован: ${result.savedOrder.items.length} позиций. Новых товаров: ${result.products.saved}; уже в базе: ${result.products.matchedExisting}; неполных: ${result.products.incomplete}; конфликтов: ${result.products.conflicts}.`)
    } catch (reason) {
      console.error(reason)
      if (reason instanceof OrderImportValidationError) setImportIssues(reason.issues)
      else setImportIssues([reason instanceof Error ? reason.message : 'Не удалось импортировать заказ'])
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="page orders-page">
      <div className="page-heading orders-heading">
        <div>
          <p className="eyebrow">СОХРАНЁННЫЕ ЗАКАЗЫ</p>
          <h1>История заказов</h1>
          <p>Откройте заказ, чтобы посмотреть товары, количество и адреса комплектации.</p>
        </div>
        <div className="orders-heading-actions">
          <label className={`secondary-button order-import-button file-picker-trigger ${isImporting ? 'disabled' : ''}`}><FileUp size={15} />{isImporting ? 'Импорт…' : 'Импорт заказа'}<input className="file-picker-input" aria-label="Выбрать JSON заказа" disabled={isImporting} type="file" accept="application/json,.json" onChange={importJson} /></label>
          <button className="secondary-button" type="button" onClick={() => downloadFile('warehouse-pilot-order-import.md', orderImportInstructions, 'text/markdown;charset=utf-8')}><FileText size={15} />Инструкция</button>
          <button className="secondary-button" type="button" onClick={() => downloadJson('warehouse-pilot-order.schema.json', orderJsonSchema)}><FileJson size={15} />JSON Schema</button>
          <button className="secondary-button" type="button" onClick={() => downloadJson('warehouse-pilot-order.example.json', orderImportExample)}><Download size={15} />Пример</button>
          <button className="secondary-button" type="button" disabled={!orders.length} onClick={() => downloadJson('warehouse-pilot-orders-backup.json', createOrdersDatabaseExport(orders))}><Download size={15} />Экспорт всех заказов</button>
          <a className="primary-button new-order-link" href="#new-order"><PackagePlus size={17} />Новый заказ</a>
        </div>
      </div>

      {message && <div className="order-import-feedback success" role="status">{message}</div>}
      {importIssues.length > 0 && <div className="order-import-feedback error" role="alert"><strong>Заказ не импортирован</strong><ul>{importIssues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul></div>}

      <section className="orders-list-card">
        <div className="orders-summary">
          <div><ClipboardList size={19} /><span><strong>{orders.length}</strong> заказов сохранено локально</span></div>
          <small>Последние изменения сверху</small>
        </div>

        {error ? (
          <div className="orders-empty"><p className="product-form-error">{error}</p></div>
        ) : isLoading ? (
          <div className="orders-empty"><ClipboardList size={29} /><p>Загружаем заказы…</p></div>
        ) : orders.length === 0 ? (
          <div className="orders-empty"><ClipboardList size={31} /><strong>Сохранённых заказов пока нет</strong><p>Создайте и сохраните первый заказ.</p><a className="primary-button" href="#new-order"><PackagePlus size={16} />Создать заказ</a></div>
        ) : (
          <div className="orders-list">
            {orders.map((order) => {
              const expanded = expandedId === order.id
              const session = sessions.get(order.id)
              const fulfillmentProgress = getFulfillmentProgress(session)
              return (
                <article className={`order-card ${expanded ? 'expanded' : ''}`} key={order.id}>
                  <button className="order-card-summary" type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? '' : order.id)}>
                    <span className="order-number"><ClipboardList size={18} /><span><small>Номер заказа</small><strong>{order.orderNumber || 'Без номера'}</strong></span></span>
                    <span><small>Вес заказа</small><b>{order.summary?.totalWeightKg ? `${order.summary.totalWeightKg} кг` : '—'}</b></span>
                    <span><small>Позиций</small><b>{order.items.length}</b></span>
                    <span><small>Общее количество</small><b>{order.summary?.totalQuantity || orderQuantity(order)}</b></span>
                    <span><small>Адресов</small><b>{orderLocations(order)}</b></span>
                    <span><small>Сохранён</small><b>{formatDate(order.updatedAt)}</b></span>
                    <i>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</i>
                  </button>

                  <div className="order-card-open-row">
                    {session ? (
                      <div className={`order-workflow-progress ${session.status}`}><span>{session.status === 'completed' ? <CheckCircle2 size={15} /> : session.status === 'paused' ? <Pause size={15} /> : <Play size={15} />}<b>{session.status === 'completed' ? 'Комплектация завершена' : session.status === 'paused' ? `На паузе · ${fulfillmentProgress.percent}%` : `В работе · ${fulfillmentProgress.percent}%`}</b></span><small>{fulfillmentProgress.picked} собрано · {fulfillmentProgress.checking} проверяется · {fulfillmentProgress.missing} отсутствует · {fulfillmentProgress.pending} осталось</small></div>
                    ) : (
                      <div className="order-workflow-progress not-started"><span><Play size={15} /><b>Готов к работе</b></span><small>Маршрут из {orderLocations(order)} остановок рассчитается автоматически</small></div>
                    )}
                    <a className="primary-button order-open-button" href={`#work/${encodeURIComponent(order.id)}`}><Play size={16} />{session?.status === 'completed' ? 'Открыть результат' : session?.status === 'paused' ? 'Открыть и продолжить' : session ? 'Продолжить заказ' : 'Открыть заказ'}</a>
                  </div>

                  {expanded && (
                    <div className="order-details">
                      <div className="order-summary-line">
                        <span><b>Позиций по документу:</b> {order.summary?.itemCount || '—'}</span>
                        <span><b>Упаковок:</b> {order.summary?.packageCount || '—'}</span>
                        <span><b>Суммарный вес:</b> {order.summary?.totalWeightKg ? `${order.summary.totalWeightKg} кг` : '—'}</span>
                      </div>
                      {order.notes && <div className="order-notes"><b>Примечание</b><p>{order.notes}</p></div>}
                      <div className="order-items-wrap">
                        <table className="order-items-table">
                          <thead><tr><th>#</th><th>Адрес</th><th>מק״ט</th><th>Штрихкод</th><th>Название</th><th>В коробке</th><th>Коробок</th><th>Всего</th><th>Проверка</th></tr></thead>
                          <tbody>
                            {order.items.map((item) => (
                              <tr key={`${order.id}-${item.row}`}>
                                <td>{item.row}</td>
                                <td><span className="location-badge"><MapPin size={12} />{item.address || '—'}</span></td>
                                <td><b>{item.sku || '—'}</b></td>
                                <td className="order-barcode">{item.barcode || '—'}</td>
                                <td dir="auto">{item.description || '—'}</td>
                                <td>{item.unitsPerBox || '—'}</td>
                                <td>{item.boxCount || '—'}</td>
                                 <td>{item.quantity || '—'}</td>
                                 <td><span className={`verification-pill ${item.productVerification === 'unverified' ? 'unverified' : 'verified'}`}>{item.productVerification === 'unverified' ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}{item.productVerification === 'unverified' ? 'Не проверен' : 'Проверен'}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="order-detail-note"><Boxes size={14} />Новые товары из распознавания попадают в справочник как непроверенные. Подтвердить их можно в разделе «Товары».</p>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
