export interface OrderLine {
  id: string; row: number; sku: string; barcode: string; name: string; address: string
  quantityUnits: number; unitsPerBox: number | null; boxCount: number | null; productId: string | null
  productSnapshot?: import('../src/products/storage').Product
}
export interface OrderDocument {
  orderNumber: string; notes: string
  summary: { totalWeightKg: number | null; totalUnits: number | null; totalBoxes: number | null }
  lines: OrderLine[]
}
export function normalizeOrderDocument(input: unknown): OrderDocument
