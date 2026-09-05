import { jsonResponse, readJson, methodNotAllowed } from './http.js'
import { permittedOrder } from './orders.js'
const fail = (error, status = 400) => jsonResponse({ error }, status)
const present = row => ({ id: row.id, orderId: row.order_id, productId: row.product_id, sku: row.sku, barcode: row.barcode, name: row.product_name, address: row.address, suggestedAddress: row.suggested_address, kind: row.kind, note: row.note, status: row.status, author: row.author_name || '', updatedBy: row.updated_name || '', version: row.version, createdAt: row.created_at, updatedAt: row.updated_at })

export async function handleReportsRequest(request, env, user) {
  const url = new URL(request.url)
  if (url.pathname === '/api/reports') {
    if (request.method === 'GET') {
      // Pickers only receive alerts for products in an order assigned to them.
      const orderId = url.searchParams.get('orderId')
      let filter = ''
      let params = []
      if (user.role === 'picker') {
        const order = await permittedOrder(env, user, orderId)
        if (!order) return fail('Выберите назначенный вам заказ.', 403)
        const lines = JSON.parse(order.document_json).lines
        const skus = [...new Set(lines.map(line => line.sku).filter(Boolean))]
        const barcodes = [...new Set(lines.map(line => line.barcode).filter(Boolean))]
        filter = ' AND (r.sku IN (SELECT value FROM json_each(?)) OR r.barcode IN (SELECT value FROM json_each(?)))'
        params = [JSON.stringify(skus), JSON.stringify(barcodes)]
      } else if (user.role === 'replenisher') filter = " AND r.kind = 'missing'"
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
      const status = url.searchParams.get('history') === '1' && user.role === 'admin' ? '1=1' : "r.status NOT IN ('resolved', 'rejected')"
      const rows = await env.DB.prepare(`SELECT r.*, u.display_name AS author_name, updater.display_name AS updated_name FROM reports r LEFT JOIN users u ON u.id = r.author_id LEFT JOIN users updater ON updater.id = r.updated_by WHERE ${status}${filter} ORDER BY r.updated_at DESC LIMIT 100 OFFSET ?`).bind(...params, offset).all()
      return jsonResponse({ items: rows.results.map(present), more: rows.results.length === 100 })
    }
    if (request.method !== 'POST') return methodNotAllowed(['GET', 'POST'])
    const parsed = await readJson(request)
    if (parsed.response) return parsed.response
    const { id, orderId, row, kind, note, suggestedAddress } = parsed.body || {}
    const order = await permittedOrder(env, user, orderId)
    if (!order || user.role === 'replenisher') return fail('Заказ вам не назначен.', 403)
    const item = JSON.parse(order.document_json).lines.find(line => line.row === row)
    if (!item || !['missing', 'moved', 'damaged', 'comment'].includes(kind) || typeof id !== 'string' || !/^[\w-]{16,100}$/.test(id)) return fail('Некорректное сообщение.')
    if (kind === 'moved' && !/^\d{1,2}\.?(?:[A-Z])$/i.test(suggestedAddress || '')) return fail('Укажите новый адрес, например 24.F.')
    const now = new Date().toISOString()
    await env.DB.prepare(`INSERT INTO reports (id, order_id, product_id, sku, barcode, product_name, address, suggested_address, kind, note, author_id, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(id, orderId, item.productId, item.sku, item.barcode, item.name, item.address, typeof suggestedAddress === 'string' ? suggestedAddress.toUpperCase().replace(/^(\d+)\.?([A-Z])$/, '$1.$2') : null, kind, typeof note === 'string' ? note.trim().slice(0, 2000) : '', user.id, user.id, now, now).run()
    const saved = await env.DB.prepare('SELECT * FROM reports WHERE id = ? AND author_id = ?').bind(id, user.id).first()
    if (!saved) return fail('Идентификатор сообщения занят.', 409)
    return jsonResponse({ report: present(saved) }, 201)
  }
  const match = url.pathname.match(/^\/api\/reports\/([\w-]+)$/)
  if (!match) return null
  if (request.method !== 'PATCH') return methodNotAllowed(['PATCH'])
  if (!['admin', 'replenisher'].includes(user.role)) return fail('Обработку выполняет администратор или водитель погрузчика.', 403)
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(match[1]).first()
  if (!row) return fail('Сообщение не найдено.', 404)
  if (['resolved', 'rejected'].includes(row.status)) return fail('Сообщение уже закрыто.', 409)
  if (row.version !== parsed.body.version) return fail('Сообщение уже изменилось. Обновите очередь.', 409)
  const status = parsed.body.status
  if (!['checking-reserve', 'replenishing', 'ready', 'resolved', 'rejected'].includes(status)) return fail('Неизвестный статус.')
  if (user.role === 'replenisher' && (row.kind !== 'missing' || !['checking-reserve', 'replenishing', 'ready'].includes(status))) return fail('Это действие доступно администратору.', 403)
  const now = new Date().toISOString()
  const statements = []
  let product
  if (row.kind === 'moved' && status === 'resolved') {
    if (!row.product_id) return fail('Сначала свяжите товар с каталогом.')
    product = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(row.product_id).first()
    if (!product || parsed.body.productVersion !== product.version) return fail('Карточка изменилась. Проверьте текущий адрес перед подтверждением.', 409)
  }
  const guard = product ? ' AND EXISTS (SELECT 1 FROM products WHERE id = ? AND version = ?)' : ''
  statements.push(env.DB.prepare(`UPDATE reports SET status = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?${guard}`).bind(status, user.id, now, row.id, row.version, ...(product ? [product.id, product.version] : [])))
  if (product) statements.push(env.DB.prepare('UPDATE products SET location = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM reports WHERE id = ? AND version = ? AND updated_by = ?)').bind(row.suggested_address, now, user.id, product.id, product.version, row.id, row.version + 1, user.id))
  statements.push(env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM reports WHERE id = ? AND version = ? AND updated_by = ?)').bind(crypto.randomUUID(), user.id, 'report_updated', 'report', row.id, JSON.stringify({ before: row.status, status, previousAddress: product?.location, address: row.suggested_address }), now, row.id, row.version + 1, user.id))
  const results = await env.DB.batch(statements)
  if (!results[0].meta?.changes) return fail('Конфликт обновления сообщения.', 409)
  return jsonResponse({ report: present(await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(row.id).first()) })
}
