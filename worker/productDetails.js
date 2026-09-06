import { jsonResponse, methodNotAllowed, readJson } from './http.js'
import { productFromRow } from './catalog.js'

export async function handleProductDetails(request, env, user) {
  const match = new URL(request.url).pathname.match(/^\/api\/(admin|catalog)\/products\/([\w-]+)(?:\/(image))?$/)
  if (!match) return null
  const [, scope, id, image] = match
  if (id === 'import' || id === 'export') return null
  if ((scope === 'admin' || request.method !== 'GET') && user.role !== 'admin') return jsonResponse({ error: 'Нужны права администратора.' }, 403)
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!row) return jsonResponse({ error: 'Товар не найден.' }, 404)
  if (image) {
    if (!env.PRODUCT_IMAGES) return jsonResponse({ error: 'Подключите хранилище R2: PRODUCT_IMAGES.' }, 503)
    if (request.method === 'GET') {
      const object = row.image_key ? await env.PRODUCT_IMAGES.get(row.image_key) : null
      if (!object) return jsonResponse({ error: 'Фото не загружено.' }, 404)
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
    }
    if (request.method !== 'POST') return methodNotAllowed(['GET', 'POST'])
    if (Number(request.headers.get('if-match')) !== row.version) return jsonResponse({ error: 'Карточка изменилась.' }, 409)
    const type = request.headers.get('content-type')?.split(';')[0]
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return jsonResponse({ error: 'Выберите JPEG, PNG или WebP.' }, 400)
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength > 2 * 1024 * 1024) return jsonResponse({ error: 'Максимум 2 МБ на фото.' }, 413)
    const key = `products/${id}/${crypto.randomUUID()}`
    await env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: type } })
    const result = await env.DB.prepare('UPDATE products SET image_key = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?').bind(key, new Date().toISOString(), user.id, id, row.version).run()
    if (!result.meta?.changes) { await env.PRODUCT_IMAGES.delete(key); return jsonResponse({ error: 'Конфликт изменения фото.' }, 409) }
  } else if (request.method === 'PATCH') {
    const parsed = await readJson(request)
    if (parsed.response) return parsed.response
    if (parsed.body.version !== row.version) return jsonResponse({ error: 'Карточка изменена другим пользователем. Обновите данные.' }, 409)
    const fields = { name: 'name', location: 'location', description: 'description', brand: 'brand', netContent: 'net_content', caseBarcode: 'case_barcode', unitsPerBox: 'units_per_box', rigidity: 'rigidity', fragility: 'fragility', verificationStatus: 'verification_status' }
    const changes = {}
    for (const [key, column] of Object.entries(fields)) if (Object.hasOwn(parsed.body, key)) changes[column] = parsed.body[key]
    for (const [key, prefix] of [['itemSpec', 'item'], ['boxSpec', 'box']]) for (const [field, column] of Object.entries({ lengthCm: 'length_cm', widthCm: 'width_cm', heightCm: 'height_cm', weightKg: 'weight_kg', ...(key === 'boxSpec' ? { maxTopLoadKg: 'max_top_load_kg' } : {}) })) if (Object.hasOwn(parsed.body[key] || {}, field)) changes[`${prefix}_${column}`] = parsed.body[key][field]
    for (const [key, value] of Object.entries(changes)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0) || typeof value === 'string' && value.length > 4000 || value !== null && !['number', 'string'].includes(typeof value)) return jsonResponse({ error: `Некорректное поле ${key}.` }, 400)
    }
    if (changes.location !== undefined && !/^\d{1,2}\.[A-Z]$/i.test(changes.location)) return jsonResponse({ error: 'Адрес в формате 24.F.' }, 400)
    if (changes.location) changes.location = changes.location.toUpperCase()
    const metadata = JSON.parse(row.metadata_json || '{}')
    for (const key of ['technicalDataSource', 'technicalVerificationStatus', 'identificationNotes', 'packagingColor', 'variant']) if (Object.hasOwn(parsed.body, key)) metadata[key] = parsed.body[key]
    changes.metadata_json = JSON.stringify(metadata)
    changes.updated_by = user.id; changes.updated_at = new Date().toISOString()
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE products SET ${Object.keys(changes).map(key => `${key} = ?`).join(',')}, version = version + 1 WHERE id = ? AND version = ?`).bind(...Object.values(changes), id, row.version),
      env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND version = ? AND updated_by = ?)').bind(crypto.randomUUID(), user.id, 'product_updated', 'product', id, JSON.stringify({ before: productFromRow(row), changes }), changes.updated_at, id, row.version + 1, user.id),
    ])
    if (!results[0].meta?.changes) return jsonResponse({ error: 'Конфликт изменения карточки.' }, 409)
  } else if (request.method !== 'GET') return methodNotAllowed(['GET', 'PATCH'])
  return jsonResponse({ product: productFromRow(await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first()) })
}
