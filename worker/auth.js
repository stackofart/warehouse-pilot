import { createRemoteJWKSet, jwtVerify } from 'jose'
import { jsonResponse } from './http.js'

const roles = new Set(['admin', 'picker'])
const jwksByTeamDomain = new Map()

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
}

function isLocalRequest(request) {
  const hostname = new URL(request.url).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

async function accessIdentity(ctx) {
  if (!ctx?.access?.getIdentity) return null
  try {
    return await ctx.access.getIdentity()
  } catch {
    return null
  }
}

function teamDomain(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    return url.origin
  } catch {
    return ''
  }
}

async function jwtIdentity(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) return { identity: null }
  const issuer = teamDomain(env.TEAM_DOMAIN)
  const audience = typeof env.POLICY_AUD === 'string' ? env.POLICY_AUD.trim() : ''
  if (!issuer || !audience) {
    return { response: jsonResponse({
      error: 'Для проверки Cloudflare Access задайте TEAM_DOMAIN и POLICY_AUD.',
      code: 'access_verification_not_configured',
    }, 503) }
  }
  try {
    let jwks = jwksByTeamDomain.get(issuer)
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
      jwksByTeamDomain.set(issuer, jwks)
    }
    const { payload } = await jwtVerify(token, jwks, { issuer, audience })
    if (typeof payload.email !== 'string' || !payload.email.trim()) throw new Error('Access JWT has no email claim')
    return { identity: { email: payload.email, name: typeof payload.name === 'string' ? payload.name : '' } }
  } catch (reason) {
    console.warn('Cloudflare Access JWT validation failed', reason)
    return { response: jsonResponse({ error: 'Сессия Cloudflare Access недействительна.', code: 'invalid_access_token' }, 401) }
  }
}

function userFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    role: roles.has(row.role) ? row.role : 'picker',
    status: row.status,
  }
}

export async function authenticateRequest(request, env, ctx) {
  if (!env.DB) {
    return { response: jsonResponse({ error: 'Общая база D1 не подключена к Worker.', code: 'database_not_configured' }, 503) }
  }

  let identity = await accessIdentity(ctx)
  const local = isLocalRequest(request)
  if (!identity && !local) {
    const verifiedJwt = await jwtIdentity(request, env)
    if (verifiedJwt.response) return verifiedJwt
    identity = verifiedJwt.identity
  }
  const email = normalizeEmail(identity?.email || (local ? env.DEV_AUTH_EMAIL || 'admin@local.warehouse' : ''))
  if (!email) {
    return { response: jsonResponse({ error: 'Требуется вход через Cloudflare Access.', code: 'authentication_required' }, 401) }
  }

  let row
  try {
    row = await env.DB.prepare('SELECT id, email, display_name, role, status FROM users WHERE email = ? COLLATE NOCASE LIMIT 1').bind(email).first()
  } catch (reason) {
    console.error('User lookup failed', reason)
    return { response: jsonResponse({ error: 'Схема общей базы не подготовлена. Примените D1-миграции.', code: 'database_migration_required' }, 503) }
  }

  if (!row) {
    const bootstrapEmail = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL)
    const mayBootstrap = local || (bootstrapEmail && email === bootstrapEmail)
    if (!mayBootstrap) {
      return { response: jsonResponse({ error: 'У пользователя пока нет доступа к Warehouse Pilot.', code: 'user_not_provisioned' }, 403) }
    }
    const now = new Date().toISOString()
    row = {
      id: crypto.randomUUID(),
      email,
      display_name: identity?.name || (local ? 'Локальный администратор' : email.split('@')[0]),
      role: local && env.DEV_AUTH_ROLE === 'picker' ? 'picker' : 'admin',
      status: 'active',
    }
    await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.id, row.email, row.display_name, row.role, row.status, now, now)
      .run()
  }

  if (row.status !== 'active') {
    return { response: jsonResponse({ error: 'Доступ пользователя приостановлен.', code: 'user_suspended' }, 403) }
  }
  return { user: userFromRow(row) }
}

export function requireAdmin(user) {
  if (user.role === 'admin') return null
  return jsonResponse({ error: 'Эта операция доступна только администратору.', code: 'admin_required' }, 403)
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}
