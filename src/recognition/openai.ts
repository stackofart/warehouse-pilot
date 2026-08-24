import {
  normalizeAddress,
  normalizeDigits,
  normalizeQuantity,
  normalizeSku,
  validateOrderItem,
  emptyOrderSummary,
  formatRecognizedOrderText,
  type OcrProgress,
  type OcrResult,
  type RecognizedOrderSummary,
  type RecognizedOrderItem,
} from './ocr'

type OpenAIItem = {
  address: unknown
  sku: unknown
  barcode: unknown
  description: unknown
  quantity: unknown
  unitsPerBox: unknown
  boxCount: unknown
  confidence: unknown
}

type OpenAIOrderPayload = {
  rawText?: unknown
  confidence?: unknown
  orderNumber?: unknown
  summary?: Partial<Record<keyof RecognizedOrderSummary, unknown>>
  items?: unknown
  model?: unknown
  error?: unknown
  code?: unknown
}

export class OpenAIRecognitionError extends Error {
  code: string

  constructor(message: string, code = 'openai_recognition_failed') {
    super(message)
    this.name = 'OpenAIRecognitionError'
    this.code = code
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function confidence(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : 0
}

function normalizeSummary(value: OpenAIOrderPayload['summary']): RecognizedOrderSummary {
  const empty = emptyOrderSummary()
  return Object.fromEntries(Object.keys(empty).map((key) => [key, text(value?.[key as keyof RecognizedOrderSummary])])) as unknown as RecognizedOrderSummary
}

function normalizeItem(value: OpenAIItem, index: number): RecognizedOrderItem {
  const item = {
    row: index + 1,
    address: normalizeAddress(text(value.address)),
    sku: normalizeSku(text(value.sku)),
    barcode: normalizeDigits(text(value.barcode), 8),
    description: text(value.description),
    quantity: normalizeQuantity(text(value.quantity)),
    unitsPerBox: normalizeQuantity(text(value.unitsPerBox)),
    boxCount: normalizeQuantity(text(value.boxCount)),
    confidence: confidence(value.confidence),
  }
  return { ...item, warnings: validateOrderItem(item) }
}

export function normalizeOpenAIOrder(payload: OpenAIOrderPayload): OcrResult {
  if (!Array.isArray(payload.items)) {
    throw new OpenAIRecognitionError('OpenAI вернул результат без списка товаров.', 'items_missing')
  }

  const items = payload.items.map((item, index) => normalizeItem((item ?? {}) as OpenAIItem, index))
  if (!items.length) {
    throw new OpenAIRecognitionError('На изображении не удалось найти строки заказа.', 'items_empty')
  }

  const orderNumber = text(payload.orderNumber).toUpperCase().replace(/\s+/g, '')
  const summary = normalizeSummary(payload.summary)
  return {
    text: formatRecognizedOrderText(orderNumber, items, summary),
    confidence: confidence(payload.confidence),
    orderNumber,
    summary,
    items,
    validRowCount: items.filter((item) => item.warnings.length === 0).length,
    tablePreviewUrl: '',
    detectedRows: items.length,
    usedPerspectiveCorrection: false,
    provider: 'openai',
    model: text(payload.model),
  }
}

async function convertUnsupportedImage(image: File) {
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  if (supportedTypes.has(image.type)) return image

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  } catch {
    throw new OpenAIRecognitionError('Этот формат изображения не удалось подготовить. Сделайте фото камерой или выберите JPG/PNG.', 'unsupported_image')
  }

  const maxSide = 4096
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new OpenAIRecognitionError('Браузер не смог подготовить изображение.', 'image_conversion_failed')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) throw new OpenAIRecognitionError('Браузер не смог преобразовать изображение в JPG.', 'image_conversion_failed')
  return new File([blob], `${image.name.replace(/\.[^.]+$/, '') || 'order'}.jpg`, { type: 'image/jpeg' })
}

export async function recognizeOrderImageWithOpenAI(
  images: File[],
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  if (!images.length || images.length > 2) {
    throw new OpenAIRecognitionError('Выберите одно или два изображения заказа.', 'invalid_image_count')
  }
  onProgress({ progress: .05, status: 'preparing AI image' })
  const preparedImages = await Promise.all(images.map(convertUnsupportedImage))
  const formData = new FormData()
  for (const preparedImage of preparedImages) formData.append('images', preparedImage, preparedImage.name)

  onProgress({ progress: .2, status: 'uploading image' })
  const responsePromise = fetch(`${import.meta.env.BASE_URL}api/recognize-order`, {
    method: 'POST',
    body: formData,
    headers: { accept: 'application/json' },
  })
  onProgress({ progress: .38, status: 'analyzing with OpenAI' })
  const response = await responsePromise
  onProgress({ progress: .88, status: 'validating AI result' })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new OpenAIRecognitionError(
      response.ok
        ? 'Сервер распознавания вернул некорректный ответ.'
        : 'Сервис распознавания недоступен. Проверьте публикацию Cloudflare.',
      'invalid_server_response',
    )
  }

  const payload = await response.json() as OpenAIOrderPayload
  if (!response.ok) {
    throw new OpenAIRecognitionError(text(payload.error) || 'Не удалось распознать изображение через OpenAI.', text(payload.code))
  }

  onProgress({ progress: .96, status: 'validating AI result' })
  return normalizeOpenAIOrder(payload)
}
