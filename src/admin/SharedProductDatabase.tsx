import { AlertTriangle, Barcode, Boxes, ChevronDown, ChevronUp, Database, FileJson, ImageOff, MapPin, RefreshCw, Search, ShieldCheck, Upload } from 'lucide-react'
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { type Product } from '../products/storage'
import { openDatabase, PRODUCTS_STORE, requestToPromise } from '../storage/database'
import { ProductEditor } from '../products/ProductEditor'
import { parseProductDocument } from '../products/transfer'
import { createSharedProduct, getAdminProductPage, importSharedProducts, type SharedProductImportResult, type SharedProductPage } from '../products/sharedApi'

const emptyPage: SharedProductPage = { items: [], total: 0, unverified: 0, offset: 0, limit: 100 }

function formatDimensions(spec: SharedProductPage['items'][number]['itemSpec']) {
  if (!spec?.lengthCm || !spec.widthCm || !spec.heightCm) return 'Не заданы'
  return `${spec.lengthCm} × ${spec.widthCm} × ${spec.heightCm} см`
}

function formatWeight(value?: number) {
  return value && value > 0 ? `${value} кг` : 'Не задан'
}

function hasPackingData(product: SharedProductPage['items'][number]) {
  return Boolean(product.boxSpec?.lengthCm && product.boxSpec.widthCm && product.boxSpec.heightCm)
}

export function SharedProductDatabase({ onChange }: { onChange?: () => void }) {
  const [page, setPage] = useState(emptyPage)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [importErrors, setImportErrors] = useState<SharedProductImportResult['errors']>([])
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ processed: number; total: number } | null>(null)
  const [expandedProductId, setExpandedProductId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState({ name: '', location: '', barcode: '', sku: '', description: '', unitsPerBox: '' })

  const load = useCallback(async (value = '', offset = 0) => {
    setState('loading')
    try {
      setPage(await getAdminProductPage(value, offset))
      setState('ready')
    } catch (reason) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось загрузить общую базу.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const search = (event: FormEvent) => { event.preventDefault(); void load(query) }
  const importSummary = (result: SharedProductImportResult) => {
    setImportErrors(result.errors)
    const errorDetails = result.errors.length
      ? ` Не перенесено: ${result.errors.length}. Первая ошибка — строка ${result.errors[0].index + 1}: ${result.errors[0].error}`
      : ''
    return `Перенос завершён: ${result.created} создано, ${result.updated} обновлено, ${result.skipped} пропущено.${errorDetails}`
  }
  const migrate = async () => {
    if (!window.confirm('Добавить или обновить товары в общей базе данными с этого устройства?')) return
    setImporting(true)
    setImportProgress(null)
    setMessage('')
    let refresh = false
    try {
      const db = await openDatabase(true)
      let local: Product[]
      try { local = await requestToPromise(db.transaction(PRODUCTS_STORE).objectStore(PRODUCTS_STORE).getAll()) as Product[] } finally { db.close() }
      if (!local.length) { setMessage('На этом адресе сайта нет локальных товаров. Если база сохранена на другом домене, экспортируйте её там и используйте «Импорт JSON в D1».'); return }
      setImportProgress({ processed: 0, total: local.length })
      const result = await importSharedProducts(local, fetch, (processed, total) => setImportProgress({ processed, total }))
      setMessage(importSummary(result))
      refresh = true
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось перенести товары.')
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
    if (refresh) { void load(query); onChange?.() }
  }

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setImportProgress(null)
    setMessage('')
    let refresh = false
    try {
      const document = parseProductDocument(await file.text())
      if (!document.products.length) { setMessage('В выбранном файле нет товаров.'); return }
      setImportProgress({ processed: 0, total: document.products.length })
      const result = await importSharedProducts(document.products, fetch, (processed, total) => setImportProgress({ processed, total }))
      setMessage(importSummary(result))
      refresh = true
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось импортировать JSON в общую базу.')
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
    if (refresh) { void load(query); onChange?.() }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    try {
      await createSharedProduct({
        name: draft.name,
        location: draft.location,
        barcode: draft.barcode,
        sku: draft.sku,
        description: draft.description,
        ...(Number(draft.unitsPerBox) > 0 ? { unitsPerBox: Number(draft.unitsPerBox) } : {}),
      })
      setDraft({ name: '', location: '', barcode: '', sku: '', description: '', unitsPerBox: '' })
      setMessage('Товар добавлен в общую базу как проверенный вручную.')
      await load(query)
      onChange?.()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить товар.')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-heading"><div><p className="eyebrow">ОБЩИЙ СПРАВОЧНИК</p><h1>База товаров</h1><p>D1 — единый источник для всех устройств. Полный просмотр и импорт доступны только администратору.</p></div><div className="admin-heading-actions"><input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importJson(event)} /><button className="admin-secondary-action" type="button" disabled={importing} onClick={() => fileInputRef.current?.click()}><FileJson size={17} />Импорт JSON в D1</button><button className="admin-primary-action" type="button" disabled={importing} onClick={() => void migrate()}><Upload size={17} />{importing ? importProgress ? `Перенос ${importProgress.processed}/${importProgress.total}` : 'Подготовка…' : 'Перенести с устройства'}</button></div></div>
      <details className="admin-product-create">
        <summary>Добавить один товар вручную</summary>
        <form onSubmit={(event) => void create(event)}>
          <label>Название<input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Адрес<input required value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} placeholder="24.F" /></label>
          <label>Штрихкод<input required inputMode="numeric" value={draft.barcode} onChange={(event) => setDraft((current) => ({ ...current, barcode: event.target.value }))} /></label>
          <label>מק״ט<input required inputMode="numeric" value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} /></label>
          <label>В коробке<input inputMode="decimal" value={draft.unitsPerBox} onChange={(event) => setDraft((current) => ({ ...current, unitsPerBox: event.target.value }))} /></label>
          <label className="wide">Описание<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <button className="admin-primary-action" type="submit">Сохранить в D1</button>
        </form>
      </details>
      <section className="admin-catalog-summary"><article><small>Всего товаров</small><strong>{page.total}</strong></article><article><small>Требуют проверки</small><strong>{page.unverified}</strong></article><form onSubmit={search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск в общей базе" /><button type="submit">Найти</button></form></section>
      {message && <div className="admin-inline-message"><Database size={17} />{message}</div>}
      {importErrors.length > 0 && <details className="operations-message"><summary>Все конфликты и ошибки переноса ({importErrors.length})</summary><ul>{importErrors.map((entry, index) => <li key={index}>Строка {entry.index + 1}: {entry.error}</li>)}</ul></details>}
      <section className="admin-panel admin-shared-products">
        <header><div><span>КАТАЛОГ D1</span><h2>{query ? `Результаты «${query}»` : 'Последние изменения'}</h2></div><button className="admin-secondary-action" type="button" onClick={() => void load(query)}><RefreshCw size={15} />Обновить</button></header>
        {state === 'loading' ? <div className="admin-empty-compact"><RefreshCw className="spin" size={27} /><b>Загрузка общей базы</b></div>
          : state === 'error' ? <div className="admin-empty-compact"><Database size={27} /><b>{message}</b></div>
            : page.items.length ? <div className="product-directory admin-product-directory" role="list" aria-label="Товары общей базы">{page.items.map((product) => {
              const expanded = expandedProductId === product.id
              const verified = product.verificationStatus === 'verified'
              return <article className={`product-directory-item ${expanded ? 'expanded' : ''} ${verified ? 'product-verified' : 'product-unverified'}`} key={product.id} role="listitem">
                <button className="product-directory-summary" type="button" aria-expanded={expanded} aria-controls={`admin-product-extra-${product.id}`} onClick={() => setExpandedProductId((current) => current === product.id ? '' : product.id)}>
                  <span className="product-directory-primary"><strong dir="auto">{product.name}</strong><span className="location-badge"><MapPin size={14} />{product.location}</span><span className={`verification-badge ${verified ? 'verified' : 'unverified'}`}>{verified ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}{verified ? 'Проверен' : 'Не проверен'}</span></span>
                  <span className="product-directory-code product-directory-barcode"><small>Штрихкод</small><b><Barcode size={14} />{product.barcode}</b></span>
                  <span className="product-directory-code"><small>מק״ט</small><b>{product.sku}</b></span>
                  <span className="product-directory-packing">{hasPackingData(product) ? <span className="packing-ready">Габариты заданы</span> : <span className="packing-missing">Нет габаритов</span>}</span>
                  <span className="product-directory-disclosure"><span>{expanded ? 'Скрыть' : 'Подробнее'}</span>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                </button>
                {expanded && <div className="product-directory-details admin-product-directory-details" id={`admin-product-extra-${product.id}`}>
                  <div className="product-detail-content">
                    <div className="product-detail-image">{product.imageUrl || product.imageDataUrl ? <img src={product.imageUrl || product.imageDataUrl} alt={product.name} /> : <span><ImageOff size={27} />Фото не загружено</span>}</div>
                    <div className="product-detail-description"><span>Описание</span><p dir="auto">{product.description?.trim() || 'Описание пока не добавлено.'}</p>{(product.brand || product.netContent) && <small>{product.brand && <b dir="auto">{product.brand}</b>}{product.brand && product.netContent ? ' · ' : ''}{product.netContent}</small>}</div>
                  </div>
                  <div className="admin-product-detail-groups">
                    <section><span>Одна единица</span><b>{formatDimensions(product.itemSpec)}</b><small>Вес: {formatWeight(product.itemSpec?.weightKg)}</small></section>
                    <section><span>Коробка</span><b>{formatDimensions(product.boxSpec)}</b><small>Вес: {formatWeight(product.boxSpec?.weightKg)}</small><small>Нагрузка сверху: {formatWeight(product.boxSpec?.maxTopLoadKg)}</small></section>
                    <section><span>Комплектация</span><b>{product.unitsPerBox ? `${product.unitsPerBox} шт. в коробке` : 'Количество не задано'}</b><small>{product.caseBarcode ? `GTIN коробки: ${product.caseBarcode}` : 'GTIN коробки не задан'}</small></section>
                    <section><span>Свойства упаковки</span><b>Жёсткость: {product.rigidity ?? '—'} / 5</b><small>Хрупкость: {product.fragility ?? '—'} / 5</small></section>
                  </div>
                  <div className="admin-product-detail-meta"><Boxes size={15} /><span>Источник: {product.verificationSource || 'не указан'}</span><span>Версия {product.version ?? 1}</span><span>Обновлено: {new Date(product.updatedAt).toLocaleString('ru-RU')}</span></div>
                  <p className="operations-muted">Характеристики: {product.technicalDataSource || 'источник не указан'} · {product.technicalVerificationStatus || 'не подтверждены'}</p>
                  <ProductEditor key={`${product.id}:${product.version}`} product={product} onSaved={() => { void load(query, page.offset); onChange?.() }} />
                </div>}
              </article>
            })}</div>
              : <div className="admin-empty-compact"><Database size={27} /><b>В общей базе пока нет товаров</b><span>Перенесите локальные карточки с этого устройства.</span></div>}
      </section>
      <div className="operations-toolbar"><button disabled={state === 'loading' || page.offset === 0} onClick={() => void load(query, Math.max(0, page.offset - page.limit))}>← Предыдущие</button><span>{page.total ? page.offset + 1 : 0}–{Math.min(page.offset + page.items.length, page.total)} из {page.total}</span><button disabled={state === 'loading' || page.offset + page.limit >= page.total} onClick={() => void load(query, page.offset + page.limit)}>Следующие →</button></div>
    </div>
  )
}
