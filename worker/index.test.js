import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const recognizedOrder = {
  confidence: 94,
  orderNumber: 'SO26017094',
  summary: { itemCount: '1', totalQuantity: '18', packageCount: '1', totalWeightKg: '2.5' },
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

const researchValue = (value, sourceUrls = ['https://manufacturer.example/product']) => ({
  value,
  confidence: value === null ? 'low' : 'high',
  valueType: value === null ? 'not_found' : 'published',
  sourceUrls: value === null ? [] : sourceUrls,
  note: '',
})

const researchedProduct = {
  identityMatch: 'exact',
  identityConfidence: 97,
  name: researchValue('Milka milk chocolate 90 g'),
  brand: researchValue('Milka'),
  description: researchValue('Milk chocolate'),
  netContent: researchValue('90 g'),
  unit: {
    lengthCm: researchValue(16), widthCm: researchValue(8), heightCm: researchValue(1), grossWeightKg: researchValue(.096),
  },
  casePack: {
    barcode: researchValue(null), unitsPerCase: researchValue(24), lengthCm: researchValue(39), widthCm: researchValue(19), heightCm: researchValue(14), grossWeightKg: researchValue(2.7),
  },
  conflicts: [],
  warnings: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI recognition Worker', () => {
  it('requires a server-side API key', async () => {
    const request = new Request('https://warehouse.example/api/recognize-order', { method: 'POST' })
    const response = await worker.fetch(request, { ASSETS: { fetch: vi.fn() } })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'openai_not_configured' })
  })

  it('sends up to two images to the Responses API with a strict schema', async () => {
    const openAIFetch = vi.fn(async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      expect(requestBody.model).toBe('gpt-5.6-luna')
      expect(requestBody.store).toBe(false)
      expect(requestBody.input[0].content[1]).toMatchObject({ type: 'input_image', detail: 'high' })
      expect(requestBody.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/)
      expect(requestBody.input[0].content[2]).toMatchObject({ type: 'input_image', detail: 'high' })
      expect(requestBody.text.format).toMatchObject({ type: 'json_schema', strict: true })
      expect(init.headers.authorization).toBe('Bearer test-key')

      return new Response(JSON.stringify({
        model: 'gpt-5.6-luna-2026-08-01',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(recognizedOrder) }] }],
      }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', openAIFetch)

    const formData = new FormData()
    formData.append('images', new Blob(['fake-jpeg'], { type: 'image/jpeg' }), 'order-1.jpg')
    formData.append('images', new Blob(['fake-jpeg-2'], { type: 'image/jpeg' }), 'order-2.jpg')
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

describe('OpenAI product research Worker', () => {
  it('rejects an invalid barcode before spending an API call', async () => {
    const openAIFetch = vi.fn()
    vi.stubGlobal('fetch', openAIFetch)
    const request = new Request('https://warehouse.example/api/research-product', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ barcode: '12345678' }),
    })

    const response = await worker.fetch(request, { OPENAI_API_KEY: 'test-key', ASSETS: { fetch: vi.fn() } })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_barcode' })
    expect(openAIFetch).not.toHaveBeenCalled()
  })

  it('forces a bounded web search and returns only consulted source URLs', async () => {
    const openAIFetch = vi.fn(async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      expect(requestBody.model).toBe('gpt-5.6-terra')
      expect(requestBody.tool_choice).toBe('required')
      expect(requestBody.max_tool_calls).toBe(4)
      expect(requestBody.tools).toEqual([{ type: 'web_search', search_context_size: 'medium', external_web_access: true }])
      expect(requestBody.include).toContain('web_search_call.action.sources')
      expect(requestBody.text.format).toMatchObject({ type: 'json_schema', strict: true })

      const output = structuredClone(researchedProduct)
      output.unit.lengthCm.sourceUrls.push('https://invented.example/not-consulted')
      return new Response(JSON.stringify({
        model: 'gpt-5.6-terra',
        output: [
          { type: 'web_search_call', action: { sources: [{ url: 'https://manufacturer.example/product', title: 'Manufacturer product' }] } },
          { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] },
        ],
      }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', openAIFetch)
    const request = new Request('https://warehouse.example/api/research-product', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ barcode: '7290121920285', knownProduct: { name: 'Milka' } }),
    })

    const response = await worker.fetch(request, { OPENAI_API_KEY: 'test-key', ASSETS: { fetch: vi.fn() } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.barcode).toBe('7290121920285')
    expect(body.unit.lengthCm.sourceUrls).toEqual(['https://manufacturer.example/product'])
    expect(body.sources).toEqual([{ url: 'https://manufacturer.example/product', title: 'Manufacturer product' }])
    expect(openAIFetch).toHaveBeenCalledOnce()
  })
})
