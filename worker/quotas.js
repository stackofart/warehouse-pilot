import { jsonResponse } from './http.js'

export async function checkAiQuota(env, user) {
  const now = new Date().toISOString()
  const daily = Math.max(0, Math.min(1000, Number(env.AI_DAILY_REQUEST_LIMIT ?? 20)))
  for (const [bucket, limit] of [[`day:${now.slice(0, 10)}`, daily], [`minute:${now.slice(0, 16)}`, 3]]) {
    if (!limit) return jsonResponse({ error: 'Платные запросы отключены администратором.', code: 'ai_quota_exceeded' }, 429)
    const accepted = await env.DB.prepare('INSERT INTO ai_usage (actor_id, bucket, count) VALUES (?, ?, 1) ON CONFLICT(actor_id, bucket) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(user.id, bucket, limit).first()
    if (!accepted) return jsonResponse({ error: 'Достигнут лимит запросов распознавания/сверки. Повторите позже.', code: 'ai_quota_exceeded' }, 429, { 'retry-after': '60' })
  }
  return null
}
