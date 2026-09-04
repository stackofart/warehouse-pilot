import { Database, FileJson, RefreshCw, Search, Upload } from 'lucide-react'
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { listProducts } from '../products/storage'
import { parseProductDocument } from '../products/transfer'
import { createSharedProduct, getAdminProductPage, importSharedProducts, type SharedProductImportResult, type SharedProductPage } from '../products/sharedApi'

const emptyPage: SharedProductPage = { items: [], total: 0, unverified: 0, offset: 0, limit: 100 }

export function SharedProductDatabase({ onChange }: { onChange?: () => void }) {
  const [page, setPage] = useState(emptyPage)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState({ name: '', location: '', barcode: '', sku: '', description: '', unitsPerBox: '' })

  const load = useCallback(async (value = '') => {
    setState('loading')
    try {
      setPage(await getAdminProductPage(value))
      setState('ready')
    } catch (reason) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось загрузить общую базу.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const search = (event: FormEvent) => { event.preventDefault(); void load(query) }
  const importSummary = (result: SharedProductImportResult) => {
    const errorDetails = result.errors.length
      ? ` Не перенесено: ${result.errors.length}. Первая ошибка — строка ${result.errors[0].index + 1}: ${result.errors[0].error}`
      : ''
    return `Перенос завершён: ${result.created} создано, ${result.updated} обновлено, ${result.skipped} пропущено.${errorDetails}`
  }
  const migrate = async () => {
    if (!window.confirm('Добавить или обновить товары в общей базе данными с этого устройства?')) return
    setImporting(true)
    setMessage('')
    try {
      const local = await listProducts()
      if (!local.length) { setMessage('На этом адресе сайта нет локальных товаров. Если база сохранена на другом домене, экспортируйте её там и используйте «Импорт JSON в D1».'); return }
      const result = await importSharedProducts(local)
      setMessage(importSummary(result))
      await load(query)
      onChange?.()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось перенести товары.')
    } finally {
      setImporting(false)
    }
  }

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setMessage('')
    try {
      const document = parseProductDocument(await file.text())
      if (!document.products.length) { setMessage('В выбранном файле нет товаров.'); return }
      const result = await importSharedProducts(document.products)
      setMessage(importSummary(result))
      await load(query)
      onChange?.()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось импортировать JSON в общую базу.')
    } finally {
      setImporting(false)
    }
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
      <div className="admin-page-heading"><div><p className="eyebrow">ОБЩИЙ СПРАВОЧНИК</p><h1>База товаров</h1><p>D1 — единый источник для всех устройств. Полный просмотр и импорт доступны только администратору.</p></div><div className="admin-heading-actions"><input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importJson(event)} /><button className="admin-secondary-action" type="button" disabled={importing} onClick={() => fileInputRef.current?.click()}><FileJson size={17} />Импорт JSON в D1</button><button className="admin-primary-action" type="button" disabled={importing} onClick={() => void migrate()}><Upload size={17} />{importing ? 'Перенос…' : 'Перенести с устройства'}</button></div></div>
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
      <section className="admin-panel admin-shared-products">
        <header><div><span>КАТАЛОГ D1</span><h2>{query ? `Результаты «${query}»` : 'Последние изменения'}</h2></div><button className="admin-secondary-action" type="button" onClick={() => void load(query)}><RefreshCw size={15} />Обновить</button></header>
        {state === 'loading' ? <div className="admin-empty-compact"><RefreshCw className="spin" size={27} /><b>Загрузка общей базы</b></div>
          : state === 'error' ? <div className="admin-empty-compact"><Database size={27} /><b>{message}</b></div>
            : page.items.length ? <div className="admin-shared-product-list">{page.items.map((product) => <article key={product.id}><span><b>{product.name}</b><small>{product.barcode} · מק״ט {product.sku}</small></span><strong>{product.location}</strong><em className={product.verificationStatus}>{product.verificationStatus === 'verified' ? 'Проверен' : 'Не проверен'}</em><small>{product.unitsPerBox ? `${product.unitsPerBox} шт./кор.` : 'Фасовка не указана'}</small></article>)}</div>
              : <div className="admin-empty-compact"><Database size={27} /><b>В общей базе пока нет товаров</b><span>Перенесите локальные карточки с этого устройства.</span></div>}
      </section>
    </div>
  )
}
