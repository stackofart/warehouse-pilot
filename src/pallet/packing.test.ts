import { describe, expect, it } from 'vitest'
import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'
import { allBoxesInspectable, optimizePallet } from './packing'
import { demoOrders, demoProducts } from './demoData'

function order(items: SavedOrder['items']): SavedOrder {
  return { id: 'order', orderNumber: 'SO1', items, rawText: '', sourceFileName: '', createdAt: '', updatedAt: '' }
}

function item(row: number, sku: string, boxes = '1'): SavedOrder['items'][number] {
  return { row, address: '23.F', sku, barcode: `729000000${sku}`, description: `Product ${sku}`, quantity: boxes, unitsPerBox: '1', boxCount: boxes, confidence: 100, warnings: [] }
}

function product(sku: string, overrides: Partial<Product> = {}): Product {
  return { id: sku, sku, barcode: `729000000${sku}`, name: `Product ${sku}`, location: '23.F', unitsPerBox: 1, boxSpec: { lengthCm: 60, widthCm: 40, heightCm: 30, weightKg: 10, maxTopLoadKg: 20 }, rigidity: 3, fragility: 3, createdAt: '', updatedAt: '', ...overrides }
}

describe('pallet packing recommendation', () => {
  it('propagates load through every supporting layer', () => {
    const boxes = product('1001', { boxSpec: { lengthCm: 120, widthCm: 80, heightCm: 10, weightKg: 10, maxTopLoadKg: 15 } })
    const result = optimizePallet(order([item(1, '1001', '3')]), [boxes])
    expect(result.requiredPallets).toBe(2)
    for (const pallet of result.pallets) for (const box of pallet.placements) {
      const actualLoad = pallet.placements.filter(other => other.z > box.z).reduce((sum, other) => sum + other.weightKg, 0)
      expect(box.loadAboveKg).toBe(actualLoad)
      expect(actualLoad).toBeLessThanOrEqual(15)
    }
  })
  it('does not silently truncate a 201-box order', () => {
    const boxes = product('1001', { boxSpec: { lengthCm: 120, widthCm: 80, heightCm: 10, weightKg: 1, maxTopLoadKg: 100 } })
    const result = optimizePallet(order([item(1, '1001', '201')]), [boxes])
    expect(result.pallets.reduce((sum, pallet) => sum + pallet.placements.length, 0)).toBe(201)
    expect(result.issues).toEqual([])
  })
  it('keeps each box inspectable and respects height and weight constraints', () => {
    const boxes = product('1001', { boxSpec: { lengthCm: 40, widthCm: 26, heightCm: 22, weightKg: 5, maxTopLoadKg: 500 } })
    const result = optimizePallet(order([item(1, '1001', '30')]), [boxes], [], { maxHeightCm: 44, maxWeightKg: 50, inspectable: true })
    for (const pallet of result.pallets) {
      expect(allBoxesInspectable(pallet.placements)).toBe(true)
      expect(pallet.heightCm).toBeLessThanOrEqual(44)
      expect(pallet.totalWeightKg).toBeLessThanOrEqual(50)
    }
  })
  it('places boxes only when measured box data exists', () => {
    const result = optimizePallet(order([item(1, '1001'), item(2, '1002')]), [product('1001'), product('1002', { boxSpec: undefined })])
    expect(result.placements).toHaveLength(1)
    expect(result.issues).toContainEqual(expect.objectContaining({ sku: '1002', reason: 'BOX_DIMENSIONS_MISSING' }))
  })

  it('does not stack onto a box without an explicit top-load capacity', () => {
    const fullPallet = product('1001', { boxSpec: { lengthCm: 120, widthCm: 80, heightCm: 30, weightKg: 10 } })
    const result = optimizePallet(order([item(1, '1001', '2')]), [fullPallet])
    expect(result.placements).toHaveLength(1)
    expect(result.requiredPallets).toBe(2)
    expect(result.pallets[1].placements).toHaveLength(1)
    expect(result.issues).toEqual([])
  })

  it('stacks when support and load capacity are explicitly sufficient', () => {
    const fullPallet = product('1001', { boxSpec: { lengthCm: 120, widthCm: 80, heightCm: 30, weightKg: 10, maxTopLoadKg: 15 } })
    const result = optimizePallet(order([item(1, '1001', '2')]), [fullPallet])
    expect(result.placements).toHaveLength(2)
    expect(result.heightCm).toBe(60)
  })

  it('considers heavier foundation boxes first', () => {
    const result = optimizePallet(order([item(1, 'light'), item(2, 'heavy')]), [product('light', { boxSpec: { lengthCm: 60, widthCm: 40, heightCm: 20, weightKg: 2 } }), product('heavy', { boxSpec: { lengthCm: 60, widthCm: 40, heightCm: 20, weightKg: 20 } })])
    expect(result.placements[0].sku).toBe('heavy')
  })

  it('fills the base layer at pallet edges before starting a new layer', () => {
    const result = optimizePallet(order([item(1, '1001', '5')]), [product('1001')])
    expect(result.placements.filter((placement) => placement.z === 0)).toHaveLength(4)
    expect(result.placements.filter((placement) => placement.z === 30)).toHaveLength(1)
    expect(result.placements.slice(0, 4).every((placement) => placement.x === 0 || placement.x + placement.lengthCm === 120 || placement.y === 0 || placement.y + placement.widthCm === 80)).toBe(true)
  })

  it('limits a pallet to six dense layers and moves overflow to a second pallet', () => {
    const standard = product('1001', { boxSpec: { lengthCm: 40, widthCm: 26, heightCm: 22, weightKg: 5, maxTopLoadKg: 500 } })
    const result = optimizePallet(order([item(1, '1001', '55')]), [standard], [], { inspectable: false })
    expect(result.requiredPallets).toBe(2)
    expect(result.pallets[0].layerCount).toBe(6)
    expect(result.pallets[0].placements).toHaveLength(54)
    expect(result.pallets[1].placements).toHaveLength(1)
  })

  it('never exceeds six base levels with mixed box heights', () => {
    for (const demoOrder of demoOrders) {
      const result = optimizePallet(demoOrder, demoProducts)
      expect(result.pallets.every((pallet) => pallet.layerCount <= 6)).toBe(true)
    }
  })
})
