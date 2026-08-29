import {
  Barcode,
  Camera,
  CameraOff,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  History,
  ImageUp,
  Keyboard,
  MapPin,
  Package,
  RefreshCw,
  ScanBarcode,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { isProductVerified, listProducts, type Product } from '../products/storage'
import { decodeBarcodes, prepareBarcodeEngine, type DecodedBarcode } from './barcodeEngine'
import { advanceBarcodeConsensus, findProductByBarcode, normalizeBarcode, type BarcodeConsensus } from './barcodeUtils'

type ScannerState = 'idle' | 'loading' | 'scanning' | 'paused' | 'error'

type ScanEntry = {
  id: string
  barcode: string
  format: string
  scannedAt: string
  product?: Product
}

type TorchTrackCapabilities = MediaTrackCapabilities & { torch?: boolean }
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean }

const CAMERA_SCAN_INTERVAL_MS = 260

function cameraErrorMessage(reason: unknown) {
  if (!window.isSecureContext) return 'Камера доступна только по HTTPS или на localhost.'
  if (reason instanceof DOMException) {
    if (reason.name === 'NotAllowedError') return 'Доступ к камере запрещён. Разрешите его в настройках браузера и попробуйте снова.'
    if (reason.name === 'NotFoundError') return 'Камера на устройстве не найдена.'
    if (reason.name === 'NotReadableError') return 'Камера занята другим приложением. Закройте его и попробуйте снова.'
  }
  return 'Не удалось запустить камеру. Можно выбрать фотографию или ввести штрихкод вручную.'
}

function formatScanTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value))
}

export function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)
  const loopTokenRef = useRef(0)
  const scanPausedRef = useRef(false)
  const consensusRef = useRef<BarcodeConsensus | null>(null)
  const productsRef = useRef<Product[]>([])

  const [products, setProducts] = useState<Product[]>([])
  const [scannerState, setScannerState] = useState<ScannerState>('idle')
  const [statusText, setStatusText] = useState('Камера выключена')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ScanEntry | null>(null)
  const [history, setHistory] = useState<ScanEntry[]>([])
  const [manualCode, setManualCode] = useState('')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [stillImageBusy, setStillImageBusy] = useState(false)

  useEffect(() => {
    let active = true
    listProducts().then((items) => {
      if (!active) return
      productsRef.current = items
      setProducts(items)
    }).catch((reason) => {
      console.error(reason)
      if (active) setError('Не удалось прочитать локальную базу товаров.')
    })
    return () => { active = false }
  }, [])

  const stopCamera = () => {
    loopTokenRef.current += 1
    scanPausedRef.current = false
    consensusRef.current = null
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setTorchAvailable(false)
    setTorchEnabled(false)
    setScannerState('idle')
    setStatusText('Камера выключена')
  }

  useEffect(() => () => {
    loopTokenRef.current += 1
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const acceptBarcode = (decoded: Pick<DecodedBarcode, 'text' | 'format'>) => {
    const barcode = normalizeBarcode(decoded.text)
    if (!barcode) return
    const entry: ScanEntry = {
      id: crypto.randomUUID(),
      barcode,
      format: decoded.format || 'Вручную',
      scannedAt: new Date().toISOString(),
      product: findProductByBarcode(productsRef.current, barcode),
    }
    setResult(entry)
    setHistory((current) => [entry, ...current].slice(0, 20))
    setError('')
    scanPausedRef.current = true
    consensusRef.current = null
    if (streamRef.current) {
      setScannerState('paused')
      setStatusText('Код найден — проверьте товар')
    }
    navigator.vibrate?.(100)
  }

  const captureFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null

    const sourceWidth = video.videoWidth * 0.9
    const sourceHeight = video.videoHeight * 0.48
    const sourceX = (video.videoWidth - sourceWidth) / 2
    const sourceY = (video.videoHeight - sourceHeight) / 2
    const scale = Math.min(1, 1280 / sourceWidth)
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    return context.getImageData(0, 0, canvas.width, canvas.height)
  }

  const startCamera = async () => {
    stopCamera()
    setError('')
    setScannerState('loading')
    setStatusText('Загрузка локального сканера…')

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API is unavailable')
      await prepareBarcodeEngine()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('Video element is unavailable')
      video.srcObject = stream
      await video.play()

      const videoTrack = stream.getVideoTracks()[0]
      const capabilities = typeof videoTrack.getCapabilities === 'function'
        ? videoTrack.getCapabilities() as TorchTrackCapabilities
        : undefined
      setTorchAvailable(Boolean(capabilities?.torch))
      setScannerState('scanning')
      setStatusText('Наведите рамку на штрихкод')
      scanPausedRef.current = false
      const loopToken = ++loopTokenRef.current

      const scanFrame = async () => {
        if (loopToken !== loopTokenRef.current || !streamRef.current) return
        if (!scanPausedRef.current) {
          try {
            const frame = captureFrame()
            if (frame) {
              const [decoded] = await decodeBarcodes(frame)
              if (decoded) {
                const next = advanceBarcodeConsensus(
                  consensusRef.current,
                  decoded.text,
                  decoded.format,
                  performance.now(),
                )
                consensusRef.current = next.consensus
                setStatusText(next.confirmed ? 'Код подтверждён' : 'Удерживайте камеру неподвижно…')
                if (next.confirmed) acceptBarcode(decoded)
              } else {
                setStatusText('Наведите рамку на штрихкод')
              }
            }
          } catch (reason) {
            console.warn('Barcode frame was not decoded', reason)
            setStatusText('Не удалось прочитать кадр — попробуйте приблизить код')
          }
        }
        if (loopToken === loopTokenRef.current) {
          scanTimerRef.current = window.setTimeout(scanFrame, CAMERA_SCAN_INTERVAL_MS)
        }
      }
      void scanFrame()
    } catch (reason) {
      console.error(reason)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setScannerState('error')
      setStatusText('Камера недоступна')
      setError(cameraErrorMessage(reason))
    }
  }

  const scanNext = () => {
    setResult(null)
    setError('')
    consensusRef.current = null
    if (streamRef.current) {
      scanPausedRef.current = false
      setScannerState('scanning')
      setStatusText('Наведите рамку на штрихкод')
    } else {
      setScannerState('idle')
      setStatusText('Камера выключена')
    }
  }

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchEnabled
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraint] })
      setTorchEnabled(next)
    } catch (reason) {
      console.warn('Torch is unavailable', reason)
      setTorchAvailable(false)
    }
  }

  const handleStillImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setStillImageBusy(true)
    setError('')
    setStatusText('Ищу штрихкод на снимке…')
    try {
      const [decoded] = await decodeBarcodes(file)
      if (!decoded) throw new Error('Barcode not found')
      acceptBarcode(decoded)
      setStatusText('Код найден на снимке')
    } catch (reason) {
      console.warn(reason)
      setError('Штрихкод на снимке не найден. Снимите его крупнее, без бликов и под прямым углом.')
      setStatusText(streamRef.current ? 'Наведите рамку на штрихкод' : 'Код не найден')
    } finally {
      setStillImageBusy(false)
    }
  }

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault()
    const barcode = normalizeBarcode(manualCode)
    if (!barcode) {
      setError('Введите штрихкод.')
      return
    }
    acceptBarcode({ text: barcode, format: 'Вручную' })
    setManualCode('')
  }

  return (
    <div className="page scanner-page">
      <div className="page-heading scanner-heading">
        <div>
          <p className="eyebrow">ЛОКАЛЬНЫЙ СКАНЕР</p>
          <h1>Сканер штрихкодов</h1>
          <p>Наведите камеру на код — приложение найдёт товар в локальной базе. Изображение никуда не отправляется.</p>
        </div>
        <span className="scanner-engine-badge"><ShieldCheck size={17} /> zxing-wasm · на устройстве</span>
      </div>

      <div className="scanner-layout">
        <section className="scanner-camera-card">
          <div className={`scanner-preview ${scannerState}`}>
            <video ref={videoRef} muted playsInline aria-label="Изображение с камеры" />
            {scannerState === 'idle' && <div className="scanner-preview-empty"><ScanBarcode size={52} /><b>Камера выключена</b><span>Нажмите кнопку ниже, чтобы начать</span></div>}
            {scannerState === 'loading' && <div className="scanner-preview-empty"><RefreshCw className="spin" size={46} /><b>Подготовка сканера</b><span>WASM-модуль загружается локально</span></div>}
            {scannerState === 'error' && <div className="scanner-preview-empty error"><CameraOff size={48} /><b>Нет доступа к камере</b><span>Используйте снимок или ручной ввод</span></div>}
            {(scannerState === 'scanning' || scannerState === 'paused') && (
              <div className={`scanner-viewfinder ${scannerState === 'paused' ? 'confirmed' : ''}`} aria-hidden="true">
                <i /><i /><i /><i />
                {scannerState === 'scanning' && <span />}
              </div>
            )}
            <div className={`scanner-status ${scannerState}`}><span />{statusText}</div>
          </div>
          <canvas ref={canvasRef} hidden />

          {error && <div className="scanner-error" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>}

          <div className="scanner-camera-actions">
            {scannerState === 'idle' || scannerState === 'error' ? (
              <button className="primary-button" type="button" onClick={() => void startCamera()}><Camera size={19} />Включить камеру</button>
            ) : scannerState === 'paused' ? (
              <button className="primary-button" type="button" onClick={scanNext}><ScanBarcode size={19} />Сканировать следующий</button>
            ) : (
              <button className="secondary-button" type="button" onClick={stopCamera}><CameraOff size={19} />Выключить</button>
            )}
            {torchAvailable && scannerState !== 'idle' && scannerState !== 'error' && (
              <button className="secondary-button scanner-torch-button" type="button" aria-pressed={torchEnabled} onClick={() => void toggleTorch()}>
                {torchEnabled ? <FlashlightOff size={19} /> : <Flashlight size={19} />}{torchEnabled ? 'Выключить свет' : 'Подсветка'}
              </button>
            )}
            <label className="secondary-button file-picker-trigger scanner-photo-button">
              <ImageUp size={19} />{stillImageBusy ? 'Проверяю…' : 'Сканировать фото'}
              <input className="file-picker-input" type="file" accept="image/*" capture="environment" disabled={stillImageBusy} aria-label="Сфотографировать штрихкод" onChange={handleStillImage} />
            </label>
          </div>

          <form className="scanner-manual" onSubmit={handleManualSubmit}>
            <label htmlFor="manual-barcode"><Keyboard size={17} />Ручной ввод или Bluetooth-сканер</label>
            <div><input id="manual-barcode" inputMode="numeric" autoComplete="off" placeholder="7290121920100" value={manualCode} onChange={(event) => setManualCode(event.target.value)} /><button type="submit">Найти</button></div>
          </form>
          <p className="scanner-camera-note">Для камеры нужен HTTPS. Лучше держать телефон в 15–30 см от кода и избегать бликов.</p>
        </section>

        <aside className="scanner-result-column">
          <section className={`scanner-result-card ${result ? 'has-result' : ''}`}>
            {!result ? (
              <div className="scanner-result-empty"><Barcode size={34} /><b>Результат появится здесь</b><span>В базе загружено товаров: {products.length}</span></div>
            ) : (
              <>
                <header><div><small>Считан {formatScanTime(result.scannedAt)}</small><strong>{result.barcode}</strong><span>{result.format}</span></div><CheckCircle2 size={28} /></header>
                {result.product ? (
                  <div className="scanner-product-match">
                    <div className="scanner-product-image">
                      {result.product.imageDataUrl ? <img src={result.product.imageDataUrl} alt={result.product.name} /> : <Package size={34} />}
                    </div>
                    <div className="scanner-product-copy">
                      <span className={`verification-badge ${isProductVerified(result.product) ? 'verified' : 'unverified'}`}>{isProductVerified(result.product) ? 'Проверен' : 'Не проверен'}</span>
                      <h2 dir="auto">{result.product.name}</h2>
                      <p><MapPin size={18} /><span>Адрес хранения <b>{result.product.location}</b></span></p>
                      <dl><div><dt>מק״ט</dt><dd>{result.product.sku || '—'}</dd></div><div><dt>В коробке</dt><dd>{result.product.unitsPerBox || '—'}</dd></div></dl>
                    </div>
                  </div>
                ) : (
                  <div className="scanner-product-missing"><TriangleAlert size={23} /><div><b>Товар не найден в базе</b><p>Код считан, но совпадения нет. Проверьте цифры или добавьте товар вручную.</p><a href="#products">Открыть базу товаров</a></div></div>
                )}
              </>
            )}
          </section>

          <section className="scanner-history-card">
            <header><div><History size={19} /><h2>Последние сканы</h2></div>{history.length > 0 && <button type="button" onClick={() => setHistory([])} title="Очистить историю"><Trash2 size={17} /></button>}</header>
            {history.length === 0 ? <p className="scanner-history-empty">В этой сессии кодов ещё нет.</p> : (
              <ol>{history.map((entry) => <li key={entry.id}><span className={entry.product ? 'found' : 'missing'}>{entry.product ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}</span><div><b dir="auto">{entry.product?.name ?? entry.barcode}</b><small>{entry.product ? `${entry.product.location} · ${entry.barcode}` : `Нет в базе · ${entry.barcode}`}</small></div><time>{formatScanTime(entry.scannedAt)}</time></li>)}</ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
