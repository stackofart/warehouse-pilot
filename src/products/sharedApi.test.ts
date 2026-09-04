import { describe, expect, it, vi } from 'vitest'
import type { Product } from './storage'
import { importSharedProducts, matchSharedProducts, productForSharedImport, searchSharedCatalog } from './sharedApi'

describe('shared catalog api', () => {
  it('encodes a picker search and returns only the result list', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'p1', name: 'Milk' }], limit: 20 }), { status: 200 })) as unknown as typeof fetch
    await expect(searchSharedCatalog('24 F', fetcher)).resolves.toEqual([{ id: 'p1', name: 'Milk' }])
    expect(fetcher).toHaveBeenCalledWith('/api/catalog/search?q=24%20F', expect.anything())
  })

  it('converts an exact shared match into a reconciliation product', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'p1', sku: '1112', barcode: '7290121920100', name: 'Coffee', location: '24.F', updatedAt: '2026-08-30T00:00:00.000Z' }] }), { status: 200 })) as unknown as typeof fetch
    const [product] = await matchSharedProducts([{ barcode: '7290121920100' }], fetcher)
    expect(product.createdAt).toBe(product.updatedAt)
  })

  it('does not send device-local images and research traces to D1', () => {
    const product = {
      id: 'p1',
      sku: '1112',
      barcode: '7290121920100',
      name: 'Coffee',
      location: '24.F',
      imageDataUrl: `data:image/jpeg;base64,${'x'.repeat(1000)}`,
      research: { deliberatelyLarge: 'trace' },
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    } as unknown as Product

    const projected = productForSharedImport(product)

    expect(projected).not.toHaveProperty('imageDataUrl')
    expect(projected).not.toHaveProperty('research')
    expect(projected).not.toHaveProperty('createdAt')
    expect(projected).not.toHaveProperty('updatedAt')
    expect(projected).toMatchObject({ id: 'p1', barcode: '7290121920100', location: '24.F' })
  })

  it('imports large local catalogs in bounded batches and aggregates row errors', async () => {
    const products = Array.from({ length: 51 }, (_, index) => ({
      id: `p${index}`,
      sku: String(1000 + index),
      barcode: `729012192${String(index).padStart(3, '0')}`,
      name: `Product ${index}`,
      location: '24.F',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    })) as Product[]
    const fetcher = vi.fn(async (_path, init) => {
      const batch = JSON.parse(String(init?.body)).products
      return new Response(JSON.stringify({
        created: batch.length - 1,
        updated: 0,
        skipped: 1,
        errors: [{ index: batch.length - 1, error: 'invalid' }],
      }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(importSharedProducts(products, fetcher)).resolves.toEqual({
      created: 49,
      updated: 0,
      skipped: 2,
      errors: [{ index: 49, error: 'invalid' }, { index: 50, error: 'invalid' }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).products).toHaveLength(50)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).products).toHaveLength(1)
  })
})
