import { permittedOrder } from './orders.js'
import { jsonResponse, readJson, methodNotAllowed } from './http.js'
const present = row => row ? { placements: JSON.parse(row.document_json), version: row.version } : { placements: [], version: 0 }
export async function handlePalletsRequest(request, env, user) {
  const match = new URL(request.url).pathname.match(/^\/api\/orders\/([\w-]{1,100})\/pallet$/)
  if (!match) return null
  const order = await permittedOrder(env, user, match[1])
  if (!order) return jsonResponse({ error: 'Заказ недоступен.' }, 404)
  const current = await env.DB.prepare('SELECT * FROM pallet_states WHERE order_id = ?').bind(order.id).first()
  if (request.method === 'GET') return jsonResponse(present(current))
  if (request.method !== 'PUT') return methodNotAllowed(['GET', 'PUT'])
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const { placements, version, mutationId } = parsed.body || {}
  if (typeof mutationId !== 'string' || !/^[\w-]{16,100}$/.test(mutationId)) return jsonResponse({ error: 'Нужен ID операции.' }, 400)
  if (current?.last_mutation_id === mutationId) return jsonResponse(present(current))
  if ((current?.version || 0) !== version || order.status === 'completed') return jsonResponse({ error: 'Компоновка изменена другим пользователем или заказ завершён. Обновите данные.' }, 409)
  const rows = new Set(JSON.parse(order.document_json).lines.map(line => line.row))
  if (!Array.isArray(placements) || placements.length > 1000 || new Set(placements.map(p => p?.id)).size !== placements.length || placements.some(p => !p || typeof p.id !== 'string' || !rows.has(p.orderRow) || !Number.isInteger(p.palletIndex) || p.palletIndex < 0 || p.palletIndex > 999 || ['x','y','z','lengthCm','widthCm','heightCm','weightKg'].some(key => !Number.isFinite(p[key]) || p[key] < 0) || p.lengthCm <= 0 || p.widthCm <= 0 || p.heightCm <= 0 || p.x + p.lengthCm > 120.001 || p.y + p.widthCm > 80.001 || p.z + p.heightCm > 300 || JSON.stringify(p).length > 4000)) return jsonResponse({ error: 'Некорректные координаты коробок.' }, 400)
  const now = new Date().toISOString()
  const condition = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND version = ? AND (assigned_to = ? OR ? = 1))'
  const guard = [order.id, order.version, user.id, Number(user.role === 'admin')]
  const statement = current
    ? env.DB.prepare(`UPDATE pallet_states SET document_json = ?, version = version + 1, last_mutation_id = ?, updated_by = ?, updated_at = ? WHERE order_id = ? AND version = ? AND ${condition}`).bind(JSON.stringify(placements), mutationId, user.id, now, order.id, version, ...guard)
    : env.DB.prepare(`INSERT INTO pallet_states (order_id, document_json, last_mutation_id, updated_by, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${condition} ON CONFLICT(order_id) DO NOTHING`).bind(order.id, JSON.stringify(placements), mutationId, user.id, now, ...guard)
  const results = await env.DB.batch([statement, env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pallet_states WHERE order_id = ? AND last_mutation_id = ?)').bind(crypto.randomUUID(), user.id, 'pallet_updated', 'order', order.id, JSON.stringify({ boxCount: placements.length, version: version + 1 }), now, order.id, mutationId)])
  if (!results[0].meta?.changes) return jsonResponse({ error: 'Назначение или компоновка изменились.' }, 409)
  return jsonResponse({ placements, version: version + 1 })
}
