import { describe, expect, it } from 'vitest'
import { OpenAIRecognitionError, normalizeOpenAIOrder } from './openai'

describe('OpenAI order recognition result', () => {
  it('normalizes the structured response for the existing order workflow', () => {
    const result = normalizeOpenAIOrder({
      rawText: 'לכבוד: פרטי לקוח שאסור לשמור\nאישור הזמנה מספר SO26017094',
      confidence: 91.6,
      orderNumber: 'SO 26017094',
      summary: { itemCount: '25', totalQuantity: '506.00', packageCount: '26', totalWeightKg: '101.67' },
      items: [{
        address: '22f',
        sku: ' 5688 ',
        barcode: '*0608614323746*',
        description: 'דוריטוס גרעיני חמניה 500 ג׳',
        quantity: '18.00',
        unitsPerBox: '18',
        boxCount: '1',
        confidence: 88.4,
      }],
      model: 'gpt-5.6-luna',
    })

    expect(result.orderNumber).toBe('SO26017094')
    expect(result.text).not.toContain('פרטי לקוח')
    expect(result.summary).toEqual({ itemCount: '25', totalQuantity: '506.00', packageCount: '26', totalWeightKg: '101.67' })
    expect(result.items[0]).toMatchObject({
      row: 1,
      address: '22.F',
      sku: '5688',
      barcode: '0608614323746',
      quantity: '18',
      unitsPerBox: '18',
      boxCount: '1',
      confidence: 88,
    })
    expect(result.provider).toBe('openai')
    expect(result.model).toBe('gpt-5.6-luna')
  })

  it('rejects a response without order rows', () => {
    expect(() => normalizeOpenAIOrder({ items: [] })).toThrow(OpenAIRecognitionError)
  })
})
