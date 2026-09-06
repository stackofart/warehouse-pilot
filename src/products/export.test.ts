import { describe, expect, it, vi } from 'vitest'
import { exportSharedCatalog } from './export'
import { parseProductDocument } from './transfer'

describe('shared product download', () => {
  it('exports every page, embeds private images and produces an importable document', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/image')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
      const second = String(url).endsWith('cursor=a')
      return Response.json({ items: [{ id: second ? 'b' : 'a', sku: '1000', barcode: '7290000000000', name: 'Beer', location: '23.F', description: 'Details', boxSpec: { weightKg: 10 }, ...(second ? {} : { imageUrl: '/api/catalog/products/a/image' }) }], nextCursor: second ? null : 'a' })
    }) as typeof fetch
    const progress: number[] = []
    const document = await exportSharedCatalog(n => progress.push(n), fetcher)
    expect(document.products).toHaveLength(2)
    expect(document.products[0]).toMatchObject({ description: 'Details', boxSpec: { weightKg: 10 }, imageDataUrl: 'data:image/jpeg;base64,AQID' })
    expect(document.products[0]).not.toHaveProperty('imageUrl')
    expect(document.products[0]).not.toHaveProperty('id')
    expect(progress).toEqual([1, 2])
    expect(parseProductDocument(JSON.stringify(document)).products).toHaveLength(2)
  })
  it('fails explicitly instead of producing a silently incomplete photo backup', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/image') ? new Response(null, { status: 404 }) : Response.json({ items: [{ name: 'Beer', imageUrl: '/api/catalog/products/a/image' }], nextCursor: null })) as typeof fetch
    await expect(exportSharedCatalog(undefined, fetcher)).rejects.toThrow('Не удалось скачать фото')
  })
})
