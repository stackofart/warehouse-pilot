import { Bell, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../storage/apiClient'

type Summary = { total: number; latest: { id: string; name: string; kind: string } | null }
export function AdminReportNotifications({ inReports }: { inReports: boolean }) {
  const [summary, setSummary] = useState<Summary>({ total: 0, latest: null })
  const [notice, setNotice] = useState('')
  const [offline, setOffline] = useState(false)
  const lastId = useRef('')
  useEffect(() => {
    let cancelled = false, running = false
    const refresh = async () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      try {
        const next = await apiRequest<Summary>('/api/reports/notifications')
        if (!cancelled) {
          setSummary(next); setOffline(false)
          if (next.latest && next.latest.id !== lastId.current) setNotice(next.latest.id)
          lastId.current = next.latest?.id || ''
          if (!next.total) setNotice('')
        }
      } catch { if (!cancelled) setOffline(true) } finally { running = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    window.addEventListener('focus', refresh)
    window.addEventListener('warehouse:reports-updated', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('warehouse:reports-updated', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => { if (inReports) setNotice('') }, [inReports, summary.latest?.id])
  return <>
    <a className="admin-report-bell" href="#admin/reports" aria-label={`Сообщения: ${summary.total} открытых${offline ? ', нет связи' : ''}`} title={offline ? 'Не удалось обновить сообщения' : 'Сообщения комплектовщиков'}>
      <Bell size={19} /><span className="notification-label">Сообщения</span>{summary.total > 0 && <b>{summary.total > 99 ? '99+' : summary.total}</b>}{offline && <i>!</i>}
    </a>
    {notice && !inReports && summary.latest && <aside className="admin-report-notice" role="status"><a href="#admin/reports"><Bell size={19} /><span><b>Сообщения комплектовщиков · {summary.total}</b><small dir="auto">{summary.latest.name}</small><em>Открыть сообщения →</em></span></a><button aria-label="Скрыть уведомление" onClick={() => setNotice('')}><X size={17} /></button></aside>}
  </>
}
