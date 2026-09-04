import { jsonResponse, methodNotAllowed, readJson } from './http.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const publicRow = (row) => ({
  id: row.id,
  email: row.email,
  name: row.display_name,
  role: row.role,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function handleUsersRequest(request, env, actor) {
  const url = new URL(request.url)
  if (url.pathname === '/api/admin/users') {
    if (request.method === 'GET') {
      const result = await env.DB.prepare('SELECT id, email, display_name, role, status, created_at, updated_at FROM users ORDER BY display_name, email LIMIT 250').all()
      return jsonResponse({ items: result.results.map(publicRow) })
    }
    if (request.method === 'POST') {
      const parsed = await readJson(request)
      if (parsed.response) return parsed.response
      const email = typeof parsed.body?.email === 'string' ? parsed.body.email.trim().toLocaleLowerCase() : ''
      const name = typeof parsed.body?.name === 'string' ? parsed.body.name.trim().slice(0, 160) : ''
      const role = parsed.body?.role === 'admin' ? 'admin' : 'picker'
      if (!emailPattern.test(email)) return jsonResponse({ error: 'Укажите корректный email.', code: 'invalid_email' }, 400)
      const now = new Date().toISOString()
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1').bind(email).first()
      if (existing) return jsonResponse({ error: 'Пользователь с таким email уже существует.', code: 'user_conflict' }, 409)
      const row = { id: crypto.randomUUID(), email, display_name: name || email.split('@')[0], role, status: 'active', created_at: now, updated_at: now }
      await env.DB.prepare('INSERT INTO users (id, email, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(row.id, row.email, row.display_name, row.role, row.status, row.created_at, row.updated_at).run()
      await env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), actor.id, 'user_created', 'user', row.id, JSON.stringify({ email, role }), now).run()
      return jsonResponse({ user: publicRow(row) }, 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const match = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (!match) return null
  if (request.method !== 'PATCH') return methodNotAllowed(['PATCH'])
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const role = parsed.body?.role === 'admin' ? 'admin' : parsed.body?.role === 'picker' ? 'picker' : null
  const status = parsed.body?.status === 'suspended' ? 'suspended' : parsed.body?.status === 'active' ? 'active' : null
  if (!role && !status) return jsonResponse({ error: 'Не указано допустимое изменение пользователя.', code: 'invalid_user_update' }, 400)
  if (match[1] === actor.id && status === 'suspended') return jsonResponse({ error: 'Нельзя приостановить собственный доступ.', code: 'self_suspend_forbidden' }, 409)
  const existing = await env.DB.prepare('SELECT id, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1').bind(match[1]).first()
  if (!existing) return jsonResponse({ error: 'Пользователь не найден.', code: 'user_not_found' }, 404)
  if (existing.id === actor.id && role && role !== existing.role) return jsonResponse({ error: 'Нельзя изменить собственную роль.', code: 'self_role_change_forbidden' }, 409)
  const now = new Date().toISOString()
  await env.DB.prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(role || existing.role, status || existing.status, now, existing.id).run()
  const updated = { ...existing, role: role || existing.role, status: status || existing.status, updated_at: now }
  await env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), actor.id, 'user_updated', 'user', existing.id, JSON.stringify({ role: updated.role, status: updated.status }), now).run()
  return jsonResponse({ user: publicRow(updated) })
}
