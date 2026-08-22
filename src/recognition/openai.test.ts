import { describe, expect, it } from 'vitest'
import { OpenAIRecognitionError, normalizeOpenAIOrder } from './openai'

describe('OpenAI order recognition result', () => {
  it('normalizes the structured response for the existing order workflow', () => {
    const result = normalizeOpenAIOrder({
      rawText: 'אישור הזמנה מספר SO26017094',
      confidence: 91.6,
      orderNumber: 'SO 26017094',
      customer: {
        name: 'אמנדיה 100 מרכולים בע״מ',
        address: 'ההגנה 53',
        city: 'הרצליה',
        phone: '052-540-1898',
        customerNumber: '1 2 8 0',
        raw: 'אמנדיה 100 מרכולים בע״מ\nההגנה 53',
      },
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
    expect(result.customer.phone).toBe('0525401898')
    expect(result.customer.customerNumber).toBe('1280')
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
