import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const recognizedOrder = {
  rawText: 'SO26017094',
  confidence: 94,
  orderNumber: 'SO26017094',
  customer: { name: '', address: '', city: '', phone: '', customerNumber: '', raw: '' },
  items: [{
    address: '22.F',
    sku: '5688',
    barcode: '0608614323746',
    description: 'מוצר',
    quantity: '18',
    unitsPerBox: '18',
    boxCount: '1',
    confidence: 94,
  }],
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI recognition Worker', () => {
  it('requires a server-side API key', async () => {
    const request = new Request('https://warehouse.example/api/recognize-order', { method: 'POST' })
    const response = await worker.fetch(request, { ASSETS: { fetch: vi.fn() } })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'openai_not_configured' })
  })

  it('sends the image to the Responses API with a strict schema', async () => {
    const openAIFetch = vi.fn(async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      expect(requestBody.model).toBe('gpt-5.6-luna')
      expect(requestBody.store).toBe(false)
      expect(requestBody.input[0].content[1]).toMatchObject({ type: 'input_image', detail: 'high' })
      expect(requestBody.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/)
      expect(requestBody.text.format).toMatchObject({ type: 'json_schema', strict: true })
      expect(init.headers.authorization).toBe('Bearer test-key')

      return new Response(JSON.stringify({
        model: 'gpt-5.6-luna-2026-08-01',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(recognizedOrder) }] }],
      }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', openAIFetch)

    const formData = new FormData()
    formData.append('image', new Blob(['fake-jpeg'], { type: 'image/jpeg' }), 'order.jpg')
    const request = new Request('https://warehouse.example/api/recognize-order', { method: 'POST', body: formData })
    const response = await worker.fetch(request, {
      OPENAI_API_KEY: 'test-key',
      ASSETS: { fetch: vi.fn() },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      orderNumber: 'SO26017094',
      model: 'gpt-5.6-luna-2026-08-01',
    })
    expect(openAIFetch).toHaveBeenCalledOnce()
  })
})
