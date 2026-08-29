import { describe, expect, it } from 'vitest'
import type { Product } from '../products/storage'
import { advanceBarcodeConsensus, barcodeLookupKeys, findProductByBarcode, normalizeBarcode } from './barcodeUtils'

const product: Product = {
  id: 'product-1',
  sku: '1112',
  barcode: '7290121920100',
  name: 'קפה ג׳ייקובס 190 גרם',
  location: '4.D',
  verificationStatus: 'verified',
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
}

describe('barcode scanner helpers', () => {
  it('normalizes spaces and scanner separators', () => {
    expect(normalizeBarcode(' 7290-1219 20100\n')).toBe('7290121920100')
  })

  it('matches equivalent UPC-A and zero-prefixed EAN-13 values', () => {
    expect(barcodeLookupKeys('0123456789012')).toContain('123456789012')
    expect(findProductByBarcode([{ ...product, barcode: '0123456789012' }], '123456789012')?.id).toBe('product-1')
  })

  it('finds a product only by an exact normalized barcode', () => {
    expect(findProductByBarcode([product], '7290 1219 20100')?.name).toBe(product.name)
    expect(findProductByBarcode([product], '7290121920101')).toBeUndefined()
  })

  it('confirms the same camera result only after two nearby frames', () => {
    const first = advanceBarcodeConsensus(null, product.barcode, 'EAN13', 1_000)
    const second = advanceBarcodeConsensus(first.consensus, product.barcode, 'EAN13', 1_220)
    expect(first.confirmed).toBe(false)
    expect(second.confirmed).toBe(true)
  })

  it('resets consensus when the code changes or the gap is too long', () => {
    const first = advanceBarcodeConsensus(null, product.barcode, 'EAN13', 1_000)
    const changed = advanceBarcodeConsensus(first.consensus, '7290121920101', 'EAN13', 1_100)
    const delayed = advanceBarcodeConsensus(first.consensus, product.barcode, 'EAN13', 3_000)
    expect(changed.consensus?.hits).toBe(1)
    expect(delayed.consensus?.hits).toBe(1)
  })
})
