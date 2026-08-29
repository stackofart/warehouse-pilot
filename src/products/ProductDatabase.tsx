import { AlertTriangle, Barcode, Boxes, CheckCircle2, ChevronDown, ChevronUp, Database, Download, FileJson, FileUp, Globe2, ImagePlus, MapPin, PackagePlus, Pencil, Search, ShieldCheck, Trash2, WandSparkles, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import { clearProducts, deleteProduct, isProductVerified, listProducts, saveProduct, setProductVerification, type Product } from './storage'
import { simulateProductTechnicalData } from './simulation'
import { createProductDocument, importProductDocument, parseProductDocument, productImportExample, productJsonSchema, type ProductConflict } from './transfer'
import { ProductResearchModal } from './ProductResearchModal'

type ProductForm = Pick<Product, 'sku' | 'barcode' | 'name' | 'location'> & {
  brand: string
  description: string
  netContent: string
  unitsPerBox: string
  caseBarcode: string
  itemLengthCm: string
  itemWidthCm: string
  itemHeightCm: string
  itemWeightKg: string
  boxLengthCm: string
  boxWidthCm: string
  boxHeightCm: string
  boxWeightKg: string
  maxTopLoadKg: string
  rigidity: string
  fragility: string
  imageDataUrl: string
}

const emptyForm: ProductForm = {
  sku: '',
  barcode: '',
  name: '',
  location: '',
  brand: '',
  description: '',
  netContent: '',
  unitsPerBox: '',
  caseBarcode: '',
  itemLengthCm: '', itemWidthCm: '', itemHeightCm: '', itemWeightKg: '',
  boxLengthCm: '', boxWidthCm: '', boxHeightCm: '', boxWeightKg: '', maxTopLoadKg: '',
  rigidity: '', fragility: '', imageDataUrl: '',
}

function optionalNumber(value: string) {
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function productHasPackingData(product: Product) {
  return Boolean(product.boxSpec?.lengthCm && product.boxSpec.widthCm && product.boxSpec.heightCm && product.boxSpec.weightKg && product.rigidity && product.fragility)
}

export function ProductDatabase() {
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [expandedProductId, setExpandedProductId] = useState('')
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete'; product: Product } | { type: 'clear' } | null>(null)
  const [importConflicts, setImportConflicts] = useState<ProductConflict[]>([])
  const [researchTarget, setResearchTarget] = useState<Product | null>(null)

  const refreshProducts = async () => {
    setIsLoading(true)
    try {
      const storedProducts = await listProducts()
      const missingEstimates = storedProducts.map(simulateProductTechnicalData).filter((value) => value !== null)
      for (const input of missingEstimates) await saveProduct(input)
      setProducts(missingEstimates.length ? await listProducts() : storedProducts)
      if (missingEstimates.length) setMessage(`Автоматически добавлены оценочные характеристики: ${missingEstimates.length} товаров`)
      setError('')
    } catch (reason) {
      console.error(reason)
      setError('Не удалось открыть локальную базу товаров')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshProducts()
  }, [])

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return products
    return products.filter((product) =>
      [product.sku, product.barcode, product.name, product.location, product.description ?? '']
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    )
  }, [products, query])

  const updateForm = (field: keyof ProductForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setMessage('')
    setError('')
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId('')
    setMessage('')
    setError('')
    setIsFormOpen(false)
  }

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const product = {
      sku: form.sku.replace(/\D/g, ''),
      barcode: form.barcode.replace(/\D/g, ''),
      name: form.name.trim(),
      location: form.location.trim().toUpperCase(),
      brand: form.brand.trim() || undefined,
      description: form.description.trim() || undefined,
      netContent: form.netContent.trim() || undefined,
      unitsPerBox: optionalNumber(form.unitsPerBox),
      caseBarcode: form.caseBarcode.replace(/\D/g, '') || undefined,
      itemSpec: {
        lengthCm: optionalNumber(form.itemLengthCm), widthCm: optionalNumber(form.itemWidthCm),
        heightCm: optionalNumber(form.itemHeightCm), weightKg: optionalNumber(form.itemWeightKg),
      },
      boxSpec: {
        lengthCm: optionalNumber(form.boxLengthCm), widthCm: optionalNumber(form.boxWidthCm),
        heightCm: optionalNumber(form.boxHeightCm), weightKg: optionalNumber(form.boxWeightKg),
        maxTopLoadKg: optionalNumber(form.maxTopLoadKg),
      },
      rigidity: optionalNumber(form.rigidity),
      fragility: optionalNumber(form.fragility),
      imageDataUrl: form.imageDataUrl || undefined,
      technicalDataSource: 'manual' as const,
      verificationStatus: 'verified' as const,
      verificationSource: 'manual' as const,
      verifiedAt: new Date().toISOString(),
    }

    if (!product.sku || !product.barcode || !product.name || !product.location) {
      setError('Заполните все четыре поля')
      return
    }
    if (!/^\d{3,10}$/.test(product.sku)) {
      setError('מק״ט должен содержать от 3 до 10 цифр')
      return
    }
    if (!/^\d{8,14}$/.test(product.barcode)) {
      setError('Штрихкод должен содержать от 8 до 14 цифр')
      return
    }
    if (product.caseBarcode && !/^\d{8,14}$/.test(product.caseBarcode)) {
      setError('Штрихкод коробки должен содержать от 8 до 14 цифр')
      return
    }

    setIsSaving(true)
    try {
      const result = await saveProduct({ ...product, id: editingId || undefined })
      const estimate = simulateProductTechnicalData(result.product)
      const finalProduct = estimate ? (await saveProduct(estimate)).product : result.product
      setProducts((current) => [finalProduct, ...current.filter((item) => item.id !== finalProduct.id)])
      setForm(emptyForm)
      setEditingId('')
      setIsFormOpen(false)
      setError('')
      setMessage(result.updated ? 'Карточка товара обновлена' : 'Товар добавлен в локальную базу')
    } catch (reason) {
      console.error(reason)
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить товар')
    } finally {
      setIsSaving(false)
    }
  }

  const editProduct = (product: Product) => {
    setForm({
      sku: product.sku, barcode: product.barcode, name: product.name, location: product.location, brand: product.brand ?? '', description: product.description ?? '', netContent: product.netContent ?? '',
      unitsPerBox: product.unitsPerBox?.toString() ?? '',
      caseBarcode: product.caseBarcode ?? '',
      itemLengthCm: product.itemSpec?.lengthCm?.toString() ?? '', itemWidthCm: product.itemSpec?.widthCm?.toString() ?? '',
      itemHeightCm: product.itemSpec?.heightCm?.toString() ?? '', itemWeightKg: product.itemSpec?.weightKg?.toString() ?? '',
      boxLengthCm: product.boxSpec?.lengthCm?.toString() ?? '', boxWidthCm: product.boxSpec?.widthCm?.toString() ?? '',
      boxHeightCm: product.boxSpec?.heightCm?.toString() ?? '', boxWeightKg: product.boxSpec?.weightKg?.toString() ?? '',
      maxTopLoadKg: product.boxSpec?.maxTopLoadKg?.toString() ?? '', rigidity: product.rigidity?.toString() ?? '',
      fragility: product.fragility?.toString() ?? '', imageDataUrl: product.imageDataUrl ?? '',
    })
    setEditingId(product.id)
    setIsFormOpen(true)
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const loadProductImage = (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0]
    event.target.value = ''
    if (!image) return
    if (image.size > 3 * 1024 * 1024) {
      setError('Изображение товара должно быть меньше 3 МБ')
      return
    }
    const reader = new FileReader()
    reader.onload = () => updateForm('imageDataUrl', String(reader.result ?? ''))
    reader.onerror = () => setError('Не удалось прочитать изображение товара')
    reader.readAsDataURL(image)
  }

  const downloadJson = (filename: string, value: unknown) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const simulateDimensions = async () => {
    setIsSaving(true)
    try {
      const simulated = products.map(simulateProductTechnicalData).filter((value) => value !== null)
      for (const input of simulated) await saveProduct(input)
      await refreshProducts()
      setMessage(simulated.length ? `Добавлены оценочные характеристики: ${simulated.length} товаров` : 'Нет подходящих товаров с пустыми характеристиками')
      setError('')
    } catch (reason) {
      console.error(reason)
      setError('Не удалось добавить оценочные характеристики')
    } finally {
      setIsSaving(false)
    }
  }

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setIsSaving(true)
    try {
      const result = await importProductDocument(products, parseProductDocument(await file.text()))
      await refreshProducts()
      setImportConflicts(result.conflicts)
      setMessage(`Импортировано: ${result.imported}. Пропущено: ${result.skipped}.`)
      setError('')
    } catch (reason) {
      console.error(reason)
      setError(reason instanceof Error ? reason.message : 'Не удалось импортировать товары')
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!confirmAction) return
    setIsSaving(true)
    try {
      if (confirmAction.type === 'clear') {
        await clearProducts()
        setProducts([])
        setMessage('База товаров очищена')
      } else {
        await deleteProduct(confirmAction.product.id)
        setProducts((current) => current.filter((product) => product.id !== confirmAction.product.id))
        setMessage('Товар удалён')
        if (editingId === confirmAction.product.id) resetForm()
      }
      setConfirmAction(null)
      setError('')
    } catch (reason) {
      console.error(reason)
      setError('Не удалось удалить данные')
    } finally {
      setIsSaving(false)
    }
  }

  const verifyProduct = async (product: Product) => {
    setIsSaving(true)
    try {
      await setProductVerification(product.id, 'verified')
      await refreshProducts()
      setMessage(`Товар «${product.name}» подтверждён`)
    } catch (reason) {
      console.error(reason)
      setError('Не удалось подтвердить товар')
    } finally {
      setIsSaving(false)
    }
  }

  const handleResearchedProduct = (product: Product) => {
    setProducts((current) => [product, ...current.filter((item) => item.id !== product.id)])
    setResearchTarget(product)
    setMessage(product.research?.status === 'verified' ? `Интернет-сверка «${product.name}» подтверждена` : `Данные «${product.name}» найдены и ждут подтверждения`)
  }

  const unverifiedCount = products.filter((product) => !isProductVerified(product)).length

  return (
    <div className="page products-page">
      <div className="page-heading products-heading">
        <div>
          <p className="eyebrow">СПРАВОЧНИК ТОВАРОВ</p>
          <h1>Локальная база товаров</h1>
          <p>Свяжите מק״ט и штрихкод с названием товара и его адресом на складе.</p>
        </div>
        <div className="product-count"><Database size={17} /><div><strong>{products.length}</strong><span>{unverifiedCount ? `${unverifiedCount} требуют проверки` : 'все товары проверены'}</span></div></div>
      </div>

      <section className="product-tools" aria-label="Инструменты базы товаров">
        <button className="secondary-button" type="button" disabled={isSaving} onClick={() => void simulateDimensions()}><WandSparkles size={15} />Симулировать габариты</button>
        <label className="secondary-button product-import-button file-picker-trigger"><FileUp size={15} />Импорт JSON<input className="file-picker-input" aria-label="Выбрать JSON товаров" type="file" accept="application/json,.json" onChange={importJson} /></label>
        <button className="secondary-button" type="button" disabled={!products.length} onClick={() => downloadJson('warehouse-pilot-products.json', createProductDocument(products))}><Download size={15} />Экспорт товаров</button>
        <button className="secondary-button" type="button" onClick={() => downloadJson('warehouse-pilot-products.schema.json', productJsonSchema)}><FileJson size={15} />JSON Schema</button>
        <button className="secondary-button" type="button" onClick={() => downloadJson('warehouse-pilot-products.example.json', productImportExample)}><FileJson size={15} />Пример импорта</button>
        <button className="danger-button" type="button" disabled={!products.length || isSaving} onClick={() => setConfirmAction({ type: 'clear' })}><Trash2 size={15} />Очистить базу</button>
      </section>

      <div className="products-layout">
        <section className={`product-form-card ${isFormOpen ? 'open' : 'collapsed'}`}>
          <button className="product-form-toggle" type="button" aria-expanded={isFormOpen} aria-controls="product-editor" onClick={() => setIsFormOpen((current) => !current)}>
            <span><PackagePlus size={20} /></span>
            <div><p className="section-kicker">КАРТОЧКА ТОВАРА</p><h2>{editingId ? 'Редактировать товар' : 'Добавить товар'}</h2><small>{isFormOpen ? 'Свернуть форму' : 'Открыть форму добавления'}</small></div>
            {isFormOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {!isFormOpen && error && <p className="product-form-error product-form-collapsed-message" role="alert">{error}</p>}
          {!isFormOpen && message && <p className="product-form-success product-form-collapsed-message"><CheckCircle2 size={15} />{message}</p>}

          {isFormOpen && <form id="product-editor" onSubmit={submitProduct}>
            <label><span>מק״ט</span><input aria-label="מק״ט товара" inputMode="numeric" autoComplete="off" placeholder="Например, 1511" value={form.sku} onChange={(event) => updateForm('sku', event.target.value)} /></label>
            <label><span>Штрихкод</span><input aria-label="Штрихкод товара" inputMode="numeric" autoComplete="off" placeholder="7290121920285" value={form.barcode} onChange={(event) => updateForm('barcode', event.target.value)} /></label>
            <label className="product-name-field"><span>Название</span><input aria-label="Название товара" dir="auto" autoComplete="off" placeholder="Название товара" value={form.name} onChange={(event) => updateForm('name', event.target.value)} /></label>
            <label><span>Бренд</span><input aria-label="Бренд товара" dir="auto" autoComplete="off" placeholder="Milka" value={form.brand} onChange={(event) => updateForm('brand', event.target.value)} /></label>
            <label><span>Содержимое единицы</span><input aria-label="Содержимое единицы товара" dir="auto" autoComplete="off" placeholder="90 г / 700 мл" value={form.netContent} onChange={(event) => updateForm('netContent', event.target.value)} /></label>
            <label className="product-description-field"><span>Описание / примечание</span><textarea aria-label="Описание товара" dir="auto" autoComplete="off" maxLength={2000} placeholder="Короткое описание товара, особенности упаковки или комплектации" value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label>
            <label><span>Адрес хранения</span><input aria-label="Адрес хранения товара" autoComplete="off" placeholder="23.F" value={form.location} onChange={(event) => updateForm('location', event.target.value.toUpperCase())} /></label>
            <label><span>Штук в коробке</span><input aria-label="Штук товара в коробке" inputMode="numeric" placeholder="12" value={form.unitsPerBox} onChange={(event) => updateForm('unitsPerBox', event.target.value)} /></label>
            <label><span>Штрихкод коробки</span><input aria-label="Штрихкод коробки" inputMode="numeric" placeholder="GTIN-14, если есть" value={form.caseBarcode} onChange={(event) => updateForm('caseBarcode', event.target.value)} /></label>

            <div className="product-spec-section">
              <h3>Один товар</h3>
              <div className="dimension-grid">
                <label><span>Длина, см</span><input aria-label="Длина единицы товара" inputMode="decimal" value={form.itemLengthCm} onChange={(event) => updateForm('itemLengthCm', event.target.value)} /></label>
                <label><span>Ширина, см</span><input aria-label="Ширина единицы товара" inputMode="decimal" value={form.itemWidthCm} onChange={(event) => updateForm('itemWidthCm', event.target.value)} /></label>
                <label><span>Высота, см</span><input aria-label="Высота единицы товара" inputMode="decimal" value={form.itemHeightCm} onChange={(event) => updateForm('itemHeightCm', event.target.value)} /></label>
                <label><span>Вес, кг</span><input aria-label="Вес единицы товара" inputMode="decimal" value={form.itemWeightKg} onChange={(event) => updateForm('itemWeightKg', event.target.value)} /></label>
              </div>
            </div>

            <div className="product-spec-section">
              <h3>Коробка целиком</h3>
              <div className="dimension-grid">
                <label><span>Длина, см</span><input aria-label="Длина коробки" inputMode="decimal" value={form.boxLengthCm} onChange={(event) => updateForm('boxLengthCm', event.target.value)} /></label>
                <label><span>Ширина, см</span><input aria-label="Ширина коробки" inputMode="decimal" value={form.boxWidthCm} onChange={(event) => updateForm('boxWidthCm', event.target.value)} /></label>
                <label><span>Высота, см</span><input aria-label="Высота коробки" inputMode="decimal" value={form.boxHeightCm} onChange={(event) => updateForm('boxHeightCm', event.target.value)} /></label>
                <label><span>Вес, кг</span><input aria-label="Вес коробки" inputMode="decimal" value={form.boxWeightKg} onChange={(event) => updateForm('boxWeightKg', event.target.value)} /></label>
                <label><span>Нагрузка сверху, кг</span><input aria-label="Допустимая нагрузка сверху" inputMode="decimal" value={form.maxTopLoadKg} onChange={(event) => updateForm('maxTopLoadKg', event.target.value)} /></label>
              </div>
            </div>

            <div className="product-spec-section product-ratings">
              <label><span>Жёсткость · 1–5</span><select aria-label="Жёсткость упаковки" value={form.rigidity} onChange={(event) => updateForm('rigidity', event.target.value)}><option value="">Не задано</option>{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span>Хрупкость · 1–5</span><select aria-label="Хрупкость товара" value={form.fragility} onChange={(event) => updateForm('fragility', event.target.value)}><option value="">Не задано</option>{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label>
            </div>

            <div className="product-image-field">
              <span>Изображение товара</span>
              <div>{form.imageDataUrl ? <img src={form.imageDataUrl} alt="Товар" /> : <ImagePlus size={24} />}<label className="secondary-button file-picker-trigger"><ImagePlus size={15} />{form.imageDataUrl ? 'Заменить' : 'Добавить'}<input className="file-picker-input" aria-label="Выбрать изображение товара" type="file" accept="image/*" onChange={loadProductImage} /></label>{form.imageDataUrl && <button className="icon-button" type="button" aria-label="Удалить изображение товара" onClick={() => updateForm('imageDataUrl', '')}><X size={15} /></button>}</div>
            </div>

            {error && <p className="product-form-error" role="alert">{error}</p>}
            {message && <p className="product-form-success"><CheckCircle2 size={15} />{message}</p>}

            <div className="product-form-actions">
              <button className="primary-button" type="submit" disabled={isSaving}><PackagePlus size={17} />{isSaving ? 'Сохранение…' : editingId ? 'Сохранить изменения' : 'Добавить товар'}</button>
              {editingId && <button className="secondary-button" type="button" onClick={resetForm}><X size={16} />Отмена</button>}
            </div>
          </form>}
        </section>

        <section className="product-list-card">
          <div className="product-list-heading">
            <div><p className="section-kicker">БАЗА ДАННЫХ</p><h2>Сохранённые товары</h2><p className="product-list-hint">Нажмите товар, чтобы открыть фото, описание и сведения об упаковке.</p></div>
            <label className="product-search"><Search size={16} /><input aria-label="Поиск товаров" placeholder="Поиск по товару или адресу" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>

          {isLoading ? (
            <div className="products-empty"><Database size={27} /><p>Загружаем локальную базу…</p></div>
          ) : visibleProducts.length === 0 ? (
            <div className="products-empty"><Boxes size={29} /><strong>{query ? 'Ничего не найдено' : 'База пока пуста'}</strong><p>{query ? 'Измените поисковый запрос.' : 'Добавьте первый товар с помощью формы.'}</p></div>
          ) : (
            <div className="product-directory" role="list" aria-label="Сохранённые товары">
              {visibleProducts.map((product) => {
                const expanded = expandedProductId === product.id
                return (
                  <article className={`product-directory-item ${expanded ? 'expanded' : ''} ${isProductVerified(product) ? 'product-verified' : 'product-unverified'}`} key={product.id} role="listitem">
                    <button className="product-directory-summary" type="button" aria-expanded={expanded} aria-controls={`product-extra-${product.id}`} onClick={() => setExpandedProductId((current) => current === product.id ? '' : product.id)}>
                      <span className="product-directory-primary">
                        <strong dir="auto">{product.name}</strong>
                        <span className="location-badge"><MapPin size={14} />{product.location}</span>
                        <span className={`verification-badge ${isProductVerified(product) ? 'verified' : 'unverified'}`}>{isProductVerified(product) ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}{isProductVerified(product) ? 'Проверен' : 'Не проверен'}</span>
                      </span>
                      <span className="product-directory-code product-directory-barcode"><small>Штрихкод</small><b><Barcode size={14} />{product.barcode}</b></span>
                      <span className="product-directory-code"><small>מק״ט</small><b>{product.sku}</b></span>
                      <span className="product-directory-packing">{product.research?.status === 'needs_review' ? <span className="packing-review">Сверка ждёт подтверждения</span> : productHasPackingData(product) ? <span className="packing-ready">{product.technicalDataSource === 'simulated' ? 'Оценка габаритов' : product.technicalDataSource === 'web' ? 'Проверено по интернету' : 'Габариты заданы'}</span> : <span className="packing-missing">Нет габаритов</span>}</span>
                      <span className="product-directory-disclosure"><span>{expanded ? 'Скрыть' : 'Фото и описание'}</span>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                    </button>

                    {expanded && <div className="product-directory-details" id={`product-extra-${product.id}`}>
                      <div className="product-detail-content">
                        <div className="product-detail-image">{product.imageDataUrl ? <img src={product.imageDataUrl} alt={product.name} /> : <span><Boxes size={27} />Фото не добавлено</span>}</div>
                        <div className="product-detail-description"><span>Описание</span><p dir="auto">{product.description?.trim() || 'Описание пока не добавлено.'}</p></div>
                      </div>
                      <div className="product-detail-footer">
                        <div className="product-detail-facts"><span><b>{product.unitsPerBox ?? '—'}</b> шт. в коробке</span>{product.brand && <span>Бренд: <b dir="auto">{product.brand}</b></span>}{product.netContent && <span>Единица: <b dir="auto">{product.netContent}</b></span>}{product.caseBarcode && <span>GTIN коробки: <b>{product.caseBarcode}</b></span>}<span>{productHasPackingData(product) ? <><b>{product.boxSpec?.lengthCm}×{product.boxSpec?.widthCm}×{product.boxSpec?.heightCm} см</b> · {product.boxSpec?.weightKg} кг</> : 'Габариты ещё не заданы'}</span></div>
                        <div className="table-product-actions">{!isProductVerified(product) && <button className="table-verify-button" type="button" disabled={isSaving} onClick={() => void verifyProduct(product)}><ShieldCheck size={16} />Подтвердить</button>}<button className="table-research-button" type="button" onClick={() => setResearchTarget(product)}><Globe2 size={16} />{product.research?.status === 'needs_review' ? 'Открыть сверку' : 'Сверить в интернете'}</button><button className="table-edit-button" type="button" aria-label={`Редактировать ${product.name}`} onClick={() => editProduct(product)}><Pencil size={16} />Редактировать</button><button className="table-delete-button" type="button" aria-label={`Удалить ${product.name}`} onClick={() => setConfirmAction({ type: 'delete', product })}><Trash2 size={16} />Удалить</button></div>
                      </div>
                    </div>}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {confirmAction && <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmAction(null)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="modal-danger-icon"><Trash2 size={23} /></span><h2 id="delete-title">{confirmAction.type === 'clear' ? 'Удалить все товары?' : 'Удалить товар?'}</h2><p>{confirmAction.type === 'clear' ? `Будут безвозвратно удалены все ${products.length} карточек товаров. Сохранённые заказы останутся.` : <><b dir="auto">{confirmAction.product.name}</b> будет удалён из локальной базы.</>}</p><div><button className="secondary-button" type="button" onClick={() => setConfirmAction(null)}>Отмена</button><button className="danger-button" type="button" disabled={isSaving} onClick={() => void confirmDelete()}>{confirmAction.type === 'clear' ? 'Да, удалить все товары' : 'Да, удалить товар'}</button></div></section></div>}
      {importConflicts.length > 0 && <div className="modal-backdrop" role="presentation" onMouseDown={() => setImportConflicts([])}><section className="import-result-modal" role="dialog" aria-modal="true" aria-labelledby="conflicts-title" onMouseDown={(event) => event.stopPropagation()}><div className="import-modal-heading"><div><AlertTriangleIcon /><span><h2 id="conflicts-title">Конфликты импорта</h2><p>מק״ט, штрихкод и название блокируют строку; общий адрес только предупреждает.</p></span></div><button className="icon-button" aria-label="Закрыть" onClick={() => setImportConflicts([])}><X size={16} /></button></div><div className="import-conflict-list">{importConflicts.map((conflict, index) => <div key={`${conflict.index}-${conflict.field}-${index}`} className={conflict.blocking ? 'blocking' : 'warning'}><b>{conflict.blocking ? 'Пропущено' : 'Добавлено с предупреждением'}</b><span>Строка {conflict.index + 1} · {conflict.field}: {conflict.value}</span><small dir="auto">{conflict.incomingName} ↔ {conflict.existingName}</small></div>)}</div><button className="primary-button" type="button" onClick={() => setImportConflicts([])}>Понятно</button></section></div>}
      {researchTarget && <ProductResearchModal barcode={researchTarget.barcode} product={researchTarget} onClose={() => setResearchTarget(null)} onProductSaved={handleResearchedProduct} />}
    </div>
  )
}

function AlertTriangleIcon() {
  return <span className="modal-warning-icon">!</span>
}
