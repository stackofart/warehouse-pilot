import { saveProduct, type Product, type ProductInput } from './storage'

export const PRODUCT_DOCUMENT_SCHEMA = 'warehouse-pilot.products'
export const PRODUCT_DOCUMENT_VERSION = 1

export type ProductTransfer = Omit<ProductInput, 'id'>
export type ProductDocument = { schema: typeof PRODUCT_DOCUMENT_SCHEMA; version: 1; exportedAt: string; products: ProductTransfer[] }
export type ProductConflict = { index: number; field: 'sku' | 'barcode' | 'name' | 'location'; value: string; blocking: boolean; incomingName: string; existingName: string }

const normalizeText = (value: string) => value.trim().toLocaleLowerCase()
const clean = (product: ProductTransfer): ProductTransfer => ({
  ...product,
  sku: String(product.sku ?? '').replace(/\D/g, ''),
  barcode: String(product.barcode ?? '').replace(/\D/g, ''),
  name: String(product.name ?? '').trim(),
  location: String(product.location ?? '').trim().toUpperCase(),
  technicalDataSource: 'imported',
})

export function createProductDocument(products: Product[]): ProductDocument {
  return {
    schema: PRODUCT_DOCUMENT_SCHEMA,
    version: PRODUCT_DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    products: products.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...product }) => product),
  }
}

export function parseProductDocument(text: string): ProductDocument {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') throw new Error('JSON должен содержать объект')
  const document = value as Partial<ProductDocument>
  if (document.schema !== PRODUCT_DOCUMENT_SCHEMA || document.version !== PRODUCT_DOCUMENT_VERSION || !Array.isArray(document.products)) {
    throw new Error('Неподдерживаемая схема файла товаров')
  }
  return document as ProductDocument
}

export function analyzeProductImport(existing: Product[], incoming: ProductTransfer[]) {
  const accepted: ProductTransfer[] = []
  const conflicts: ProductConflict[] = []
  const seen: Array<Pick<Product, 'sku' | 'barcode' | 'name' | 'location'>> = [...existing]

  incoming.forEach((raw, index) => {
    const product = clean(raw)
    if (!/^\d{3,10}$/.test(product.sku) || !/^\d{8,14}$/.test(product.barcode) || !product.name || !product.location) {
      conflicts.push({ index, field: 'sku', value: product.sku, blocking: true, incomingName: product.name || `Строка ${index + 1}`, existingName: 'Некорректные обязательные поля' })
      return
    }
    let blocked = false
    for (const field of ['sku', 'barcode', 'name', 'location'] as const) {
      const match = seen.find((candidate) => normalizeText(candidate[field]) === normalizeText(product[field]))
      if (!match) continue
      const blocking = field !== 'location'
      conflicts.push({ index, field, value: product[field], blocking, incomingName: product.name, existingName: match.name })
      blocked ||= blocking
    }
    if (!blocked) {
      accepted.push(product)
      seen.push(product)
    }
  })
  return { accepted, conflicts, skipped: incoming.length - accepted.length }
}

export async function importProductDocument(existing: Product[], document: ProductDocument) {
  const analysis = analyzeProductImport(existing, document.products)
  for (const product of analysis.accepted) await saveProduct(product)
  return { ...analysis, imported: analysis.accepted.length }
}

export const productJsonSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  title: 'Warehouse Pilot product import',
  type: 'object',
  required: ['schema', 'version', 'products'],
  properties: {
    schema: { const: PRODUCT_DOCUMENT_SCHEMA },
    version: { const: PRODUCT_DOCUMENT_VERSION },
    exportedAt: { type: 'string', format: 'date-time' },
    products: { type: 'array', items: { '$ref': '#/$defs/product' } },
  },
  '$defs': {
    physicalSpec: { type: 'object', properties: { lengthCm: { type: 'number', exclusiveMinimum: 0 }, widthCm: { type: 'number', exclusiveMinimum: 0 }, heightCm: { type: 'number', exclusiveMinimum: 0 }, weightKg: { type: 'number', exclusiveMinimum: 0 } } },
    product: { type: 'object', required: ['sku', 'barcode', 'name', 'location'], properties: { sku: { type: 'string', pattern: '^\\d{3,10}$' }, barcode: { type: 'string', pattern: '^\\d{8,14}$' }, name: { type: 'string', minLength: 1 }, location: { type: 'string', minLength: 1 }, unitsPerBox: { type: 'number', exclusiveMinimum: 0 }, itemSpec: { '$ref': '#/$defs/physicalSpec' }, boxSpec: { allOf: [{ '$ref': '#/$defs/physicalSpec' }, { type: 'object', properties: { maxTopLoadKg: { type: 'number', exclusiveMinimum: 0 } } }] }, rigidity: { type: 'number', minimum: 1, maximum: 5 }, fragility: { type: 'number', minimum: 1, maximum: 5 }, imageDataUrl: { type: 'string' } } },
  },
}

export const productImportExample: ProductDocument = {
  schema: PRODUCT_DOCUMENT_SCHEMA,
  version: PRODUCT_DOCUMENT_VERSION,
  exportedAt: new Date(0).toISOString(),
  products: [{ sku: '1511', barcode: '7290121920285', name: 'Название товара', location: '23.F', unitsPerBox: 24, itemSpec: { lengthCm: 16, widthCm: 8, heightCm: 1, weightKg: .1 }, boxSpec: { lengthCm: 39, widthCm: 19, heightCm: 14, weightKg: 3.1, maxTopLoadKg: 25 }, rigidity: 3, fragility: 2 }],
}
