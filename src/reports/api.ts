import { apiRequest, mayUseOfflineCache } from '../storage/apiClient'
import { openDatabase, OUTBOX_STORE, requestToPromise } from '../storage/database'
export type Report = { id: string; orderId: string; productId: string | null; sku: string; barcode: string; name: string; address: string; suggestedAddress: string | null; kind: 'missing' | 'moved' | 'damaged' | 'comment'; note: string; status: 'open' | 'checking-reserve' | 'replenishing' | 'ready' | 'resolved' | 'rejected'; author: string; updatedBy: string; version: number; createdAt: string; updatedAt: string }
export type ReportInput = { id: string; orderId: string; row: number; kind: Report['kind']; note: string; suggestedAddress?: string }
export const reportStatus: Record<Report['status'], string> = { open: 'Сообщено', 'checking-reserve': 'Проверяют резерв', replenishing: 'Погрузчик пополняет', ready: 'Товар пополнен', resolved: 'Подтверждено / закрыто', rejected: 'Отклонено' }
export async function getReports(orderId?: string) {
  const all: Report[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await apiRequest<{ items: Report[]; more: boolean }>(`/api/reports?offset=${offset}${orderId ? `&orderId=${encodeURIComponent(orderId)}` : ''}`)
    all.push(...page.items); if (!page.more) return all
  }
}
export async function sendReport(input: ReportInput) {
  const db = await openDatabase()
  try {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite'); tx.objectStore(OUTBOX_STORE).put({ id: input.id, kind: 'report', input })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
  } finally { db.close() }
  return flushReports()
}
export async function flushReports() {
  const db = await openDatabase()
  let pending = 0
  try {
    const queue = await requestToPromise(db.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll()) as Array<{ id: string; kind: string; input: ReportInput }>
    for (const entry of queue.filter(row => row.kind === 'report')) {
      try {
        await apiRequest('/api/reports', { method: 'POST', body: JSON.stringify(entry.input) })
        const tx = db.transaction(OUTBOX_STORE, 'readwrite'); tx.objectStore(OUTBOX_STORE).delete(entry.id)
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
      } catch (error) { pending++; if (!mayUseOfflineCache(error)) throw error }
    }
  } finally { db.close() }
  return pending
}
