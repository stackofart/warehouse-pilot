import { describe, expect, it } from 'vitest'
import { searchFulfillmentEntries, type FulfillmentSearchEntry } from './search'

const entries: FulfillmentSearchEntry[] = [
  { row: 1, address: '23.F', name: 'Milka шоколад молочный 90 г', barcode: '7290121920285', sku: '1511', status: 'pending' },
  { row: 2, address: '25.A', name: 'וויסקי גלנפידיך 12 שנה', barcode: '7290121920124', sku: '1360', status: 'picked' },
  { row: 3, address: '23.G', name: 'Milka Oreo 100 г', barcode: '7290121920353', sku: '1518', status: 'missing' },
]

describe('fulfillment item search', () => {
  it('finds an exact barcode before partial name matches', () => {
    expect(searchFulfillmentEntries(entries, '7290121920285').map((entry) => entry.row)).toEqual([1])
  })

  it('searches by sku and address without punctuation', () => {
    expect(searchFulfillmentEntries(entries, '1518').map((entry) => entry.row)).toEqual([3])
    expect(searchFulfillmentEntries(entries, '23f').map((entry) => entry.row)).toEqual([1])
  })

  it('supports names in different alphabets and multiple terms', () => {
    expect(searchFulfillmentEntries(entries, 'גלנפידיך').map((entry) => entry.row)).toEqual([2])
    expect(searchFulfillmentEntries(entries, 'milka 23g').map((entry) => entry.row)).toEqual([3])
  })

  it('returns no suggestions for an empty or unrelated query', () => {
    expect(searchFulfillmentEntries(entries, '')).toEqual([])
    expect(searchFulfillmentEntries(entries, 'кофе').length).toBe(0)
  })
})
