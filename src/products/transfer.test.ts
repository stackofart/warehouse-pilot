import { describe, expect, it } from 'vitest'
import { analyzeProductImport, createProductDocument, parseProductDocument } from './transfer'
import type { Product } from './storage'

const saved: Product = { id: 'p1', sku: '1511', barcode: '7290121920285', name: 'Milka milk', location: '23.F', description: 'Молочный шоколад в коробке по 24 штуки.', createdAt: '', updatedAt: '' }

describe('product JSON transfer', () => {
  it('exports a versioned portable document without local IDs', () => {
    const document = createProductDocument([saved])
    expect(parseProductDocument(JSON.stringify(document))).toMatchObject({ schema: 'warehouse-pilot.products', version: 1 })
    expect(document.products[0]).not.toHaveProperty('id')
    expect(document.products[0]).toHaveProperty('description', saved.description)
  })

  it('accepts earlier imports without an optional description', () => {
    const document = parseProductDocument(JSON.stringify({
      schema: 'warehouse-pilot.products',
      version: 1,
      products: [{ sku: '1550', barcode: '7290121920520', name: 'Milka airy', location: '23.F' }],
    }))
    expect(document.products[0].description).toBeUndefined()
  })

  it('rejects a non-text product description', () => {
    expect(() => parseProductDocument(JSON.stringify({
      schema: 'warehouse-pilot.products',
      version: 1,
      products: [{ sku: '1550', barcode: '7290121920520', name: 'Milka airy', location: '23.F', description: 42 }],
    }))).toThrow('description')
  })

  it('rejects an overly long product description', () => {
    expect(() => parseProductDocument(JSON.stringify({
      schema: 'warehouse-pilot.products',
      version: 1,
      products: [{ sku: '1550', barcode: '7290121920520', name: 'Milka airy', location: '23.F', description: 'x'.repeat(2001) }],
    }))).toThrow('2000')
  })

  it('blocks duplicate sku, barcode or name', () => {
    const result = analyzeProductImport([saved], [{ sku: '1511', barcode: '12345678', name: 'Other', location: '24.G' }])
    expect(result.accepted).toHaveLength(0)
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'sku', blocking: true }))
  })

  it('allows shared locations and reports them as warnings', () => {
    const result = analyzeProductImport([saved], [{ sku: '1550', barcode: '7290121920520', name: 'Milka airy', location: '23.F' }])
    expect(result.accepted).toHaveLength(1)
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'location', blocking: false }))
  })

  it('finds conflicts between rows inside the same import', () => {
    const result = analyzeProductImport([], [
      { sku: '1550', barcode: '7290121920520', name: 'One', location: '23.F' },
      { sku: '1550', barcode: '7290121920667', name: 'Two', location: '24.G' },
    ])
    expect(result.accepted).toHaveLength(1)
    expect(result.skipped).toBe(1)
  })
})
