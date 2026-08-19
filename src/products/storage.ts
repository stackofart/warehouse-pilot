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
  & Partial<Pick<Product, 'description' | 'unitsPerBox' | 'itemSpec' | 'boxSpec' | 'rigidity' | 'fragility' | 'imageDataUrl' | 'technicalDataSource'>>
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
        return { product, updated: true }
      }
      return { product: existing, updated: false }
    }
    const now = new Date().toISOString()
    const product: Product = {
      ...existing,
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
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
    return { product, updated: Boolean(existing) }
  } finally {
    database.close()
  }
}

export async function saveOrderProducts(
  items: Array<{ sku: string; barcode: string; description: string; address: string; unitsPerBox?: string }>,
  overwriteExisting = true,
) {
  let saved = 0
  let skipped = 0
  let conflicts = 0

  for (const item of items) {
    const input = {
      sku: item.sku.replace(/\D/g, ''),
      barcode: item.barcode.replace(/\D/g, ''),
      name: item.description.trim(),
      location: item.address.trim().toUpperCase(),
      ...(Number(item.unitsPerBox) > 0 ? { unitsPerBox: Number(item.unitsPerBox) } : {}),
    }
    if (!input.sku || !input.barcode || !input.name || !input.location) {
      skipped += 1
      continue
    }

    try {
      const result = await saveProduct(input, { overwriteExisting })
      const estimate = simulateProductTechnicalData(result.product)
      if (estimate) await saveProduct(estimate)
      saved += 1
    } catch (reason) {
      console.warn('Product from order was not saved', reason)
      conflicts += 1
    }
  }

  return { saved, skipped, conflicts }
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
