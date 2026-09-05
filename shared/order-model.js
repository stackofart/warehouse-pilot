// WMS adapters, JSON import and OCR all produce this numeric, source-neutral model.
export function normalizeOrderDocument(input) {
  if (!input || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 1000) throw new Error('Заказ должен содержать от 1 до 1000 позиций.')
  const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const quantity = (value, required = false) => {
    if (value === null || value === undefined || value === '') {
      if (required) throw new Error('Укажите количество каждой позиции.')
      return null
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error('Количество должно быть неотрицательным числом.')
    return value
  }
  const ids = new Set()
  return {
    orderNumber: text(input.orderNumber, 100),
    notes: text(input.notes, 4000),
    summary: {
      totalWeightKg: quantity(input.summary?.totalWeightKg),
      totalUnits: quantity(input.summary?.totalUnits),
      totalBoxes: quantity(input.summary?.totalBoxes),
    },
    lines: input.lines.map((line, index) => {
      const id = text(line.id, 100) || String(index + 1)
      if (ids.has(id)) throw new Error('Идентификаторы позиций должны быть уникальными.')
      ids.add(id)
      const sku = text(line.sku, 32)
      const barcode = text(line.barcode, 32)
      if (!sku && !barcode) throw new Error(`Позиция ${index + 1}: нужен макат или штрихкод.`)
      return { id, row: index + 1, sku, barcode, name: text(line.name), address: text(line.address, 32).toUpperCase(), quantityUnits: quantity(line.quantityUnits, true), unitsPerBox: quantity(line.unitsPerBox), boxCount: quantity(line.boxCount), productId: text(line.productId, 100) || null }
    }),
  }
}
