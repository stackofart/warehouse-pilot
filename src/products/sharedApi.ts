import type { Product, ProductInput } from './storage'

export type SharedCatalogProduct = Omit<Product, 'createdAt'> & { createdAt?: string; version?: number }

export type SharedProductPage = {
  items: SharedCatalogProduct[]
  total: number
  unverified: number
  offset: number
  limit: number
}

export type SharedProductImportResult = {
  created: number
  updated: number
  skipped: number
  errors: Array<{ index: number; error: string }>
}

const IMPORT_BATCH_SIZE = 10
const API_TIMEOUT_MS = 30_000

export class SharedApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'api_error') {
    super(message)
    this.name = 'SharedApiError'
    this.status = status
    this.code = code
  }
}

async function apiJson<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(path, {
      ...init,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    })
  } catch (reason) {
    if (controller.signal.aborted) {
      throw new SharedApiError('Сервер не ответил за 30 секунд. Перенос остановлен — уже обработанные пакеты сохранены.', 408, 'request_timeout')
    }
    throw reason
  } finally {
    globalThis.clearTimeout(timeout)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback = response.status === 413
      ? 'Пакет товаров слишком большой для отправки. Попробуйте повторить перенос.'
      : 'Сервис общей базы вернул ошибку.'
    throw new SharedApiError(body?.error || fallback, response.status, body?.code)
  }
  return body as T
}

export async function searchSharedCatalog(query: string, fetcher: typeof fetch = fetch) {
  const result = await apiJson<{ items: SharedCatalogProduct[]; limit: number }>(`/api/catalog/search?q=${encodeURIComponent(query.trim())}`, undefined, fetcher)
  return result.items
}

export async function matchSharedProducts(items: Array<{ barcode?: string; sku?: string }>, fetcher: typeof fetch = fetch): Promise<Product[]> {
  const result = await apiJson<{ items: SharedCatalogProduct[] }>('/api/catalog/match', {
    method: 'POST',
    body: JSON.stringify({ items }),
  }, fetcher)
  return result.items.map((product) => ({
    ...product,
    createdAt: product.createdAt || product.updatedAt,
    updatedAt: product.updatedAt,
  }))
}

export function getAdminProductPage(query = '', offset = 0, fetcher: typeof fetch = fetch) {
  const parameters = new URLSearchParams({ offset: String(offset) })
  if (query.trim()) parameters.set('q', query.trim())
  return apiJson<SharedProductPage>(`/api/admin/products?${parameters}`, undefined, fetcher)
}

/**
 * D1 stores the operational product card, not device-local images or the full
 * OpenAI research trace. Keeping this projection explicit also prevents a few
 * product photos from turning catalog migration into a very large HTTP request.
 */
export function productForSharedImport(product: ProductInput) {
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    location: product.location,
    description: product.description,
    brand: product.brand,
    netContent: product.netContent,
    unitsPerBox: product.unitsPerBox,
    caseBarcode: product.caseBarcode,
    itemSpec: product.itemSpec,
    boxSpec: product.boxSpec,
    rigidity: product.rigidity,
    fragility: product.fragility,
    verificationStatus: product.verificationStatus,
    verificationSource: product.verificationSource,
    verifiedAt: product.verifiedAt,
  }
}

export async function importSharedProducts(
  products: ProductInput[],
  fetcher: typeof fetch = fetch,
  onProgress?: (processed: number, total: number) => void,
): Promise<SharedProductImportResult> {
  const result: SharedProductImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  for (let offset = 0; offset < products.length; offset += IMPORT_BATCH_SIZE) {
    const batch = products.slice(offset, offset + IMPORT_BATCH_SIZE).map(productForSharedImport)
    const imported = await apiJson<SharedProductImportResult>('/api/admin/products/import', {
      method: 'POST',
      body: JSON.stringify({ products: batch }),
    }, fetcher)
    result.created += imported.created
    result.updated += imported.updated
    result.skipped += imported.skipped
    result.errors.push(...imported.errors.map((error) => ({ ...error, index: error.index + offset })))
    onProgress?.(Math.min(offset + batch.length, products.length), products.length)
  }

  return result
}

export function createSharedProduct(input: Pick<Product, 'sku' | 'barcode' | 'name' | 'location'> & Partial<Pick<Product, 'description' | 'unitsPerBox'>>, fetcher: typeof fetch = fetch) {
  return apiJson<{ product: SharedCatalogProduct }>('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({ ...input, verificationStatus: 'verified', verificationSource: 'manual' }),
  }, fetcher)
}
