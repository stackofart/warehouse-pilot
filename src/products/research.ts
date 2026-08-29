import type { Product, PhysicalSpec } from './storage'
import type { ProductResearchResult, ResearchConfidence, ResearchValue, ResearchValueType } from './researchTypes'

const RESEARCH_CACHE_PREFIX = 'warehouse-pilot.product-research.'
const RESEARCH_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type ResearchFieldKey =
  | 'name'
  | 'brand'
  | 'description'
  | 'netContent'
  | 'caseBarcode'
  | 'unitsPerBox'
  | 'item.lengthCm'
  | 'item.widthCm'
  | 'item.heightCm'
  | 'item.weightKg'
  | 'box.lengthCm'
  | 'box.widthCm'
  | 'box.heightCm'
  | 'box.weightKg'

export type ResearchComparisonField = {
  key: ResearchFieldKey
  label: string
  currentValue: string
  proposedValue: string
  hasProposal: boolean
  confidence: ResearchConfidence
  valueType: ResearchValueType
  sourceUrls: string[]
  note: string
}

export class ProductResearchError extends Error {
  code: string

  constructor(message: string, code = 'product_research_failed') {
    super(message)
    this.name = 'ProductResearchError'
    this.code = code
  }
}

function normalizeBarcode(value: string) {
  return value.replace(/\D/g, '')
}

function knownProductPayload(product?: Product) {
  if (!product) return null
  return {
    name: product.name,
    brand: product.brand ?? '',
    description: product.description ?? '',
    netContent: product.netContent ?? '',
    unitsPerBox: product.unitsPerBox ?? null,
    caseBarcode: product.caseBarcode ?? '',
    itemSpec: product.itemSpec ?? {},
    boxSpec: product.boxSpec ?? {},
  }
}

function looksLikeResearchResult(value: unknown): value is ProductResearchResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProductResearchResult>
  return typeof candidate.barcode === 'string'
    && typeof candidate.identityConfidence === 'number'
    && Boolean(candidate.name && candidate.unit && candidate.casePack)
    && Array.isArray(candidate.sources)
    && typeof candidate.model === 'string'
    && typeof candidate.researchedAt === 'string'
}

export async function researchProductOnline(barcodeValue: string, product?: Product) {
  const barcode = normalizeBarcode(barcodeValue)
  if (!/^\d{8,14}$/.test(barcode)) {
    throw new ProductResearchError('Нужен штрихкод GTIN из 8–14 цифр.', 'invalid_barcode')
  }

  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api/research-product`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ barcode, knownProduct: knownProductPayload(product) }),
    })
  } catch {
    throw new ProductResearchError('Не удалось подключиться к сервису поиска. Проверьте интернет.', 'research_unreachable')
  }

  const responseType = response.headers.get('content-type') ?? ''
  const payload = responseType.includes('application/json')
    ? await response.json().catch(() => null) as (Partial<ProductResearchResult> & { error?: string; code?: string }) | null
    : null
  if (!response.ok) {
    if (response.status === 404 && import.meta.env.DEV) {
      throw new ProductResearchError(
        'Локальный Cloudflare Worker не запущен. Перезапустите приложение командой npm run dev и добавьте OPENAI_API_KEY в файл .dev.vars.',
        'local_worker_not_running',
      )
    }
    throw new ProductResearchError(payload?.error || 'Сервис поиска вернул ошибку.', payload?.code || 'research_error')
  }
  if (!looksLikeResearchResult(payload)) {
    throw new ProductResearchError('Получен неполный результат поиска.', 'invalid_research_response')
  }
  saveCachedProductResearch(payload)
  return payload
}

export function getCachedProductResearch(barcodeValue: string) {
  if (typeof localStorage === 'undefined') return null
  const barcode = normalizeBarcode(barcodeValue)
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${RESEARCH_CACHE_PREFIX}${barcode}`) ?? 'null')
    if (!looksLikeResearchResult(parsed)) return null
    if (Date.now() - Date.parse(parsed.researchedAt) > RESEARCH_CACHE_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCachedProductResearch(result: ProductResearchResult) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`${RESEARCH_CACHE_PREFIX}${normalizeBarcode(result.barcode)}`, JSON.stringify(result))
  } catch {
    // The product record remains the durable source when browser storage is full.
  }
}

function displayNumber(value: number | undefined | null, suffix = '') {
  if (!Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value as number)}${suffix}`
}

function displayText(value: string | undefined | null) {
  return value?.trim() || '—'
}

function comparison(
  key: ResearchFieldKey,
  label: string,
  currentValue: string,
  proposed: ResearchValue<string | number>,
  format: (value: string | number | null) => string = (value) => displayText(value === null ? null : String(value)),
): ResearchComparisonField {
  return {
    key,
    label,
    currentValue,
    proposedValue: format(proposed.value),
    hasProposal: proposed.value !== null,
    confidence: proposed.confidence,
    valueType: proposed.valueType,
    sourceUrls: proposed.sourceUrls,
    note: proposed.note,
  }
}

export function buildResearchComparison(product: Product | undefined, result: ProductResearchResult): ResearchComparisonField[] {
  const centimeters = (value: string | number | null) => displayNumber(typeof value === 'number' ? value : null, ' см')
  const kilograms = (value: string | number | null) => displayNumber(typeof value === 'number' ? value : null, ' кг')
  const count = (value: string | number | null) => displayNumber(typeof value === 'number' ? value : null, ' шт.')
  return [
    comparison('name', 'Название', displayText(product?.name), result.name),
    comparison('brand', 'Бренд', displayText(product?.brand), result.brand),
    comparison('description', 'Описание', displayText(product?.description), result.description),
    comparison('netContent', 'Содержимое единицы', displayText(product?.netContent), result.netContent),
    comparison('caseBarcode', 'Штрихкод коробки', displayText(product?.caseBarcode), result.casePack.barcode),
    comparison('unitsPerBox', 'Штук в коробке', displayNumber(product?.unitsPerBox, ' шт.'), result.casePack.unitsPerCase, count),
    comparison('item.lengthCm', 'Единица · длина', displayNumber(product?.itemSpec?.lengthCm, ' см'), result.unit.lengthCm, centimeters),
    comparison('item.widthCm', 'Единица · ширина', displayNumber(product?.itemSpec?.widthCm, ' см'), result.unit.widthCm, centimeters),
    comparison('item.heightCm', 'Единица · высота', displayNumber(product?.itemSpec?.heightCm, ' см'), result.unit.heightCm, centimeters),
    comparison('item.weightKg', 'Единица · вес брутто', displayNumber(product?.itemSpec?.weightKg, ' кг'), result.unit.grossWeightKg, kilograms),
    comparison('box.lengthCm', 'Коробка · длина', displayNumber(product?.boxSpec?.lengthCm, ' см'), result.casePack.lengthCm, centimeters),
    comparison('box.widthCm', 'Коробка · ширина', displayNumber(product?.boxSpec?.widthCm, ' см'), result.casePack.widthCm, centimeters),
    comparison('box.heightCm', 'Коробка · высота', displayNumber(product?.boxSpec?.heightCm, ' см'), result.casePack.heightCm, centimeters),
    comparison('box.weightKg', 'Коробка · вес брутто', displayNumber(product?.boxSpec?.weightKg, ' кг'), result.casePack.grossWeightKg, kilograms),
  ]
}

export function defaultResearchSelection(product: Product | undefined, fields: ResearchComparisonField[]) {
  return new Set(fields
    .filter((field) => field.hasProposal && (!product || field.currentValue === '—'))
    .map((field) => field.key))
}

export function applyResearchSelection(product: Product, result: ProductResearchResult, selection: ReadonlySet<ResearchFieldKey>) {
  const itemSpec: PhysicalSpec = { ...product.itemSpec }
  const boxSpec: Product['boxSpec'] = { ...product.boxSpec }
  const updated: Product = { ...product, itemSpec, boxSpec }

  if (selection.has('name') && result.name.value) updated.name = result.name.value
  if (selection.has('brand') && result.brand.value) updated.brand = result.brand.value
  if (selection.has('description') && result.description.value) updated.description = result.description.value
  if (selection.has('netContent') && result.netContent.value) updated.netContent = result.netContent.value
  if (selection.has('caseBarcode') && result.casePack.barcode.value) updated.caseBarcode = result.casePack.barcode.value.replace(/\D/g, '')
  if (selection.has('unitsPerBox') && result.casePack.unitsPerCase.value) updated.unitsPerBox = result.casePack.unitsPerCase.value
  if (selection.has('item.lengthCm') && result.unit.lengthCm.value) itemSpec.lengthCm = result.unit.lengthCm.value
  if (selection.has('item.widthCm') && result.unit.widthCm.value) itemSpec.widthCm = result.unit.widthCm.value
  if (selection.has('item.heightCm') && result.unit.heightCm.value) itemSpec.heightCm = result.unit.heightCm.value
  if (selection.has('item.weightKg') && result.unit.grossWeightKg.value) itemSpec.weightKg = result.unit.grossWeightKg.value
  if (selection.has('box.lengthCm') && result.casePack.lengthCm.value) boxSpec.lengthCm = result.casePack.lengthCm.value
  if (selection.has('box.widthCm') && result.casePack.widthCm.value) boxSpec.widthCm = result.casePack.widthCm.value
  if (selection.has('box.heightCm') && result.casePack.heightCm.value) boxSpec.heightCm = result.casePack.heightCm.value
  if (selection.has('box.weightKg') && result.casePack.grossWeightKg.value) boxSpec.weightKg = result.casePack.grossWeightKg.value

  const hasUsefulResult = buildResearchComparison(product, result).some((field) => field.hasProposal)
  const hasTechnicalSelection = [...selection].some((key) => key === 'unitsPerBox' || key.startsWith('item.') || key.startsWith('box.'))
  const hasCompleteTechnicalData = Boolean(
    updated.unitsPerBox
    && updated.itemSpec?.lengthCm && updated.itemSpec.widthCm && updated.itemSpec.heightCm && updated.itemSpec.weightKg
    && updated.boxSpec?.lengthCm && updated.boxSpec.widthCm && updated.boxSpec.heightCm && updated.boxSpec.weightKg,
  )
  updated.technicalDataSource = hasTechnicalSelection ? 'web' : product.technicalDataSource
  updated.technicalVerificationStatus = hasCompleteTechnicalData ? 'verified' : hasUsefulResult ? 'partially_verified' : 'insufficient_data'
  updated.research = { status: 'verified', result, reviewedAt: new Date().toISOString() }
  return updated
}
