import { describe, expect, it } from 'vitest'
import { createOrdersDatabaseExport, orderImportExample, orderImportInstructions, OrderImportValidationError, parseOrderDocument } from './transfer'
import type { SavedOrder } from './storage'

function issuesFrom(text: string) {
  try {
    parseOrderDocument(text)
    return []
  } catch (reason) {
    expect(reason).toBeInstanceOf(OrderImportValidationError)
    return (reason as OrderImportValidationError).issues
  }
}

describe('order JSON import', () => {
  it('accepts the published example and normalizes the warehouse sector', () => {
    const value = structuredClone(orderImportExample)
    value.order.items[0].address = '23.f'
    const parsed = parseOrderDocument(JSON.stringify(value))
    expect(parsed.order.orderNumber).toBe('SO26017112')
    expect(parsed.order.notes).toBe('Проверить замену перед сборкой')
    expect(parsed.order.items[0]).toMatchObject({ address: '23.F', quantity: 48, unitsPerBox: 24, boxCount: 2 })
  })

  it('accepts old files without the optional notes field', () => {
    const value = structuredClone(orderImportExample)
    delete value.order.notes
    expect(parseOrderDocument(JSON.stringify(value)).order.notes).toBe('')
  })

  it('rejects unknown fields so the format stays unambiguous', () => {
    const value = { ...orderImportExample, unexpected: true }
    expect(issuesFrom(JSON.stringify(value))).toContain('$: неизвестное поле «unexpected»')
  })

  it('rejects duplicate row numbers', () => {
    const value = structuredClone(orderImportExample)
    value.order.items.push({ ...value.order.items[0] })
    expect(issuesFrom(JSON.stringify(value))).toContain('order.items: номер строки 1 повторяется')
  })

  it('rejects quantity that does not match boxes', () => {
    const value = structuredClone(orderImportExample)
    value.order.items[0].quantity = 47
    expect(issuesFrom(JSON.stringify(value))).toContain('order.items[0]: quantity должен равняться unitsPerBox × boxCount')
  })

  it('rejects an invalid GTIN check digit', () => {
    const value = structuredClone(orderImportExample)
    value.order.items[0].barcode = '7290121920286'
    expect(issuesFrom(JSON.stringify(value))[0]).toContain('корректный GTIN')
  })

  it('publishes the contract rules in the downloadable instruction', () => {
    expect(orderImportInstructions).toContain('quantity = unitsPerBox × boxCount')
    expect(orderImportInstructions).toContain('warehouse-pilot.order')
    expect(orderImportInstructions).toContain('Неизвестные поля запрещены')
  })

  it('exports the complete order store without legacy customer data', () => {
    const order: SavedOrder = {
      id: 'o1', orderNumber: 'SO1', items: [], rawText: '', sourceFileName: 'one.jpg', createdAt: '', updatedAt: '',
      customer: { name: 'legacy customer' },
    }
    const backup = createOrdersDatabaseExport([order])
    expect(backup.orders).toHaveLength(1)
    expect(backup.orders[0]).not.toHaveProperty('customer')
    expect(backup.orders[0].sourceFileNames).toEqual(['one.jpg'])
  })
})
