import { Boxes, Search, ShieldCheck } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { searchSharedCatalog, type SharedCatalogProduct } from './sharedApi'

export function CatalogSearch() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SharedCatalogProduct[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState('Введите название, адрес, מק״ט или штрихкод.')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    if (value.length < 2) {
      setState('error')
      setMessage('Введите минимум два символа.')
      return
    }
    setState('loading')
    setMessage('Поиск в общей базе…')
    try {
      const result = await searchSharedCatalog(value)
      setItems(result)
      setState('ready')
      setMessage(result.length ? `Найдено: ${result.length}` : 'Совпадений не найдено.')
    } catch (reason) {
      setItems([])
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось выполнить поиск.')
    }
  }

  return (
    <div className="page shared-catalog-page">
      <div className="page-heading"><div><p className="eyebrow">ОБЩАЯ БАЗА</p><h1>Поиск товара</h1><p>Сборщик видит только результаты конкретного поиска — полный каталог и выгрузка недоступны.</p></div></div>
      <section className="shared-search-panel">
        <form onSubmit={(event) => void submit(event)}>
          <Search size={21} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: 7290121920100, 1112 или 24.F" aria-label="Поиск в общей базе товаров" />
          <button type="submit" disabled={state === 'loading'}>{state === 'loading' ? 'Ищем…' : 'Найти'}</button>
        </form>
        <div className={`shared-search-message ${state}`}><ShieldCheck size={16} />{message}</div>
      </section>
      {items.length > 0 ? <div className="shared-product-results">{items.map((product) => (
        <article key={product.id}>
          <span className="shared-product-icon"><Boxes size={21} /></span>
          <div className="shared-product-main"><h2>{product.name}</h2><p><b>{product.location}</b><span>Штрихкод {product.barcode}</span><span>מק״ט {product.sku}</span></p></div>
          <div className="shared-product-meta"><span className={product.verificationStatus === 'verified' ? 'verified' : 'unverified'}>{product.verificationStatus === 'verified' ? 'Проверен' : 'Не проверен'}</span><small>{product.unitsPerBox ? `${product.unitsPerBox} шт. в коробке` : 'Фасовка не указана'}</small></div>
        </article>
      ))}</div> : state === 'ready' && <div className="shared-search-empty"><Search size={34} /><h2>Ничего не найдено</h2><p>Проверьте штрихкод, מק״ט, название или адрес.</p></div>}
    </div>
  )
}
