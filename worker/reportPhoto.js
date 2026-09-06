import { jsonResponse, methodNotAllowed } from './http.js'

export function decodeReportPhoto(data) {
  if (data === undefined || data === null) return null
  if (typeof data !== 'string' || data.length > 1400000) throw new Error('Фото сообщения должно быть не больше 1 МБ.')
  const match = data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) throw new Error('Выберите фото JPEG, PNG или WebP.')
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
  const hex = [...bytes.slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const valid = match[1] === 'jpeg' ? hex.startsWith('ffd8ff') : match[1] === 'png' ? hex.startsWith('89504e470d0a1a0a') : hex.startsWith('52494646') && hex.slice(16) === '57454250'
  if (!valid || bytes.length > 1024 * 1024) throw new Error('Некорректный файл изображения или размер больше 1 МБ.')
  return { bytes, type: `image/${match[1]}` }
}

export async function readReportPhoto(request, env, user, id) {
  if (request.method !== 'GET') return methodNotAllowed(['GET'])
  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first()
  let allowed = row && (user.role === 'admin' || user.role === 'replenisher' && row.kind === 'missing')
  if (row && user.role === 'picker') {
    allowed = await env.DB.prepare(`SELECT 1 FROM orders o, json_each(o.document_json, '$.lines') line WHERE o.assigned_to = ? AND
      ((? != '' AND json_extract(line.value, '$.sku') = ?) OR (? != '' AND json_extract(line.value, '$.barcode') = ?)) LIMIT 1`)
      .bind(user.id, row.sku, row.sku, row.barcode, row.barcode).first()
  }
  if (!allowed || !row.photo_key) return jsonResponse({ error: 'Фото не найдено или недоступно.' }, 404)
  if (!env.PRODUCT_IMAGES) return jsonResponse({ error: 'Хранилище фото недоступно.' }, 503)
  const image = await env.PRODUCT_IMAGES.get(row.photo_key)
  if (!image) return jsonResponse({ error: 'Фото не найдено.' }, 404)
  return new Response(image.body, { headers: { 'content-type': image.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } })
}
