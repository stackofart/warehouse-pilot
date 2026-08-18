import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'

const now = '2026-08-18T00:00:00.000Z'

function product(id: string, sku: string, name: string, lengthCm: number, widthCm: number, heightCm: number, weightKg: number, rigidity = 4, fragility = 2): Product {
  return {
    id, sku, barcode: `7299900${sku.padStart(7, '0')}`.slice(0, 13), name, location: '23.F', unitsPerBox: 1,
    boxSpec: { lengthCm, widthCm, heightCm, weightKg, maxTopLoadKg: Math.max(20, weightKg * 12) },
    rigidity, fragility, technicalDataSource: 'simulated', createdAt: now, updatedAt: now,
  }
}

export const demoProducts: Product[] = [
  product('demo-common', '9001', 'Демо · стандартная коробка 40×26×22', 40, 26, 22, 6.5),
  product('demo-small', '9002', 'Демо · малая коробка 20×10×5', 20, 10, 5, .45, 3, 2),
  product('demo-medium', '9003', 'Демо · средняя коробка 60×40×25', 60, 40, 25, 11),
  product('demo-tall', '9004', 'Демо · высокая коробка 40×26×35', 40, 26, 35, 8),
  product('demo-long', '9005', 'Демо · длинная коробка 80×30×20', 80, 30, 20, 9),
]

function demoItem(row: number, product: Product, count: number): SavedOrder['items'][number] {
  return { row, address: '23.F', sku: product.sku, barcode: product.barcode, description: product.name, quantity: String(count), unitsPerBox: '1', boxCount: String(count), confidence: 100, warnings: [] }
}

function demoOrder(id: string, orderNumber: string, items: Array<[Product, number]>): SavedOrder {
  return {
    id, orderNumber, customer: { name: 'Демонстрационный заказ', address: '', city: '', phone: '', customerNumber: '', raw: '' },
    items: items.map(([demoProduct, count], index) => demoItem(index + 1, demoProduct, count)), rawText: '', sourceFileName: '', createdAt: now, updatedAt: now,
  }
}

export const demoOrders: SavedOrder[] = [
  demoOrder('demo-dense', 'ДЕМО · 9 коробок в слое', [[demoProducts[0], 27]]),
  demoOrder('demo-mixed', 'ДЕМО · смешанные габариты', [[demoProducts[2], 4], [demoProducts[4], 4], [demoProducts[0], 18], [demoProducts[3], 6], [demoProducts[1], 24]]),
  demoOrder('demo-split', 'ДЕМО · разделение на паллеты', [[demoProducts[0], 60], [demoProducts[1], 20]]),
]
