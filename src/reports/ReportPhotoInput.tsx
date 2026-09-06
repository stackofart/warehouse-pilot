import { Camera, ImagePlus, X } from 'lucide-react'
import { useState } from 'react'
import { prepareReportPhoto } from './photo'

export function ReportPhotoInput({ value, onChange, onBusy, disabled }: { value?: string; onChange: (data: string) => void; onBusy: (busy: boolean) => void; disabled: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const select = async (file?: File) => {
    if (!file) return
    setBusy(true); onBusy(true); setError('')
    try { onChange(await prepareReportPhoto(file)) } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)) }
    finally { setBusy(false); onBusy(false) }
  }
  return <div className="report-photo-input">
    <b>Фото · необязательно</b>
    {value && <div className="report-photo-preview"><img src={value} alt="Фото к сообщению" /><button type="button" aria-label="Удалить фото из сообщения" disabled={disabled || busy} onClick={() => onChange('')}><X size={18} /></button></div>}
    <div className="report-photo-choices"><label><Camera size={18} />Снять фото<input type="file" accept="image/*" capture="environment" disabled={disabled || busy} onChange={event => { void select(event.target.files?.[0]); event.target.value = '' }} /></label><label><ImagePlus size={18} />Из галереи<input type="file" accept="image/*" disabled={disabled || busy} onChange={event => { void select(event.target.files?.[0]); event.target.value = '' }} /></label></div>
    {busy && <small role="status">Подготавливаем фото…</small>}{error && <p role="alert">{error}</p>}
  </div>
}
