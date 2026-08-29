import { AlertTriangle, Check, ExternalLink, Globe2, LoaderCircle, Search, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  applyResearchSelection,
  buildResearchComparison,
  defaultResearchSelection,
  getCachedProductResearch,
  ProductResearchError,
  researchProductOnline,
  type ResearchFieldKey,
} from './research'
import { saveProduct, type Product } from './storage'
import type { ProductResearchResult } from './researchTypes'

type ProductResearchModalProps = {
  barcode: string
  product?: Product
  onClose: () => void
  onProductSaved: (product: Product) => void
}

const confidenceLabels = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' } as const
const identityLabels = { exact: 'Точное совпадение', probable: 'Вероятное совпадение', ambiguous: 'Неоднозначно', not_found: 'Товар не найден' } as const

export function ProductResearchModal({ barcode, product, onClose, onProductSaved }: ProductResearchModalProps) {
  const [result, setResult] = useState<ProductResearchResult | null>(() => product?.research?.result ?? getCachedProductResearch(barcode))
  const [selected, setSelected] = useState<Set<ResearchFieldKey>>(new Set())
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sku, setSku] = useState(product?.sku ?? '')
  const [location, setLocation] = useState(product?.location ?? '')

  const fields = useMemo(() => result ? buildResearchComparison(product, result) : [], [product, result])

  useEffect(() => {
    const restored = product?.research?.result ?? getCachedProductResearch(barcode)
    setResult(restored)
    setSku(product?.sku ?? '')
    setLocation(product?.location ?? '')
    setError('')
  }, [barcode, product?.id, product?.research?.result, product?.location, product?.sku])

  useEffect(() => {
    if (!result) {
      setSelected(new Set())
      return
    }
    setSelected(defaultResearchSelection(product, buildResearchComparison(product, result)))
  }, [product, result])

  const runResearch = async () => {
    if (result && !window.confirm('Выполнить новый интернет-поиск для этого товара? Это создаст новый платный запрос OpenAI.')) return
    setBusy(true)
    setError('')
    try {
      const researched = await researchProductOnline(barcode, product)
      setResult(researched)
      if (product) {
        const draft = await saveProduct({
          ...product,
          technicalVerificationStatus: researched.conflicts.length ? 'conflict' : 'needs_review',
          research: { status: 'needs_review', result: researched },
        })
        onProductSaved(draft.product)
      }
    } catch (reason) {
      console.error(reason)
      setError(reason instanceof ProductResearchError ? reason.message : 'Не удалось выполнить поиск товара.')
    } finally {
      setBusy(false)
    }
  }

  const toggleField = (key: ResearchFieldKey) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const confirmResearch = async () => {
    if (!result) return
    const cleanSku = sku.replace(/\D/g, '')
    const cleanLocation = location.trim().toUpperCase()
    if (!product && (!/^\d{3,10}$/.test(cleanSku) || !cleanLocation)) {
      setError('Для нового товара укажите внутренний מק״ט и адрес хранения.')
      return
    }
    const name = product?.name || (selected.has('name') ? result.name.value : null)
    if (!name) {
      setError('Название не найдено. Товар пока нельзя добавить — внесите его вручную.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      const base: Product = product ?? {
        id: crypto.randomUUID(),
        sku: cleanSku,
        barcode: barcode.replace(/\D/g, ''),
        name,
        location: cleanLocation,
        verificationStatus: 'verified',
        verificationSource: 'manual',
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      }
      const updated = applyResearchSelection(base, result, selected)
      const saved = await saveProduct(product ? updated : {
        sku: updated.sku,
        barcode: updated.barcode,
        name: updated.name,
        location: updated.location,
        description: updated.description,
        brand: updated.brand,
        netContent: updated.netContent,
        unitsPerBox: updated.unitsPerBox,
        caseBarcode: updated.caseBarcode,
        itemSpec: updated.itemSpec,
        boxSpec: updated.boxSpec,
        technicalDataSource: updated.technicalDataSource,
        technicalVerificationStatus: updated.technicalVerificationStatus,
        research: updated.research,
        verificationStatus: 'verified',
        verificationSource: 'manual',
        verifiedAt: now,
      })
      onProductSaved(saved.product)
      onClose()
    } catch (reason) {
      console.error(reason)
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить подтверждённые данные.')
    } finally {
      setSaving(false)
    }
  }

  const isDifference = (current: string, proposed: string) => current !== '—' && proposed !== '—' && current !== proposed

  return (
    <div className="modal-backdrop product-research-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="product-research-modal" role="dialog" aria-modal="true" aria-labelledby="product-research-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="product-research-heading">
          <div><span><Globe2 size={21} /></span><div><p>ИНТЕРНЕТ-СВЕРКА ОДНОГО ТОВАРА</p><h2 id="product-research-title">Штрихкод {barcode}</h2></div></div>
          <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}><X size={18} /></button>
        </header>

        {!result ? (
          <div className="product-research-start">
            <Search size={38} />
            <h3>{product ? `Сверить «${product.name}»` : 'Найти товар по штрихкоду'}</h3>
            <p>OpenAI выполнит веб-поиск только для этого штрихкода. Остальные товары базы не затрагиваются.</p>
            <button className="primary-button" type="button" disabled={busy} onClick={() => void runResearch()}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Globe2 size={18} />}{busy ? 'Идёт поиск…' : 'Найти данные в интернете'}
            </button>
          </div>
        ) : (
          <>
            <div className={`product-research-match ${result.identityMatch}`}>
              <div>{result.identityMatch === 'exact' || result.identityMatch === 'probable' ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}<span><b>{identityLabels[result.identityMatch]}</b><small>Уверенность в идентификации: {Math.round(result.identityConfidence)}%</small></span></div>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void runResearch()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Globe2 size={16} />}{busy ? 'Обновляю…' : 'Проверить заново'}</button>
            </div>

            {(result.conflicts.length > 0 || result.warnings.length > 0) && <div className="product-research-alerts">
              {result.conflicts.map((message, index) => <p className="conflict" key={`conflict-${index}`}><AlertTriangle size={15} />{message}</p>)}
              {result.warnings.map((message, index) => <p key={`warning-${index}`}><AlertTriangle size={15} />{message}</p>)}
            </div>}

            <div className="product-research-table-wrap">
              <table className="product-research-table">
                <thead><tr><th>Применить</th><th>Поле</th><th>Сейчас в БД</th><th>Найдено</th><th>Надёжность</th></tr></thead>
                <tbody>{fields.map((field) => (
                  <tr className={`${field.hasProposal ? '' : 'not-found'} ${isDifference(field.currentValue, field.proposedValue) ? 'different' : ''}`} key={field.key}>
                    <td><input type="checkbox" aria-label={`Применить поле ${field.label}`} disabled={!field.hasProposal} checked={selected.has(field.key)} onChange={() => toggleField(field.key)} /></td>
                    <th>{field.label}</th>
                    <td dir="auto">{field.currentValue}</td>
                    <td dir="auto"><b>{field.hasProposal ? field.proposedValue : 'Не найдено'}</b>{field.note && <small>{field.note}</small>}{field.sourceUrls.length > 0 && <span className="product-research-field-sources">{field.sourceUrls.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url}>Источник {index + 1}<ExternalLink size={11} /></a>)}</span>}</td>
                    <td><span className={`research-confidence ${field.confidence}`}>{confidenceLabels[field.confidence]}</span>{field.valueType !== 'published' && field.valueType !== 'not_found' && <small>{field.valueType === 'estimated' ? 'Оценка' : 'Расчёт'}</small>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            {!product && <div className="product-research-new-fields">
              <p><b>Новый товар</b><span>Интернет не знает внутренний адрес склада и מק״ט.</span></p>
              <label><span>מק״ט</span><input inputMode="numeric" value={sku} onChange={(event) => setSku(event.target.value)} placeholder="1511" /></label>
              <label><span>Адрес хранения</span><input value={location} onChange={(event) => setLocation(event.target.value.toUpperCase())} placeholder="23.F" /></label>
            </div>}

            <section className="product-research-sources">
              <h3>Использованные источники · {result.sources.length}</h3>
              {result.sources.length ? <ol>{result.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer"><span>{source.title}</span><ExternalLink size={14} /></a></li>)}</ol> : <p>Список подтверждённых источников не получен. Не принимайте неподтверждённые значения.</p>}
              <small>Модель: {result.model} · {new Date(result.researchedAt).toLocaleString('ru-RU')}</small>
            </section>
          </>
        )}

        {error && <p className="product-research-error" role="alert"><AlertTriangle size={16} />{error}</p>}

        <footer className="product-research-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Закрыть</button>
          {result && <button className="primary-button" type="button" disabled={saving || busy || result.identityMatch === 'not_found'} onClick={() => void confirmResearch()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? 'Сохраняю…' : product ? 'Подтвердить сверку' : 'Добавить подтверждённый товар'}</button>}
        </footer>
      </section>
    </div>
  )
}
