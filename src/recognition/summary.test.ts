import { describe, expect, it } from 'vitest'
import { parseOrderSummary } from './ocr'

describe('printed order summary parsing', () => {
  it('reads Hebrew footer totals without calculating them from rows', () => {
    const summary = parseOrderSummary(`
משקל: 101.67 קג
מס' פריטים: 25
סה"כ כמות: 506.00
מס' אריזות: 26
`)
    expect(summary).toEqual({ itemCount: '25', totalQuantity: '506.00', packageCount: '26', totalWeightKg: '101.67' })
  })

  it('supports values that OCR places before an RTL label', () => {
    expect(parseOrderSummary(`25 מס' פריטים\n77.71 משקל`).itemCount).toBe('25')
    expect(parseOrderSummary(`25 מס' פריטים\n77.71 משקל`).totalWeightKg).toBe('77.71')
  })
})
