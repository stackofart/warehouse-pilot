import { CheckCircle2, ClipboardList } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getFulfillmentActiveDuration, getFulfillmentProgress, type FulfillmentSession } from './workflow'
import { formatMilliseconds } from './time'

export function OrderCompletion({ session, orderNumber }: { session: FulfillmentSession; orderNumber: string }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [])
  const progress = getFulfillmentProgress(session)
  const synced = session.syncStatus === 'synced'
  return <section className="order-completion-panel" aria-label="Итоги заказа" tabIndex={-1} ref={panel}>
    <header><CheckCircle2 size={30} /><div><small>Заказ {orderNumber || 'без номера'}</small><h2>Сборка завершена</h2></div></header>
    <p>Завершён {session.completedAt ? new Date(session.completedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</p>
    <div className="order-completion-stats"><span><b>{progress.picked}</b><small>позиций собрано</small></span><span><b>{progress.missing}</b><small>отсутствует</small></span><span><b>{formatMilliseconds(getFulfillmentActiveDuration(session))}</b><small>время без пауз</small></span></div>
    <p className={synced ? 'completion-sync-ok' : 'completion-sync-pending'} role="status">{synced ? 'Результат сохранён на сервере и доступен администратору.' : session.syncStatus === 'conflict' ? 'Есть конфликт синхронизации. Завершение ещё не подтверждено сервером.' : 'Результат сохранён на устройстве. Ожидается отправка на сервер.'}</p>
    {progress.missing > 0 && <p>Заказ завершён с отсутствующими позициями. Сообщения остаются в очереди обработки.</p>}
    <a className="primary-button" href="#orders"><ClipboardList size={18} />К моим заказам</a>
  </section>
}
