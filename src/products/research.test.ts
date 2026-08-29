import { describe, expect, it } from 'vitest'
import { applyResearchSelection, buildResearchComparison, defaultResearchSelection } from './research'
import type { Product } from './storage'
import type { ProductResearchResult, ResearchValue } from './researchTypes'

const value = <T>(current: T | null, confidence: 'low' | 'medium' | 'high' = 'high'): ResearchValue<T> => ({
  value: current, confidence, valueType: current === null ? 'not_found' : 'published', sourceUrls: current === null ? [] : ['https://example.com/product'], note: '',
})

const result = (): ProductResearchResult => ({
  barcode: '7290121920285', identityMatch: 'exact', identityConfidence: 96,
  name: value('Milka milk 90 g'), brand: value('Milka'), description: value('Milk chocolate'), netContent: value('90 g'),
  unit: { lengthCm: value(16), widthCm: value(8), heightCm: value(1), grossWeightKg: value(.096) },
  casePack: { barcode: value('17290121920282'), unitsPerCase: value(24), lengthCm: value(39), widthCm: value(19), heightCm: value(14), grossWeightKg: value(2.7) },
  conflicts: [], warnings: [], sources: [{ url: 'https://example.com/product', title: 'Product' }], model: 'test', researchedAt: '2026-08-29T00:00:00.000Z',
})

const product = (): Product => ({
  id: 'p1', sku: '1511', barcode: '7290121920285', name: 'Milka', location: '23.F', unitsPerBox: 25,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('product web research comparison', () => {
  it('selects only missing local fields by default for an existing product', () => {
    const fields = buildResearchComparison(product(), result())
    const selected = defaultResearchSelection(product(), fields)

    expect(selected.has('brand')).toBe(true)
    expect(selected.has('unitsPerBox')).toBe(false)
    expect(selected.has('item.weightKg')).toBe(true)
  })

  it('applies only explicitly accepted fields and preserves local values', () => {
    const updated = applyResearchSelection(product(), result(), new Set(['unitsPerBox', 'item.weightKg']))

    expect(updated.name).toBe('Milka')
    expect(updated.unitsPerBox).toBe(24)
    expect(updated.itemSpec?.weightKg).toBe(.096)
    expect(updated.boxSpec?.weightKg).toBeUndefined()
    expect(updated.technicalDataSource).toBe('web')
    expect(updated.research?.status).toBe('verified')
  })
})
