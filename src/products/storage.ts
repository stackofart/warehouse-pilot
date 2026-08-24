import { openDatabase, PRODUCTS_STORE, requestToPromise } from '../storage/database'
import { simulateProductTechnicalData } from './simulation'

export type Product = {
  id: string
  sku: string
  barcode: string
  name: string
  location: string
  /** Optional internal product description shown on demand in the catalogue. */
  description?: string
  unitsPerBox?: number
  itemSpec?: PhysicalSpec
  boxSpec?: PhysicalSpec & { maxTopLoadKg?: number }
  rigidity?: number
  fragility?: number
  imageDataUrl?: string
  technicalDataSource?: 'manual' | 'simulated' | 'imported'
  verificationStatus?: 'verified' | 'unverified'
  verificationSource?: 'manual' | 'imported' | 'recognition' | 'legacy'
  verifiedAt?: string
  createdAt: string
  updatedAt: string
}

export type PhysicalSpec = {
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightKg?: number
}

export type ProductInput = Pick<Product, 'sku' | 'barcode' | 'name' | 'location'>
  & Partial<Pick<Product, 'description' | 'unitsPerBox' | 'itemSpec' | 'boxSpec' | 'rigidity' | 'fragility' | 'imageDataUrl' | 'technicalDataSource' | 'verificationStatus' | 'verificationSource' | 'verifiedAt'>>
  & { id?: string }

export async function listProducts() {
  const database = await openDatabase()
  try {
    const products = await requestToPromise(database.transaction(PRODUCTS_STORE).objectStore(PRODUCTS_STORE).getAll()) as Product[]
    return products.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } finally {
    database.close()
  }
}

export async function saveProduct(input: ProductInput, options: { overwriteExisting?: boolean } = {}) {
  const database = await openDatabase()
  try {
    const lookup = database.transaction(PRODUCTS_STORE).objectStore(PRODUCTS_STORE)
    const [byId, bySku, byBarcode] = await Promise.all([
      input.id ? requestToPromise(lookup.get(input.id)) as Promise<Product | undefined> : Promise.resolve(undefined),
      requestToPromise(lookup.index('sku').get(input.sku)) as Promise<Product | undefined>,
      requestToPromise(lookup.index('barcode').get(input.barcode)) as Promise<Product | undefined>,
    ])

    const matches = [byId, bySku, byBarcode].filter((product): product is Product => Boolean(product))
    const matchedIds = new Set(matches.map((product) => product.id))
    if (matchedIds.size > 1) {
      throw new Error('Этот מק״ט и штрихкод уже принадлежат разным товарам')
    }

    const existing = matches[0]
    if (existing && options.overwriteExisting === false) {
      if (!existing.unitsPerBox && input.unitsPerBox) {
        const product = { ...existing, unitsPerBox: input.unitsPerBox }
        const transaction = database.transaction(PRODUCTS_STORE, 'readwrite')
        transaction.objectStore(PRODUCTS_STORE).put(product)
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось дополнить товар'))
        })
        return { product, updated: true, created: false }
      }
      return { product: existing, updated: false, created: false }
    }
    const now = new Date().toISOString()
    const product: Product = {
      ...existing,
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
      verificationStatus: input.verificationStatus ?? existing?.verificationStatus ?? 'verified',
      verificationSource: input.verificationSource ?? existing?.verificationSource ?? 'manual',
      verifiedAt: input.verificationStatus === 'unverified'
        ? undefined
        : input.verifiedAt ?? existing?.verifiedAt ?? now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const transaction = database.transaction(PRODUCTS_STORE, 'readwrite')
    transaction.objectStore(PRODUCTS_STORE).put(product)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить товар'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Сохранение товара отменено'))
    })
    return { product, updated: Boolean(existing), created: !existing }
  } finally {
    database.close()
  }
}

export async function saveOrderProducts(
  items: Array<{
    sku: string
    barcode: string
    description: string
    address: string
    unitsPerBox?: string
    catalogProductId?: string
    productVerification?: 'verified' | 'unverified'
  }>,
  options: boolean | {
    overwriteExisting?: boolean
    newProductVerification?: 'verified' | 'unverified'
    source?: 'manual' | 'imported' | 'recognition'
  } = {},
) {
  const resolved = typeof options === 'boolean'
    ? { overwriteExisting: options, newProductVerification: 'verified' as const, source: 'imported' as const }
    : {
        overwriteExisting: options.overwriteExisting ?? false,
        newProductVerification: options.newProductVerification ?? 'unverified',
        source: options.source ?? 'recognition',
      }
  let saved = 0
  let skipped = 0
  let matchedExisting = 0
  let incomplete = 0
  let conflicts = 0

  for (const item of items) {
    if (item.catalogProductId) {
      skipped += 1
      matchedExisting += 1
      continue
    }
    const input = {
      sku: item.sku.replace(/\D/g, ''),
      barcode: item.barcode.replace(/\D/g, ''),
      name: item.description.trim(),
      location: item.address.trim().toUpperCase(),
      ...(Number(item.unitsPerBox) > 0 ? { unitsPerBox: Number(item.unitsPerBox) } : {}),
      verificationStatus: item.productVerification ?? resolved.newProductVerification,
      verificationSource: resolved.source,
    }
    if (!input.sku || !input.barcode || !input.name || !input.location) {
      skipped += 1
      incomplete += 1
      continue
    }

    try {
      const result = await saveProduct(input, { overwriteExisting: resolved.overwriteExisting })
      const estimate = simulateProductTechnicalData(result.product)
      if (estimate) await saveProduct(estimate)
      if (result.created) saved += 1
      else {
        skipped += 1
        matchedExisting += 1
      }
    } catch (reason) {
      console.warn('Product from order was not saved', reason)
      conflicts += 1
    }
  }

  return { saved, skipped, matchedExisting, incomplete, conflicts }
}

export function isProductVerified(product: Pick<Product, 'verificationStatus'>) {
  return product.verificationStatus !== 'unverified'
}

export async function setProductVerification(id: string, verificationStatus: 'verified' | 'unverified') {
  const products = await listProducts()
  const product = products.find((candidate) => candidate.id === id)
  if (!product) throw new Error('Товар не найден')
  return saveProduct({
    ...product,
    verificationStatus,
    verificationSource: 'manual',
    verifiedAt: verificationStatus === 'verified' ? new Date().toISOString() : undefined,
  })
}

export async function deleteProduct(id: string) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(PRODUCTS_STORE, 'readwrite')
    transaction.objectStore(PRODUCTS_STORE).delete(id)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось удалить товар'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Удаление товара отменено'))
    })
  } finally {
    database.close()
  }
}

export async function clearProducts() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(PRODUCTS_STORE, 'readwrite')
    transaction.objectStore(PRODUCTS_STORE).clear()
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось очистить базу товаров'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Очистка базы отменена'))
    })
  } finally {
    database.close()
  }
}
