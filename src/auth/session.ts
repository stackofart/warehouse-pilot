export type AppRole = 'picker' | 'admin'

export type AuthenticatedUser = {
  id: string
  email: string
  name: string
  role: AppRole
}

export class SessionError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'session_error') {
    super(message)
    this.name = 'SessionError'
    this.status = status
    this.code = code
  }
}

export async function loadSession(fetcher: typeof fetch = fetch): Promise<AuthenticatedUser> {
  const response = await fetcher('/api/me', { headers: { accept: 'application/json' } })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new SessionError(body?.error || 'Не удалось проверить доступ.', response.status, body?.code)
  }
  if (!body?.user || !['admin', 'picker'].includes(body.user.role)) {
    throw new SessionError('Сервис вернул некорректный профиль пользователя.', 502, 'invalid_session')
  }
  return body.user as AuthenticatedUser
}
