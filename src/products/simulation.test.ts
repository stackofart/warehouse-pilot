import { describe, expect, it } from 'vitest'
import { simulateProductTechnicalData } from './simulation'
import type { Product } from './storage'

const product = (overrides: Partial<Product> = {}): Product => ({ id: 'p1', sku: '1511', barcode: '7290121920285', name: 'מילקה שוקולד חלב 90 גרם', location: '23.F', unitsPerBox: 25, createdAt: '', updatedAt: '', ...overrides })

describe('technical-data simulation', () => {
  it('adds an explicitly simulated box based on the recognized category and actual units per box', () => {
    const result = simulateProductTechnicalData(product())
    expect(result).toMatchObject({ technicalDataSource: 'simulated', unitsPerBox: 25, rigidity: 3, fragility: 2 })
    expect(result?.boxSpec?.weightKg).toBeCloseTo(3.2)
  })

  it('preserves manual values and fills missing fields', () => {
    expect(simulateProductTechnicalData(product({ technicalDataSource: 'manual', itemSpec: { lengthCm: 99 } }))).toMatchObject({ technicalDataSource: 'simulated', itemSpec: { lengthCm: 99 } })
  })

  it('creates a deterministic generic estimate for an unknown category', () => {
    const first = simulateProductTechnicalData(product({ name: 'Неизвестный товар' }))
    const second = simulateProductTechnicalData(product({ name: 'Неизвестный товар' }))
    expect(first).toEqual(second)
    expect(first?.boxSpec?.lengthCm).toBeGreaterThan(0)
  })
})
