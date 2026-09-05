import { useEffect, useState } from 'react'
import { apiRequest } from '../storage/apiClient'
import type { AppRole } from '../auth/session'
import { getReports, reportStatus, type Report } from './api'
import type { Product } from '../products/storage'
export function ReportsQueue({ role }: { role: AppRole }) {
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = async () => { try { setReports(await getReports()); setError('') } catch (reason) { setError(String(reason)) } }
  useEffect(() => { void reload(); const timer = setInterval(() => void reload(), 30000); return () => clearInterval(timer) }, [])
  const update = async (report: Report, status: Report['status']) => {
    setBusy(true)
    try {
      let productVersion: number | undefined
      if (status === 'resolved' && report.kind === 'moved') {
        const result = await apiRequest<{ product: Product }>(`/api/catalog/products/${report.productId}`)
        if (!confirm(`Подтвердить новый адрес ${result.product.name}: ${result.product.location} → ${report.suggestedAddress}? Изменение увидят все комплектовщики.`)) return
        productVersion = result.product.version
      }
      await apiRequest(`/api/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status, version: report.version, productVersion }) }); await reload()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="page operations-page"><div className="page-heading"><div><p className="eyebrow">ИСКЛЮЧЕНИЯ</p><h1>{role === 'replenisher' ? 'Проверка резерва и пополнение' : 'Сообщения комплектовщиков'}</h1><p>Местоположение меняет администратор. Остатки WMS1 пока не подключены — отсутствие на подборе не означает отсутствие в резерве.</p></div><button onClick={() => void reload()}>Обновить</button></div>{error && <p role="alert">{error}</p>}{!reports.length && <p>Открытых сообщений нет.</p>}<div className="operations-reports">{reports.map(report => <article key={report.id}><header><strong dir="auto">{report.name}</strong><b>{report.address}</b></header><p>{report.barcode} · {report.author}</p><strong>{reportStatus[report.status]}</strong><p>{report.kind === 'missing' ? 'Нет товара на подборе. Нужна проверка верхнего резерва.' : report.kind === 'moved' ? `Предложен адрес: ${report.suggestedAddress}` : report.kind === 'damaged' ? 'Повреждение упаковки' : 'Комментарий'} {report.note}</p><div className="operations-toolbar">{report.kind === 'missing' && <><button disabled={busy} onClick={() => void update(report, 'checking-reserve')}>Проверяю резерв</button><button disabled={busy} onClick={() => void update(report, 'replenishing')}>Пополняю</button><button disabled={busy} onClick={() => void update(report, 'ready')}>Товар на подборе</button></>}{role === 'admin' && <><button disabled={busy} onClick={() => void update(report, 'resolved')}>{report.kind === 'moved' ? 'Подтвердить новый адрес' : 'Закрыть'}</button><button disabled={busy} onClick={() => void update(report, 'rejected')}>Отклонить</button></>}</div></article>)}</div></div>
}
