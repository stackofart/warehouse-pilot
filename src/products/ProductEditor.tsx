import { useState, type FormEvent } from 'react'
import type { SharedCatalogProduct } from './sharedApi'
import { apiRequest } from '../storage/apiClient'
import { uploadProductImage } from './images'
const specs = ['lengthCm', 'widthCm', 'heightCm', 'weightKg', 'maxTopLoadKg'] as const
const labels = { lengthCm: 'Длина, см', widthCm: 'Ширина, см', heightCm: 'Высота, см', weightKg: 'Вес, кг', maxTopLoadKg: 'Допустимая нагрузка сверху, кг' }
export function ProductEditor({ product, onSaved }: { product: SharedCatalogProduct; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => ({ name: product.name, location: product.location, description: product.description || '', brand: product.brand || '', variant: product.variant || '', packagingColor: product.packagingColor || '', identificationNotes: product.identificationNotes || '', unitsPerBox: String(product.unitsPerBox || ''), rigidity: String(product.rigidity || ''), fragility: String(product.fragility || '') }))
  const [physical, setPhysical] = useState<Record<string, string>>(() => Object.fromEntries(['itemSpec', 'boxSpec'].flatMap(key => specs.map(field => [`${key}.${field}`, String(product[key as 'itemSpec' | 'boxSpec']?.[field as keyof NonNullable<SharedCatalogProduct['itemSpec']>] ?? '')]))))
  const [verified, setVerified] = useState(product.verificationStatus === 'verified')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    let savedText = false
    try {
      const technicalChanged = Object.entries(physical).some(([path, value]) => { const [key, field] = path.split('.'); return value !== String(product[key as 'itemSpec' | 'boxSpec']?.[field as keyof NonNullable<SharedCatalogProduct['itemSpec']>] ?? '') }) || draft.rigidity !== String(product.rigidity || '') || draft.fragility !== String(product.fragility || '')
      const data = { ...draft, unitsPerBox: Number(draft.unitsPerBox) || null, rigidity: Number(draft.rigidity) || null, fragility: Number(draft.fragility) || null, verificationStatus: verified ? 'verified' : 'unverified', ...(technicalChanged ? { technicalDataSource: product.technicalDataSource === 'simulated' ? 'simulated' : 'manual', technicalVerificationStatus: 'needs_review' } : {}), version: product.version, ...Object.fromEntries(['itemSpec', 'boxSpec'].map(key => [key, Object.fromEntries(specs.filter(field => key === 'boxSpec' || field !== 'maxTopLoadKg').map(field => [field, physical[`${key}.${field}`] === '' ? null : Number(physical[`${key}.${field}`])]))])) }
      const result = await apiRequest<{ product: SharedCatalogProduct }>(`/api/admin/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(data) })
      savedText = true
      if (photo) await uploadProductImage(result.product, photo)
      onSaved(); setMessage('Сохранено в общей базе.')
    } catch (reason) {
      if (savedText) { alert(`Текст сохранён, фото не загружено: ${String(reason)}`); onSaved() }
      else setMessage(String(reason))
    } finally { setBusy(false) }
  }
  return <details className="wide"><summary>Редактировать карточку</summary><form className="operations-editor" onSubmit={submit}>{Object.entries({ name: 'Название', location: 'Адрес', description: 'Описание', brand: 'Производитель', variant: 'Вид / вкус', packagingColor: 'Цвет упаковки', identificationNotes: 'Как отличить от похожих товаров', unitsPerBox: 'Штук в коробке', rigidity: 'Жёсткость 1–5', fragility: 'Хрупкость 1–5' }).map(([key, label]) => <label key={key}>{label}<input value={draft[key as keyof typeof draft]} onChange={e => setDraft(current => ({ ...current, [key]: e.target.value }))} /></label>)}{['itemSpec', 'boxSpec'].map(key => <fieldset key={key}><legend>{key === 'itemSpec' ? 'Единица товара' : 'Коробка'}</legend>{specs.filter(field => key === 'boxSpec' || field !== 'maxTopLoadKg').map(field => <label key={field}>{labels[field]}<input type="number" min="0" step="any" value={physical[`${key}.${field}`]} onChange={e => setPhysical(current => ({ ...current, [`${key}.${field}`]: e.target.value }))} /></label>)}</fieldset>)}<label>Фото JPEG / PNG / WebP<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] || null)} /></label><label><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />Идентификация товара проверена</label><p className="wide operations-muted">Сохранение вручную не подтверждает инженерную прочность коробки. Вводите измеренные характеристики и данные производителя.</p><button disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить изменения'}</button>{message && <p role="status">{message}</p>}</form></details>
}
