import {
  Boxes,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Cuboid,
  FileImage,
  FileSearch,
  HelpCircle,
  LayoutDashboard,
  Map,
  MapPinned,
  PackageOpen,
  RefreshCw,
  Route,
  Save,
  ScanBarcode,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  Warehouse,
} from 'lucide-react'
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react'
import { emptyOrderSummary, formatRecognizedOrderText, recognizeOrderImage, validateOrderItem, type RecognizedOrderItem, type RecognizedOrderSummary } from './recognition/ocr'
import { OpenAIRecognitionError, recognizeOrderImageWithOpenAI } from './recognition/openai'
import { mergeOcrResults } from './recognition/merge'
import { OrdersDatabase } from './orders/OrdersDatabase'
import { listOrders, saveOrder } from './orders/storage'
import { ProductDatabase } from './products/ProductDatabase'
import { PalletWorkspace } from './pallet/PalletWorkspace'
import { listProducts, saveOrderProducts } from './products/storage'
import { reconcileRecognizedItems } from './products/reconciliation'
import { OrderWorkflow } from './fulfillment/OrderWorkflow'
import { WarehouseMap } from './warehouse/WarehouseMap'
import { OverviewDashboard } from './overview/OverviewDashboard'
import { BarcodeScanner } from './scanner/BarcodeScanner'
import './App.css'

type OcrState = 'idle' | 'ready' | 'working' | 'success' | 'error'
type RecognitionMode = 'openai' | 'local'
type AppSection = 'overview' | 'new-order' | 'scanner' | 'orders' | 'products' | 'warehouse' | 'workflow' | 'pallet'

function sectionFromHash(): AppSection {
  if (window.location.hash === '#overview') return 'overview'
  if (window.location.hash === '#scanner') return 'scanner'
  if (window.location.hash === '#products') return 'products'
  if (window.location.hash === '#orders') return 'orders'
  if (window.location.hash === '#warehouse') return 'warehouse'
  if (window.location.hash === '#pallet' || window.location.hash.startsWith('#pallet/')) return 'pallet'
  if (window.location.hash.startsWith('#work/')) return 'workflow'
  if (window.location.hash.startsWith('#route/')) return 'workflow'
  return 'new-order'
}

const statusLabels: Record<string, string> = {
  'loading tesseract core': 'Загрузка OCR-движка',
  'initializing tesseract': 'Запуск OCR-движка',
  'loading language traineddata': 'Загрузка языковой модели',
  'initializing api': 'Подготовка распознавания',
  'recognizing text': 'Распознавание текста',
  'detecting table': 'Поиск границ таблицы',
  'building columns': 'Разделение строк и колонок',
  'loading OCR': 'Загрузка OCR-движка',
  'reading addresses': 'Распознавание адресов хранения',
  'reading sku': 'Распознавание מק״ט',
  'reading barcodes': 'Проверка штрихкодов',
  'reading quantities': 'Распознавание количества',
  'reading packaging': 'Распознавание упаковок',
  'reading descriptions': 'Распознавание товаров',
  'verifying barcodes': 'Повторная проверка штрихкодов',
  'verifying descriptions': 'Повторная проверка описаний',
  'reading order number': 'Распознавание номера заказа',
  'reading document': 'Финальная проверка документа',
  'preparing AI image': 'Подготовка изображения для OpenAI',
  'uploading image': 'Защищённая отправка изображения',
  'analyzing with OpenAI': 'OpenAI читает заказ',
  'validating AI result': 'Проверка распознанных данных',
}

function App() {
  const recognitionRun = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [ocrState, setOcrState] = useState<OcrState>('idle')
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>('openai')
  const [recognitionProvider, setRecognitionProvider] = useState<RecognitionMode>('openai')
  const [recognitionModel, setRecognitionModel] = useState('')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Подготовка')
  const [recognizedText, setRecognizedText] = useState('')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [items, setItems] = useState<RecognizedOrderItem[]>([])
  const [orderNumber, setOrderNumber] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [orderSummary, setOrderSummary] = useState<RecognizedOrderSummary>(emptyOrderSummary)
  const [tablePreviewUrl, setTablePreviewUrl] = useState('')
  const [perspectiveCorrected, setPerspectiveCorrected] = useState(false)
  const [error, setError] = useState('')
  const [savedOrderId, setSavedOrderId] = useState('')
  const [savedCreatedAt, setSavedCreatedAt] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [productSyncMessage, setProductSyncMessage] = useState('')
  const [orderCount, setOrderCount] = useState(0)
  const [activeSection, setActiveSection] = useState<AppSection>(sectionFromHash)

  useEffect(() => {
    const updateSection = () => setActiveSection(sectionFromHash())
    window.addEventListener('hashchange', updateSection)
    return () => window.removeEventListener('hashchange', updateSection)
  }, [])

  useEffect(() => {
    listOrders().then((orders) => setOrderCount(orders.length)).catch(console.error)
  }, [saveState])

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [previewUrls])

  const runRecognition = async (images: File[], mode: RecognitionMode = recognitionMode) => {
    if (!images.length) return
    const runId = ++recognitionRun.current
    setRecognitionProvider(mode)
    setRecognitionModel('')
    setOcrState('working')
    setProgress(0)
    setProgressLabel('Подготовка изображения')
    setRecognizedText('')
    setItems([])
    setOrderNumber('')
    setOrderNotes('')
    setOrderSummary(emptyOrderSummary())
    setTablePreviewUrl('')
    setConfidence(null)
    setPerspectiveCorrected(false)
    setError('')
    setSavedOrderId('')
    setSavedCreatedAt('')
    setSaveState('idle')
    setProductSyncMessage('')

    try {
      let result
      if (mode === 'openai') {
        result = await recognizeOrderImageWithOpenAI(images, ({ progress: value, status }) => {
            if (runId !== recognitionRun.current) return
            setProgress(Math.max(0, Math.min(100, Math.round(value * 100))))
            setProgressLabel(statusLabels[status] ?? 'Обработка изображений')
          })
      } else {
        const localResults = []
        for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
          localResults.push(await recognizeOrderImage(images[imageIndex], ({ progress: value, status }) => {
            if (runId !== recognitionRun.current) return
            const combined = (imageIndex + value) / images.length
            setProgress(Math.max(0, Math.min(100, Math.round(combined * 100))))
            setProgressLabel(`${statusLabels[status] ?? 'Обработка изображения'} · фото ${imageIndex + 1}/${images.length}`)
          }))
        }
        result = mergeOcrResults(localResults)
      }
      if (runId !== recognitionRun.current) return
      const reconciliation = reconcileRecognizedItems(result.items, await listProducts())
      setRecognizedText(formatRecognizedOrderText(result.orderNumber, reconciliation.items, result.summary))
      setConfidence(result.confidence)
      setItems(reconciliation.items)
      setOrderNumber(result.orderNumber)
      setOrderSummary(result.summary)
      setTablePreviewUrl(result.tablePreviewUrl)
      setPerspectiveCorrected(result.usedPerspectiveCorrection)
      setRecognitionProvider(result.provider === 'openai' ? 'openai' : 'local')
      setRecognitionModel(result.model ?? '')
      setProductSyncMessage(`${reconciliation.matched} строк сопоставлено с базой · ${reconciliation.corrected} исправлено · ${reconciliation.unverified} требуют проверки`)
      setProgress(100)
      setOcrState('success')
    } catch (reason) {
      if (runId !== recognitionRun.current) return
      console.error(reason)
      setError(reason instanceof OpenAIRecognitionError
        ? reason.message
        : 'Не удалось распознать изображение. Проверьте формат файла и попробуйте ещё раз.')
      setOcrState('error')
    }
  }

  const selectFiles = (selected: File[], append = false) => {
    if (!selected.length) return
    const nextFiles = (append ? [...files, ...selected] : selected).slice(0, 2)
    if (nextFiles.some((file) => !file.type.startsWith('image/'))) {
      setError('Выберите изображение в формате JPG, PNG, HEIC или WebP.')
      setOcrState('error')
      return
    }
    if (nextFiles.some((file) => file.size > 20 * 1024 * 1024)) {
      setError('Размер одного из изображений превышает 20 МБ. Выберите файл меньшего размера.')
      setOcrState('error')
      return
    }

    setFiles(nextFiles)
    setPreviewUrls(nextFiles.map((file) => URL.createObjectURL(file)))
    setError(selected.length + (append ? files.length : 0) > 2 ? 'Можно обработать не более двух фотографий. Выбраны первые две.' : '')
    setOcrState('ready')
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleAdditionalInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectFiles(Array.from(event.target.files ?? []), true)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    selectFiles(Array.from(event.dataTransfer.files ?? []))
  }

  const clearOrder = () => {
    recognitionRun.current += 1
    previewUrls.forEach((url) => URL.revokeObjectURL(url))
    setPreviewUrls([])
    setFiles([])
    setRecognizedText('')
    setItems([])
    setOrderNumber('')
    setOrderNotes('')
    setOrderSummary(emptyOrderSummary())
    setTablePreviewUrl('')
    setConfidence(null)
    setPerspectiveCorrected(false)
    setRecognitionModel('')
    setProgress(0)
    setError('')
    setSavedOrderId('')
    setSavedCreatedAt('')
    setSaveState('idle')
    setProductSyncMessage('')
    setOcrState('idle')
  }

  const updateItem = (row: number, field: keyof Pick<RecognizedOrderItem, 'address' | 'sku' | 'barcode' | 'description' | 'quantity' | 'unitsPerBox' | 'boxCount'>, value: string) => {
    setSaveState('idle')
    setItems((current) => current.map((item) => {
      if (item.row !== row) return item
      const updated = { ...item, [field]: value }
      const changesProductIdentity = ['address', 'sku', 'barcode', 'description', 'unitsPerBox'].includes(field)
      return {
        ...updated,
        warnings: validateOrderItem(updated),
        ...(changesProductIdentity ? {
          productVerification: 'unverified' as const,
          catalogProductId: undefined,
          catalogMatchReason: 'none' as const,
          catalogCorrectedFields: [],
        } : {}),
      }
    }))
  }

  const updateSummary = (field: keyof RecognizedOrderSummary, value: string) => {
    setOrderSummary((current) => ({ ...current, [field]: value.replace(/[^\d.,]/g, '').replace(',', '.') }))
    setSaveState('idle')
  }

  const saveCurrentOrder = async () => {
    setSaveState('saving')
    try {
      const id = savedOrderId || crypto.randomUUID()
      const saved = await saveOrder({
        id,
        createdAt: savedCreatedAt || undefined,
        orderNumber,
        notes: orderNotes.trim(),
        summary: orderSummary,
        items,
        rawText: recognizedText,
        sourceFileName: files[0]?.name ?? '',
        sourceFileNames: files.map((file) => file.name),
      })
      const productResult = await saveOrderProducts(items, { overwriteExisting: false, newProductVerification: 'unverified', source: 'recognition' })
      setSavedOrderId(saved.id)
      setSavedCreatedAt(saved.createdAt)
      setProductSyncMessage([
        `${productResult.saved} новых товаров добавлено как непроверенные`,
        productResult.matchedExisting ? `${productResult.matchedExisting} уже связаны с базой` : '',
        productResult.incomplete ? `${productResult.incomplete} не добавлено из-за пустых полей` : '',
        productResult.conflicts ? `${productResult.conflicts} конфликтов` : '',
      ].filter(Boolean).join(' · '))
      setSaveState('saved')
    } catch (reason) {
      console.error(reason)
      setSaveState('error')
    }
  }

  const validRows = items.filter((item) => item.warnings.length === 0).length

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Warehouse size={22} strokeWidth={2.2} /></div>
          <div>
            <strong>Warehouse Pilot</strong>
            <span>Комплектация без лишних шагов</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Основная навигация">
          <a className={activeSection === 'overview' ? 'active' : ''} href="#overview"><LayoutDashboard size={19} />Обзор</a>
          <a className={activeSection === 'new-order' ? 'active' : ''} href="#new-order"><ScanLine size={19} />Новый заказ</a>
          <a className={activeSection === 'scanner' ? 'active' : ''} href="#scanner"><ScanBarcode size={19} />Сканер</a>
          <a className={activeSection === 'orders' || activeSection === 'workflow' ? 'active' : ''} href="#orders"><ClipboardList size={19} />Заказы{orderCount > 0 && <span className="nav-count">{orderCount}</span>}</a>
          <a className={activeSection === 'warehouse' ? 'active' : ''} href="#warehouse"><Map size={19} />Карта склада</a>
          <a className={activeSection === 'pallet' ? 'active' : ''} href="#pallet"><Cuboid size={19} />Паллета</a>
          <a className={activeSection === 'products' ? 'active' : ''} href="#products"><Boxes size={19} />Товары</a>
          <a href="#settings"><Settings size={19} />Настройки</a>
        </nav>

        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon"><ShieldCheck size={18} /></span>
            <div><strong>Локальная база</strong><span>Заказы и товары остаются на устройстве</span></div>
          </div>
          <a href="#help" className="help-link"><HelpCircle size={18} />Помощь и поддержка</a>
          <div className="profile">
            <span className="avatar">АМ</span>
            <div><strong>Алексей Морозов</strong><span>Сборщик</span></div>
            <ChevronDown size={17} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><Warehouse size={20} /></div><strong>Warehouse Pilot</strong></div>
          <div className="shift-status"><span /> Смена активна <b>08:42</b></div>
        </header>

        {activeSection === 'overview' ? <OverviewDashboard /> : activeSection === 'scanner' ? <BarcodeScanner /> : activeSection === 'products' ? <ProductDatabase /> : activeSection === 'orders' ? <OrdersDatabase /> : activeSection === 'warehouse' ? <WarehouseMap /> : activeSection === 'pallet' ? <PalletWorkspace /> : activeSection === 'workflow' ? <OrderWorkflow /> : <div className="page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">НОВЫЙ ЗАКАЗ</p>
              <h1>Загрузите лист заказа</h1>
              <p>Сфотографируйте или выберите изображение — мы распознаем позиции и подготовим маршрут.</p>
            </div>
            <div className="order-draft"><span>{saveState === 'saved' ? 'Сохранён локально' : 'Черновик'}</span><strong>{orderNumber || 'Новый заказ'}</strong></div>
          </div>

          <div className="stepper" aria-label="Этапы обработки заказа">
            <div className="step current"><span>1</span><div><b>Загрузка</b><small>Фото или файл</small></div></div>
            <i />
            <div className={ocrState === 'success' ? 'step current' : 'step'}><span>2</span><div><b>Проверка</b><small>Распознанные позиции</small></div></div>
            <i />
            <div className="step"><span>3</span><div><b>Маршрут</b><small>Оптимальный порядок</small></div></div>
          </div>

          <div className="workspace-grid">
            <section className="upload-panel">
              {ocrState === 'idle' ? (
                <div
                  className={`dropzone ${isDragging ? 'dragging' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <div className="scan-illustration">
                    <div className="paper"><span /><span /><span /><span /><ScanLine className="scan-line" size={116} /></div>
                    <Sparkles className="sparkle sparkle-one" size={17} />
                    <Sparkles className="sparkle sparkle-two" size={12} />
                  </div>
                  <h2>Перетащите изображение сюда</h2>
                  <p>или выберите удобный способ загрузки</p>
                  <div className="recognition-mode-selector" role="radiogroup" aria-label="Способ распознавания">
                    <button className={recognitionMode === 'openai' ? 'active' : ''} type="button" role="radio" aria-checked={recognitionMode === 'openai'} onClick={() => setRecognitionMode('openai')}>
                      <Sparkles size={18} /><span><b>Через OpenAI</b><small>Точнее · нужен интернет</small></span>
                    </button>
                    <button className={recognitionMode === 'local' ? 'active' : ''} type="button" role="radio" aria-checked={recognitionMode === 'local'} onClick={() => setRecognitionMode('local')}>
                      <ShieldCheck size={18} /><span><b>На устройстве</b><small>Без отправки фото</small></span>
                    </button>
                  </div>
                  <div className="upload-actions">
                    <label className="primary-button file-picker-trigger"><Upload size={18} />Выбрать 1–2 фото<input className="file-picker-input" aria-label="Выбрать изображения заказа" type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,image/webp" onChange={handleInput} /></label>
                    <label className="secondary-button file-picker-trigger"><Camera size={18} />Сделать фото<input className="file-picker-input" aria-label="Сделать фото заказа" type="file" accept="image/*" capture="environment" onChange={handleInput} /></label>
                  </div>
                  <small className="file-hint">До двух фото · JPG, PNG, HEIC или WebP · каждое до 20 МБ</small>
                </div>
              ) : (
                <div className="recognition-view">
                  <div className="recognition-header">
                    <div><span className="section-kicker">ИЗОБРАЖЕНИЯ ЗАКАЗА</span><h2>{files.length} из 2 фото выбрано</h2></div>
                    <button className="icon-button" type="button" onClick={clearOrder} aria-label="Удалить изображение"><Trash2 size={18} /></button>
                  </div>

                  <div className="recognition-body">
                    <div className={`image-preview-grid ${files.length > 1 ? 'two-images' : ''}`}>
                      {files.map((image, index) => <div className="image-preview" key={`${image.name}-${image.lastModified}`}><img src={previewUrls[index]} alt={`Лист заказа, фото ${index + 1}`} /><span><FileImage size={15} />Фото {index + 1} · {(image.size / 1024 / 1024).toFixed(1)} МБ</span></div>)}
                    </div>
                    <div className="result-area">
                      {ocrState === 'ready' && (
                        <div className="ready-state">
                          <div className="processing-icon"><FileImage size={30} /></div>
                          <h3>{files.length === 2 ? 'Оба фото готовы' : 'Фото готово к распознаванию'}</h3>
                          <p>{files.length === 1 ? 'Если заказ продолжается ниже, добавьте второе фото.' : 'Строки с двух фото будут объединены в один заказ.'}</p>
                          {error && <span className="selection-warning">{error}</span>}
                          <div className="ready-actions">
                            <button className="primary-button" type="button" onClick={() => void runRecognition(files)}><Sparkles size={17} />Распознать {files.length === 2 ? '2 фото' : 'фото'}</button>
                            {files.length < 2 && <label className="secondary-button file-picker-trigger"><Camera size={17} />Добавить второе фото<input className="file-picker-input" aria-label="Добавить второе фото заказа" type="file" accept="image/*" capture="environment" onChange={handleAdditionalInput} /></label>}
                          </div>
                        </div>
                      )}
                      {ocrState === 'working' && (
                        <div className="processing-state">
                          <div className="processing-icon"><ScanLine size={30} /></div>
                          <h3>{progressLabel}</h3>
                          <p>{recognitionProvider === 'openai'
                            ? 'Иврит + английский · изображение обрабатывается через защищённый API'
                            : 'Иврит + английский · всё происходит на устройстве'}</p>
                          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                          <b>{progress}%</b>
                        </div>
                      )}

                      {ocrState === 'error' && (
                        <div className="error-state"><h3>Распознавание не завершено</h3><p>{error}</p><div className="recognition-retry-actions"><button className="primary-button" type="button" onClick={() => void runRecognition(files, recognitionProvider)}><RefreshCw size={17} />Попробовать снова</button>{recognitionProvider === 'openai' && <button className="secondary-button" type="button" onClick={() => void runRecognition(files, 'local')}><ShieldCheck size={17} />Распознать локально</button>}</div></div>
                      )}

                      {ocrState === 'success' && (
                        <div className="text-result">
                          <div className="result-heading"><div><span className="success-badge"><Check size={14} />{recognitionProvider === 'openai' ? 'OpenAI' : 'Локально'}</span><h3>Текст заказа</h3></div><span className="confidence">Точность {confidence}%</span></div>
                          <textarea dir="auto" value={recognizedText} onChange={(event) => setRecognizedText(event.target.value)} aria-label="Распознанный текст заказа" />
                          <p>Проверьте текст и позиции перед сохранением.{recognitionModel ? ` Модель: ${recognitionModel}.` : ''}</p>
                          <button className="primary-button continue-button" type="button"><PackageOpen size={18} />Перейти к позициям</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {ocrState === 'success' && items.length > 0 && (
                    <section className="structured-result">
                      <div className="structured-heading">
                        <div>
                          <span className="section-kicker">СТРУКТУРИРОВАННЫЙ ЗАКАЗ</span>
                          <h3><Table2 size={18} />Проверка позиций</h3>
                          <p>{items.length} строк найдено · {recognitionProvider === 'openai' ? 'структура извлечена OpenAI' : perspectiveCorrected ? 'перспектива исправлена' : 'использована область таблицы'}</p>
                        </div>
                        <div className="structured-actions">
                          <div className={`quality-score ${validRows === items.length ? 'complete' : ''}`}>
                            {validRows === items.length ? <CheckCircle2 size={19} /> : <FileSearch size={19} />}
                            <div><strong>{validRows}/{items.length}</strong><span>строк без замечаний</span></div>
                          </div>
                          <button className="primary-button save-button" type="button" disabled={saveState === 'saving'} onClick={() => void saveCurrentOrder()}>
                            <Save size={16} />{saveState === 'saving' ? 'Сохранение…' : saveState === 'saved' ? 'Сохранено' : 'Сохранить заказ'}
                          </button>
                          {saveState === 'saved' && savedOrderId && <a className="secondary-button route-order-link" href={`#work/${encodeURIComponent(savedOrderId)}`}><ClipboardList size={16} />Открыть заказ</a>}
                        </div>
                      </div>

                      <section className="order-metadata" aria-label="Данные заказа">
                        <div className="metadata-heading">
                          <div><span className="section-kicker">РЕКВИЗИТЫ</span><h4>Номер и итоги заказа</h4></div>
                          <div className="metadata-status">
                            {saveState === 'error' && <span className="save-error">Не удалось сохранить</span>}
                            {saveState === 'saved' && productSyncMessage && <span className="product-sync-message">{productSyncMessage}</span>}
                          </div>
                        </div>
                        <div className="metadata-grid">
                          <label><span>Номер заказа</span><input aria-label="Номер заказа" value={orderNumber} onChange={(event) => { setOrderNumber(event.target.value.toUpperCase()); setSaveState('idle') }} /></label>
                          <label><span>Позиций по документу</span><input aria-label="Количество позиций по документу" inputMode="decimal" value={orderSummary.itemCount} onChange={(event) => updateSummary('itemCount', event.target.value)} /></label>
                          <label><span>Общее количество</span><input aria-label="Общее количество товара" inputMode="decimal" value={orderSummary.totalQuantity} onChange={(event) => updateSummary('totalQuantity', event.target.value)} /></label>
                          <label><span>Всего упаковок</span><input aria-label="Общее количество упаковок" inputMode="decimal" value={orderSummary.packageCount} onChange={(event) => updateSummary('packageCount', event.target.value)} /></label>
                          <label><span>Суммарный вес, кг</span><input aria-label="Суммарный вес заказа" inputMode="decimal" value={orderSummary.totalWeightKg} onChange={(event) => updateSummary('totalWeightKg', event.target.value)} /></label>
                          <label className="wide order-notes-field"><span>Примечание к заказу</span><textarea aria-label="Примечание к заказу" placeholder="Например: позвонить перед отгрузкой или проверить замену" value={orderNotes} maxLength={2000} onChange={(event) => { setOrderNotes(event.target.value); setSaveState('idle') }} /></label>
                        </div>
                      </section>

                      {tablePreviewUrl && (
                        <details className="table-preview">
                          <summary>Показать выровненную таблицу</summary>
                          <img src={tablePreviewUrl} alt="Таблица после коррекции перспективы" />
                        </details>
                      )}

                      <div className="items-table-wrap">
                        <table className="items-table">
                          <thead><tr><th>#</th><th>Адрес</th><th>מק״ט</th><th>Штрихкод</th><th>Описание</th><th>В коробке</th><th>Коробок</th><th>Всего</th><th>Статус</th></tr></thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={item.row} className={item.warnings.length || item.productVerification === 'unverified' ? 'needs-review' : ''}>
                                <td>{item.row}</td>
                                <td><input aria-label={`Адрес, строка ${item.row}`} value={item.address} onChange={(event) => updateItem(item.row, 'address', event.target.value.toUpperCase())} /></td>
                                <td><input aria-label={`מק״ט, строка ${item.row}`} inputMode="numeric" value={item.sku} onChange={(event) => updateItem(item.row, 'sku', event.target.value)} /></td>
                                <td><input className="barcode-input" aria-label={`Штрихкод, строка ${item.row}`} inputMode="numeric" value={item.barcode} onChange={(event) => updateItem(item.row, 'barcode', event.target.value)} /></td>
                                <td><input className="description-input" dir="rtl" aria-label={`Описание, строка ${item.row}`} value={item.description} onChange={(event) => updateItem(item.row, 'description', event.target.value)} /></td>
                                <td><input aria-label={`В коробке, строка ${item.row}`} inputMode="decimal" value={item.unitsPerBox} onChange={(event) => updateItem(item.row, 'unitsPerBox', event.target.value)} /></td>
                                <td><input aria-label={`Коробок, строка ${item.row}`} inputMode="decimal" value={item.boxCount} onChange={(event) => updateItem(item.row, 'boxCount', event.target.value)} /></td>
                                <td><input aria-label={`Количество, строка ${item.row}`} inputMode="decimal" value={item.quantity} onChange={(event) => updateItem(item.row, 'quantity', event.target.value)} /></td>
                                <td className="item-status-cell">
                                  <span className={`verification-pill ${item.productVerification === 'verified' ? 'verified' : 'unverified'}`} title={item.catalogCorrectedFields?.length ? `Исправлено по БД: ${item.catalogCorrectedFields.join(', ')}` : ''}>{item.productVerification === 'verified' ? 'Проверен' : 'Не проверен'}</span>
                                  {item.warnings.length ? <span className="warning-pill" title={item.warnings.join(' · ')}>{item.warnings.length}</span> : <span className="valid-pill"><Check size={13} /></span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="validation-note">Строки подсвечиваются, если адрес, упаковки, количество или контрольная цифра штрихкода требуют проверки.</p>
                    </section>
                  )}
                </div>
              )}

            </section>

            <aside className="tips-panel">
              <div className="tips-icon"><Camera size={22} /></div>
              <h3>Как получить точный результат</h3>
              <ul>
                <li><span>01</span><div><b>Снимайте сверху</b><p>Держите камеру параллельно листу.</p></div></li>
                <li><span>02</span><div><b>Добавьте света</b><p>Избегайте теней и бликов на бумаге.</p></div></li>
                <li><span>03</span><div><b>Покажите весь лист</b><p>Все края должны попадать в кадр.</p></div></li>
              </ul>
              <div className="privacy-note"><ShieldCheck size={18} /><p><b>Ваши данные защищены</b><br />{recognitionMode === 'openai' ? 'В OpenAI отправляются только выбранные фото; база товаров остаётся на устройстве.' : 'Изображения обрабатываются только на этом устройстве.'}</p></div>
            </aside>
          </div>

          <section className="up-next">
            <div><span><MapPinned size={19} /></span><p><b>Что будет дальше?</b><br />После проверки позиций Warehouse Pilot найдёт товары на карте и рассчитает короткий маршрут. Когда для товаров будут загружены фотографии, коробки на 3D-паллете будут отображаться с этими изображениями — так будет сразу понятно, какой товар и где находится.</p></div>
            <Route size={42} />
          </section>
        </div>}
      </main>

      <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
        <a className={activeSection === 'overview' ? 'active' : ''} href="#overview"><LayoutDashboard size={21} /><span>Обзор</span></a>
        <a className={activeSection === 'new-order' ? 'active' : ''} href="#new-order"><ScanLine size={21} /><span>Новый</span></a>
        <a className={`scanner-nav-link ${activeSection === 'scanner' ? 'active' : ''}`} href="#scanner"><ScanBarcode size={21} /><span>Сканер</span></a>
        <a className={activeSection === 'orders' || activeSection === 'workflow' ? 'active' : ''} href="#orders"><span className="mobile-nav-icon"><ClipboardList size={21} />{orderCount > 0 && <i>{orderCount}</i>}</span><span>Заказы</span></a>
        <a className={activeSection === 'warehouse' ? 'active' : ''} href="#warehouse"><Map size={21} /><span>Карта</span></a>
        <a className={activeSection === 'pallet' ? 'active' : ''} href="#pallet"><Cuboid size={21} /><span>Паллета</span></a>
        <a className={activeSection === 'products' ? 'active' : ''} href="#products"><Boxes size={21} /><span>Товары</span></a>
      </nav>
    </div>
  )
}

export default App
