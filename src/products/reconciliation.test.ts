import { describe, expect, it } from 'vitest'
import type { RecognizedOrderItem } from '../recognition/ocr'
import { reconcileRecognizedItems } from './reconciliation'
import type { Product } from './storage'

const now = '2026-08-24T00:00:00.000Z'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', sku: '5688', barcode: '0608614323746', name: 'דוריטוס גרעיני חמניה 500 ג', location: '22.E',
    unitsPerBox: 18, verificationStatus: 'verified', createdAt: now, updatedAt: now, ...overrides,
  }
}

function item(overrides: Partial<RecognizedOrderItem> = {}): RecognizedOrderItem {
  return {
    row: 1, address: '22.E', sku: '5688', barcode: '0608614323746', description: 'שם שגוי מאוד',
    quantity: '18', unitsPerBox: '18', boxCount: '1', confidence: 75, warnings: [], ...overrides,
  }
}

describe('local product reconciliation', () => {
  it('replaces a wrong recognized name with the trusted database value', () => {
    const result = reconcileRecognizedItems([item()], [product()])
    expect(result.items[0]).toMatchObject({ description: product().name, catalogProductId: 'p1', productVerification: 'verified' })
    expect(result.items[0].catalogCorrectedFields).toContain('description')
  })

  it('uses an exact barcode to repair a misread warehouse address', () => {
    const result = reconcileRecognizedItems([item({ address: '22.F', sku: '5689' })], [product()])
    expect(result.items[0]).toMatchObject({ address: '22.E', sku: '5688', catalogMatchReason: 'barcode' })
  })

  it('keeps a low-similarity row and marks it unverified', () => {
    const result = reconcileRecognizedItems([item({ address: '40.B', sku: '9999', barcode: '7290121920285', description: 'מוצר אחר' })], [product()])
    expect(result.items[0]).toMatchObject({ description: 'מוצר אחר', productVerification: 'unverified', catalogMatchReason: 'none' })
    expect(result.unverified).toBe(1)
  })

  it('propagates an unverified database status to a matched order row', () => {
    const result = reconcileRecognizedItems([item()], [product({ verificationStatus: 'unverified' })])
    expect(result.items[0].productVerification).toBe('unverified')
  })
})
