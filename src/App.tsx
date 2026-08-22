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
import { recognizeOrderImage, validateOrderItem, type RecognizedCustomer, type RecognizedOrderItem } from './recognition/ocr'
import { OrdersDatabase } from './orders/OrdersDatabase'
import { listOrders, saveOrder } from './orders/storage'
import { ProductDatabase } from './products/ProductDatabase'
import { PalletWorkspace } from './pallet/PalletWorkspace'
import { saveOrderProducts } from './products/storage'
import { OrderWorkflow } from './fulfillment/OrderWorkflow'
import { WarehouseMap } from './warehouse/WarehouseMap'
import './App.css'

type OcrState = 'idle' | 'working' | 'success' | 'error'
type AppSection = 'new-order' | 'orders' | 'products' | 'warehouse' | 'workflow' | 'pallet'

function sectionFromHash(): AppSection {
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
  'reading customer': 'Распознавание заказчика',
  'reading order number': 'Распознавание номера заказа',
  'reading document': 'Финальная проверка документа',
}

const emptyCustomer: RecognizedCustomer = {
  name: '',
  address: '',
  city: '',
  phone: '',
  customerNumber: '',
  raw: '',
}

function App() {
  const recognitionRun = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [ocrState, setOcrState] = useState<OcrState>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Подготовка')
  const [recognizedText, setRecognizedText] = useState('')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [items, setItems] = useState<RecognizedOrderItem[]>([])
  const [orderNumber, setOrderNumber] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [customer, setCustomer] = useState<RecognizedCustomer>(emptyCustomer)
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
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const runRecognition = async (image: File) => {
    const runId = ++recognitionRun.current
    setOcrState('working')
    setProgress(0)
    setProgressLabel('Подготовка изображения')
    setRecognizedText('')
    setItems([])
    setOrderNumber('')
    setOrderNotes('')
    setCustomer(emptyCustomer)
    setTablePreviewUrl('')
    setConfidence(null)
    setPerspectiveCorrected(false)
    setError('')
    setSavedOrderId('')
    setSavedCreatedAt('')
    setSaveState('idle')
    setProductSyncMessage('')

    try {
      const result = await recognizeOrderImage(image, ({ progress: value, status }) => {
        if (runId !== recognitionRun.current) return
        setProgress(Math.max(0, Math.min(100, Math.round(value * 100))))
        setProgressLabel(statusLabels[status] ?? 'Обработка изображения')
      })
      if (runId !== recognitionRun.current) return
      setRecognizedText(result.text)
      setConfidence(result.confidence)
      setItems(result.items)
      setOrderNumber(result.orderNumber)
      setCustomer(result.customer)
      setTablePreviewUrl(result.tablePreviewUrl)
      setPerspectiveCorrected(result.usedPerspectiveCorrection)
      setProgress(100)
      setOcrState('success')
    } catch (reason) {
      if (runId !== recognitionRun.current) return
      console.error(reason)
      setError('Не удалось распознать изображение. Проверьте формат файла и попробуйте ещё раз.')
      setOcrState('error')
    }
  }

  const selectFile = (selected: File | undefined) => {
    if (!selected) return
    if (!selected.type.startsWith('image/')) {
      setError('Выберите изображение в формате JPG, PNG, HEIC или WebP.')
      setOcrState('error')
      return
    }
    if (selected.size > 20 * 1024 * 1024) {
      setError('Размер изображения превышает 20 МБ. Выберите файл меньшего размера.')
      setOcrState('error')
      return
    }

    setFile(selected)
    setPreviewUrl(URL.createObjectURL(selected))
    void runRecognition(selected)
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0])
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    selectFile(event.dataTransfer.files?.[0])
  }

  const clearOrder = () => {
    recognitionRun.current += 1
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setFile(null)
    setRecognizedText('')
    setItems([])
    setOrderNumber('')
    setOrderNotes('')
    setCustomer(emptyCustomer)
    setTablePreviewUrl('')
    setConfidence(null)
    setPerspectiveCorrected(false)
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
      return { ...updated, warnings: validateOrderItem(updated) }
    }))
  }

  const updateCustomer = (field: keyof RecognizedCustomer, value: string) => {
    setCustomer((current) => ({ ...current, [field]: value }))
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
        customer,
        items,
        rawText: recognizedText,
        sourceFileName: file?.name ?? '',
      })
      const productResult = await saveOrderProducts(items)
      setSavedOrderId(saved.id)
      setSavedCreatedAt(saved.createdAt)
      setProductSyncMessage([
        `${productResult.saved} товаров добавлено или обновлено`,
        productResult.skipped ? `${productResult.skipped} пропущено из-за пустых полей` : '',
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
          <a href="#overview"><LayoutDashboard size={19} />Обзор</a>
          <a className={activeSection === 'new-order' ? 'active' : ''} href="#new-order"><ScanLine size={19} />Новый заказ</a>
          <a className={activeSection === 'orders' || activeSection === 'workflow' ? 'active' : ''} href="#orders"><ClipboardList size={19} />Заказы{orderCount > 0 && <span className="nav-count">{orderCount}</span>}</a>
          <a className={activeSection === 'warehouse' ? 'active' : ''} href="#warehouse"><Map size={19} />Карта склада</a>
          <a className={activeSection === 'pallet' ? 'active' : ''} href="#pallet"><Cuboid size={19} />Паллета</a>
          <a className={activeSection === 'products' ? 'active' : ''} href="#products"><Boxes size={19} />Товары</a>
          <a href="#settings"><Settings size={19} />Настройки</a>
        </nav>

        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon"><ShieldCheck size={18} /></span>
            <div><strong>Работает локально</strong><span>Данные не покидают устройство</span></div>
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

        {activeSection === 'products' ? <ProductDatabase /> : activeSection === 'orders' ? <OrdersDatabase /> : activeSection === 'warehouse' ? <WarehouseMap /> : activeSection === 'pallet' ? <PalletWorkspace /> : activeSection === 'workflow' ? <OrderWorkflow /> : <div className="page">
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
                  <div className="upload-actions">
                    <label className="primary-button file-picker-trigger"><Upload size={18} />Выбрать файл<input className="file-picker-input" aria-label="Выбрать изображение заказа" type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" onChange={handleInput} /></label>
                    <label className="secondary-button file-picker-trigger"><Camera size={18} />Сделать фото<input className="file-picker-input" aria-label="Сделать фото заказа" type="file" accept="image/*" capture="environment" onChange={handleInput} /></label>
                  </div>
                  <small className="file-hint">JPG, PNG, HEIC или WebP · до 20 МБ</small>
                </div>
              ) : (
                <div className="recognition-view">
                  <div className="recognition-header">
                    <div><span className="section-kicker">ИЗОБРАЖЕНИЕ ЗАКАЗА</span><h2>{file?.name}</h2></div>
                    <button className="icon-button" type="button" onClick={clearOrder} aria-label="Удалить изображение"><Trash2 size={18} /></button>
                  </div>

                  <div className="recognition-body">
                    <div className="image-preview"><img src={previewUrl} alt="Загруженный лист заказа" /><span><FileImage size={15} />{file ? `${(file.size / 1024 / 1024).toFixed(1)} МБ` : ''}</span></div>
                    <div className="result-area">
                      {ocrState === 'working' && (
                        <div className="processing-state">
                          <div className="processing-icon"><ScanLine size={30} /></div>
                          <h3>{progressLabel}</h3>
                          <p>Иврит + английский · всё происходит на устройстве</p>
                          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                          <b>{progress}%</b>
                        </div>
                      )}

                      {ocrState === 'error' && (
                        <div className="error-state"><h3>Распознавание не завершено</h3><p>{error}</p><button className="primary-button" type="button" onClick={() => file && void runRecognition(file)}><RefreshCw size={17} />Попробовать снова</button></div>
                      )}

                      {ocrState === 'success' && (
                        <div className="text-result">
                          <div className="result-heading"><div><span className="success-badge"><Check size={14} />Распознано</span><h3>Текст заказа</h3></div><span className="confidence">Точность {confidence}%</span></div>
                          <textarea dir="auto" value={recognizedText} onChange={(event) => setRecognizedText(event.target.value)} aria-label="Распознанный текст заказа" />
                          <p>Проверьте текст и исправьте возможные ошибки перед извлечением позиций.</p>
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
                          <p>{items.length} строк найдено · {perspectiveCorrected ? 'перспектива исправлена' : 'использована область таблицы'}</p>
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

                      <section className="order-metadata" aria-label="Данные заказа и заказчика">
                        <div className="metadata-heading">
                          <div><span className="section-kicker">РЕКВИЗИТЫ</span><h4>Заказ и заказчик</h4></div>
                          <div className="metadata-status">
                            {saveState === 'error' && <span className="save-error">Не удалось сохранить</span>}
                            {saveState === 'saved' && productSyncMessage && <span className="product-sync-message">{productSyncMessage}</span>}
                          </div>
                        </div>
                        <div className="metadata-grid">
                          <label><span>Номер заказа</span><input aria-label="Номер заказа" value={orderNumber} onChange={(event) => { setOrderNumber(event.target.value.toUpperCase()); setSaveState('idle') }} /></label>
                          <label><span>Номер клиента</span><input aria-label="Номер клиента" inputMode="numeric" value={customer.customerNumber} onChange={(event) => updateCustomer('customerNumber', event.target.value)} /></label>
                          <label className="wide"><span>Название заказчика</span><input aria-label="Название заказчика" dir="rtl" value={customer.name} onChange={(event) => updateCustomer('name', event.target.value)} /></label>
                          <label><span>Адрес</span><input aria-label="Адрес заказчика" dir="rtl" value={customer.address} onChange={(event) => updateCustomer('address', event.target.value)} /></label>
                          <label><span>Город</span><input aria-label="Город заказчика" dir="rtl" value={customer.city} onChange={(event) => updateCustomer('city', event.target.value)} /></label>
                          <label><span>Телефон</span><input aria-label="Телефон заказчика" inputMode="tel" value={customer.phone} onChange={(event) => updateCustomer('phone', event.target.value)} /></label>
                          <label className="wide order-notes-field"><span>Примечание к заказу</span><textarea aria-label="Примечание к заказу" placeholder="Например: позвонить перед отгрузкой или проверить замену" value={orderNotes} maxLength={2000} onChange={(event) => { setOrderNotes(event.target.value); setSaveState('idle') }} /></label>
                          <label className="wide raw-customer"><span>Весь блок после לכבוד</span><textarea aria-label="Все данные заказчика" dir="rtl" value={customer.raw} onChange={(event) => updateCustomer('raw', event.target.value)} /></label>
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
                              <tr key={item.row} className={item.warnings.length ? 'needs-review' : ''}>
                                <td>{item.row}</td>
                                <td><input aria-label={`Адрес, строка ${item.row}`} value={item.address} onChange={(event) => updateItem(item.row, 'address', event.target.value.toUpperCase())} /></td>
                                <td><input aria-label={`מק״ט, строка ${item.row}`} inputMode="numeric" value={item.sku} onChange={(event) => updateItem(item.row, 'sku', event.target.value)} /></td>
                                <td><input className="barcode-input" aria-label={`Штрихкод, строка ${item.row}`} inputMode="numeric" value={item.barcode} onChange={(event) => updateItem(item.row, 'barcode', event.target.value)} /></td>
                                <td><input className="description-input" dir="rtl" aria-label={`Описание, строка ${item.row}`} value={item.description} onChange={(event) => updateItem(item.row, 'description', event.target.value)} /></td>
                                <td><input aria-label={`В коробке, строка ${item.row}`} inputMode="decimal" value={item.unitsPerBox} onChange={(event) => updateItem(item.row, 'unitsPerBox', event.target.value)} /></td>
                                <td><input aria-label={`Коробок, строка ${item.row}`} inputMode="decimal" value={item.boxCount} onChange={(event) => updateItem(item.row, 'boxCount', event.target.value)} /></td>
                                <td><input aria-label={`Количество, строка ${item.row}`} inputMode="decimal" value={item.quantity} onChange={(event) => updateItem(item.row, 'quantity', event.target.value)} /></td>
                                <td>{item.warnings.length ? <span className="warning-pill" title={item.warnings.join(' · ')}>{item.warnings.length}</span> : <span className="valid-pill"><Check size={13} /></span>}</td>
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
              <div className="privacy-note"><ShieldCheck size={18} /><p><b>Ваши данные защищены</b><br />Изображение обрабатывается только на этом устройстве.</p></div>
            </aside>
          </div>

          <section className="up-next">
            <div><span><MapPinned size={19} /></span><p><b>Что будет дальше?</b><br />После проверки позиций Warehouse Pilot найдёт товары на карте и рассчитает короткий маршрут. Когда для товаров будут загружены фотографии, коробки на 3D-паллете будут отображаться с этими изображениями — так будет сразу понятно, какой товар и где находится.</p></div>
            <Route size={42} />
          </section>
        </div>}
      </main>

      <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
        <a className={activeSection === 'new-order' ? 'active' : ''} href="#new-order"><ScanLine size={21} /><span>Новый</span></a>
        <a className={activeSection === 'orders' || activeSection === 'workflow' ? 'active' : ''} href="#orders"><span className="mobile-nav-icon"><ClipboardList size={21} />{orderCount > 0 && <i>{orderCount}</i>}</span><span>Заказы</span></a>
        <a className={activeSection === 'warehouse' ? 'active' : ''} href="#warehouse"><Map size={21} /><span>Карта</span></a>
        <a className={activeSection === 'pallet' ? 'active' : ''} href="#pallet"><Cuboid size={21} /><span>Паллета</span></a>
        <a className={activeSection === 'products' ? 'active' : ''} href="#products"><Boxes size={21} /><span>Товары</span></a>
      </nav>
    </div>
  )
}

export default App
