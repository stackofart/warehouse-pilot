import type { Report } from './api'

export function prepareReportDraft(kind: Report['kind'], note: string, address = '', hasPhoto = false) {
  const suggestedAddress = address.trim().toUpperCase().replace(/^(\d{1,2})\.?([A-Z])$/, '$1.$2')
  if (kind === 'moved' && !/^\d{1,2}\.[A-Z]$/.test(suggestedAddress)) {
    return { error: 'Укажите новый адрес, например 24.F.', kind, note: note.trim(), suggestedAddress }
  }
  if (kind === 'comment' && !note.trim() && !hasPhoto) {
    return { error: 'Напишите комментарий к позиции.', kind, note: '', suggestedAddress: undefined }
  }
  return { error: '', kind, note: note.trim(), suggestedAddress: kind === 'moved' ? suggestedAddress : undefined }
}
