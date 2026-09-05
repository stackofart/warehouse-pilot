import { describe, expect, it, vi } from 'vitest'
import { loadSession } from './session'

describe('server session', () => {
  it('loads the authenticated role from the server', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ user: { id: 'u1', email: 'a@example.com', name: 'Admin', role: 'admin' } }), { status: 200 })) as unknown as typeof fetch
    await expect(loadSession(fetcher)).resolves.toMatchObject({ role: 'admin', email: 'a@example.com' })
  })

  it('keeps the server error code', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'Нет доступа', code: 'user_not_provisioned' }), { status: 403 })) as unknown as typeof fetch
    await expect(loadSession(fetcher)).rejects.toMatchObject({ status: 403, code: 'user_not_provisioned' })
  })
})
