import { normalizeOrderDocument, type OrderDocument } from '../../shared/order-model.js'
import type { SavedOrder } from './storage'

export type ServerOrder = OrderDocument & { id: string; assignedTo: string | null; assigneeName: string; status: string; version: number; source: SavedOrder['source']; createdAt: string; updatedAt: string }
export function toServerOrder(order: Omit<SavedOrder, 'createdAt' | 'updatedAt'>) {
  const number = (value: string | undefined) => value === '' || value == null ? null : Number(value)
  const document = normalizeOrderDocument({ orderNumber: order.orderNumber, notes: order.notes, summary: { totalWeightKg: number(order.summary?.totalWeightKg), totalUnits: number(order.summary?.totalQuantity), totalBoxes: number(order.summary?.packageCount) }, lines: order.items.map(item => ({ id: String(item.row), sku: item.sku, barcode: item.barcode, name: item.description, address: item.address, quantityUnits: number(item.quantity), unitsPerBox: number(item.unitsPerBox), boxCount: number(item.boxCount) })) })
  return { ...document, version: order.version, source: order.source || 'manual' }
}
export function fromServerOrder(order: ServerOrder): SavedOrder {
  const value = (number: number | null | undefined) => number == null ? '' : String(number)
  return { id: order.id, orderNumber: order.orderNumber, notes: order.notes, createdAt: order.createdAt, updatedAt: order.updatedAt, assignedTo: order.assignedTo, assigneeName: order.assigneeName, status: order.status, version: order.version, source: order.source, rawText: '', summary: { itemCount: String(order.lines.length), totalQuantity: value(order.summary.totalUnits), packageCount: value(order.summary.totalBoxes), totalWeightKg: value(order.summary.totalWeightKg) }, productSnapshots: order.lines.flatMap(line => line.productSnapshot ? [line.productSnapshot] : []), items: order.lines.map(line => ({ row: line.row, sku: line.sku, barcode: line.barcode, description: line.name, address: line.address, quantity: value(line.quantityUnits), unitsPerBox: value(line.unitsPerBox), boxCount: value(line.boxCount), confidence: 100, warnings: [], catalogProductId: line.productId || undefined, productVerification: line.productSnapshot?.verificationStatus || 'unverified' })) }
}
