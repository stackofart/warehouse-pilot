import { jsonResponse, readJson, methodNotAllowed } from './http.js'
import { findProducts } from './catalog.js'
import { normalizeOrderDocument } from '../shared/order-model.js'

const publicOrder = row => ({ ...JSON.parse(row.document_json), id: row.id, orderNumber: row.order_number, assignedTo: row.assigned_to, assigneeName: row.assignee_name || '', status: row.status, version: row.version, source: row.source, externalId: row.external_id, createdAt: row.created_at, updatedAt: row.updated_at })
const fail = (error, status = 400) => jsonResponse({ error, code: status === 409 ? 'version_conflict' : 'invalid_order' }, status)
const sessionFromRow = row => row ? { ...JSON.parse(row.document_json), serverVersion: row.version, syncStatus: 'synced' } : null

export async function permittedOrder(env, user, id) {
  const row = await env.DB.prepare('SELECT o.*, u.display_name AS assignee_name FROM orders o LEFT JOIN users u ON u.id = o.assigned_to WHERE o.id = ?').bind(id).first()
  return row && (user.role === 'admin' || user.role === 'picker' && row.assigned_to === user.id) ? row : null
}

async function saveOrder(request, env, user, id) {
  if (user.role !== 'admin') return fail('Заказы добавляет администратор.', 403)
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const input = parsed.body
  let document
  try { document = normalizeOrderDocument(input) } catch (error) { return fail(error.message) }
  const existing = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()
  if (existing && (existing.status !== 'unassigned' || input.version !== existing.version)) return fail('Заказ уже назначен или изменён. Обновите список.', 409)
  const products = await findProducts(env, document.lines)
  for (const line of document.lines) {
    const byBarcode = products.find(p => p.barcode === line.barcode)
    const bySku = products.find(p => p.sku === line.sku)
    if (byBarcode && bySku && byBarcode.id !== bySku.id) return fail(`Позиция ${line.row}: макат и штрихкод относятся к разным товарам.`)
    const product = byBarcode || bySku
    line.productId = product?.id || null
    line.productSnapshot = product || null
  }
  const now = new Date().toISOString()
  const source = ['photo', 'manual', 'json', 'legacy', 'wms1'].includes(input.source) ? input.source : 'manual'
  const externalId = typeof input.externalId === 'string' ? input.externalId.slice(0, 200) : null
  const statement = existing
    ? env.DB.prepare("UPDATE orders SET order_number = ?, document_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'unassigned'").bind(document.orderNumber, JSON.stringify(document), now, id, existing.version)
    : env.DB.prepare('INSERT INTO orders (id, order_number, document_json, source, external_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, document.orderNumber, JSON.stringify(document), source, externalId, user.id, now, now)
  try {
    const result = await statement.run()
    if (result.meta?.changes === 0) return fail('Конфликт изменения заказа.', 409)
  } catch { return fail('Заказ с таким идентификатором источника уже существует.', 409) }
  return jsonResponse({ order: publicOrder(await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()) }, existing ? 200 : 201)
}

async function saveSession(request, env, user, order) {
  if (user.role !== 'picker' || order.assigned_to !== user.id) return fail('Сборку выполняет назначенный комплектовщик. Администратору доступен просмотр прогресса.', 403)
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const { session, expectedVersion, mutationId } = parsed.body || {}
  if (typeof mutationId !== 'string' || !/^[\w-]{16,100}$/.test(mutationId)) return fail('Нужен идентификатор операции.')
  const receipt = await env.DB.prepare('SELECT response_json FROM operation_receipts WHERE id = ? AND actor_id = ? AND entity_id = ?').bind(mutationId, user.id, order.id).first()
  if (receipt) return jsonResponse(JSON.parse(receipt.response_json))
  const previous = await env.DB.prepare('SELECT * FROM picking_sessions WHERE order_id = ?').bind(order.id).first()
  if ((previous?.version || 0) !== expectedVersion) return fail('Прогресс изменён на другом устройстве. Локальные изменения сохранены для разрешения конфликта.', 409)
  if (previous && JSON.parse(previous.document_json).status === 'completed') return fail('Заказ уже завершён.', 409)
  const document = JSON.parse(order.document_json)
  if (!session || session.orderId !== order.id || !['in-progress', 'paused', 'completed'].includes(session.status) || !['fast', 'route'].includes(session.mode)) return fail('Некорректная сессия сборки.')
  const rows = document.lines.map(line => String(line.row))
  if (Object.keys(session.items || {}).length !== rows.length || rows.some(row => !['pending', 'checking', 'picked', 'missing'].includes(session.items?.[row]?.status))) return fail('Состав сборки не соответствует заказу.')
  if (!Array.isArray(session.events) || session.events.length > 10000 || !Number.isFinite(Date.parse(session.startedAt))) return fail('Некорректный журнал событий.')
  if (session.status === 'completed' && (rows.some(row => ['pending', 'checking'].includes(session.items[row].status)) || !Number.isFinite(Date.parse(session.completedAt)))) return fail('Перед завершением обработайте позиции и проверки.')
  const old = previous ? JSON.parse(previous.document_json) : null
  const oldEvents = old?.events || []
  if (session.events.length < oldEvents.length || oldEvents.some((event, i) => event.id !== session.events[i]?.id)) return fail('История событий не может быть удалена.', 409)
  const now = new Date().toISOString()
  const events = [...oldEvents, ...session.events.slice(oldEvents.length).map(event => ({ ...event, actorId: user.id, recordedAt: now }))]
  const next = { ...session, events, actorId: user.id, serverVersion: expectedVersion + 1, syncStatus: 'synced' }
  delete next.localRevision
  const resultBody = { session: next }
  const json = JSON.stringify(next)
  if (json.length > 500000) return fail('Слишком большой журнал заказа.', 413)
  // Assignment and session revision are checked in the write itself, not only by a prior SELECT.
  const condition = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND version = ? AND assigned_to = ?)'
  const values = [order.id, order.version, user.id]
  const write = previous
    ? env.DB.prepare(`UPDATE picking_sessions SET document_json = ?, version = version + 1, last_mutation_id = ?, updated_by = ?, updated_at = ? WHERE order_id = ? AND version = ? AND ${condition}`).bind(json, mutationId, user.id, now, order.id, expectedVersion, ...values)
    : env.DB.prepare(`INSERT INTO picking_sessions (order_id, document_json, last_mutation_id, updated_by, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${condition} ON CONFLICT(order_id) DO NOTHING`).bind(order.id, json, mutationId, user.id, now, ...values)
  const guard = 'EXISTS (SELECT 1 FROM picking_sessions WHERE order_id = ? AND last_mutation_id = ?)'
  const statements = [write,
    env.DB.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND ${guard}`).bind(next.status, now, order.id, order.id, mutationId),
    env.DB.prepare(`INSERT INTO operation_receipts (id, actor_id, entity_id, response_json, created_at) SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(mutationId, user.id, order.id, JSON.stringify(resultBody), now, order.id, mutationId),
    env.DB.prepare(`INSERT INTO picking_events (id, order_id, actor_id, event_json, recorded_at) SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(mutationId, order.id, user.id, JSON.stringify(events.slice(oldEvents.length)), now, order.id, mutationId),
  ]
  const result = await env.DB.batch(statements)
  if (!result[0].meta?.changes) return fail('Назначение или прогресс заказа изменились.', 409)
  return jsonResponse(resultBody)
}

export async function handleOrdersRequest(request, env, user) {
  const url = new URL(request.url)
  if (url.pathname === '/api/picking-sessions') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    if (user.role === 'replenisher') return jsonResponse({ items: [], more: false })
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))
    const where = user.role === 'admin' ? '' : 'WHERE o.assigned_to = ?'
    const rows = await env.DB.prepare(`SELECT s.* FROM picking_sessions s JOIN orders o ON o.id = s.order_id ${where} ORDER BY s.updated_at DESC, s.order_id LIMIT 50 OFFSET ?`).bind(...(user.role === 'admin' ? [] : [user.id]), offset).all()
    return jsonResponse({ items: rows.results.map(sessionFromRow), more: rows.results.length === 50 })
  }
  if (url.pathname === '/api/orders') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    if (user.role === 'replenisher') return jsonResponse({ items: [], more: false })
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
    const where = user.role === 'admin' ? '' : 'WHERE o.assigned_to = ?'
    const rows = await env.DB.prepare(`SELECT o.*, u.display_name AS assignee_name FROM orders o LEFT JOIN users u ON u.id = o.assigned_to ${where} ORDER BY o.updated_at DESC, o.id LIMIT 100 OFFSET ?`).bind(...(user.role === 'admin' ? [] : [user.id]), offset).all()
    return jsonResponse({ items: rows.results.map(publicOrder), more: rows.results.length === 100 })
  }
  const match = url.pathname.match(/^\/api\/orders\/([\w-]{1,100})(?:\/(assignment|session))?$/)
  if (!match) return null
  const [, id, action] = match
  if (!action && request.method === 'PUT') return saveOrder(request, env, user, id)
  const order = await permittedOrder(env, user, id)
  if (!order) return fail('Заказ не найден или не назначен вам.', 404)
  if (action === 'assignment') {
    if (user.role !== 'admin') return fail('Назначение доступно администратору.', 403)
    if (request.method !== 'PATCH') return methodNotAllowed(['PATCH'])
    const parsed = await readJson(request)
    if (parsed.response) return parsed.response
    const { assignedTo, version } = parsed.body || {}
    if (order.status === 'completed' || order.version !== version) return fail('Заказ завершён или изменён.', 409)
    if (assignedTo) {
      const picker = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'picker' AND operational_role IS NULL AND status = 'active'").bind(assignedTo).first()
      if (!picker) return fail('Выберите активного комплектовщика.')
    }
    const status = ['in-progress', 'paused'].includes(order.status) ? order.status : assignedTo ? 'assigned' : 'unassigned'
    const result = await env.DB.prepare('UPDATE orders SET assigned_to = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(assignedTo || null, status, new Date().toISOString(), id, version).run()
    if (!result.meta?.changes) return fail('Заказ изменился.', 409)
    await env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'order_assigned', 'order', id, JSON.stringify({ before: order.assigned_to, after: assignedTo }), new Date().toISOString()).run()
    return jsonResponse({ order: publicOrder(await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()) })
  }
  if (action === 'session') {
    if (request.method === 'PUT') return saveSession(request, env, user, order)
    if (request.method === 'GET') return jsonResponse({ session: sessionFromRow(await env.DB.prepare('SELECT * FROM picking_sessions WHERE order_id = ?').bind(id).first()) })
    return methodNotAllowed(['GET', 'PUT'])
  }
  return request.method === 'GET' ? jsonResponse({ order: publicOrder(order) }) : methodNotAllowed(['GET', 'PUT'])
}
