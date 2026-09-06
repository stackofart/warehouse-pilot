import { apiRequest } from '../storage/apiClient'
import type { Product } from './storage'
import { createProductDocument } from './transfer'

/** Export every page, irrespective of the visible search or pagination. */
export async function exportSharedCatalog(onProgress: (count: number) => void = () => {}, fetcher: typeof fetch = fetch) {
  const products: Product[] = []
  let cursor = ''
  do {
    const result = await apiRequest<{ items: Product[]; nextCursor: string | null }>(`/api/admin/products/export?cursor=${encodeURIComponent(cursor)}`, undefined, fetcher)
    for (const product of result.items) {
      const { imageUrl, ...card } = product
      if (imageUrl) {
        // Embed private R2 photos so the file remains usable on another device.
        if (!imageUrl.startsWith('/api/catalog/products/')) throw new Error('Неизвестный адрес фото товара.')
        const response = await fetcher(imageUrl, { cache: 'no-store', signal: AbortSignal.timeout(30000) })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Не удалось скачать фото «${product.name}». Повторите экспорт.`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        card.imageDataUrl = `data:${response.headers.get('content-type')!.split(';')[0]};base64,${btoa(binary)}`
      }
      products.push(card)
      onProgress(products.length)
    }
    if (result.nextCursor && result.nextCursor <= cursor) throw new Error('Ошибка пагинации экспорта. Повторите скачивание.')
    cursor = result.nextCursor || ''
  } while (cursor)
  return createProductDocument(products)
}
