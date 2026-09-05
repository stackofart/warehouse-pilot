import type { SharedCatalogProduct } from './sharedApi'

export async function uploadProductImage(product: SharedCatalogProduct, file: Blob, fetcher: typeof fetch = fetch) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Фото больше 2 МБ. Уменьшите файл перед загрузкой.')
  const response = await fetcher(`/api/admin/products/${product.id}/image`, { method: 'POST', signal: AbortSignal.timeout(30000), cache: 'no-store', headers: { 'content-type': file.type, 'if-match': String(product.version) }, body: file })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'Не удалось сохранить фото.')
  return body.product as SharedCatalogProduct
}
