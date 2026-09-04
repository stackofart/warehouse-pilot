import { SharedApiError } from '../products/sharedApi'

export type ManagedUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'picker'
  status: 'active' | 'suspended'
  createdAt: string
  updatedAt: string
}

async function request<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(path, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new SharedApiError(body?.error || 'Не удалось изменить доступ.', response.status, body?.code)
  return body as T
}

export async function listManagedUsers(fetcher: typeof fetch = fetch) {
  return (await request<{ items: ManagedUser[] }>('/api/admin/users', undefined, fetcher)).items
}

export async function addManagedUser(input: { email: string; name: string; role: 'admin' | 'picker' }, fetcher: typeof fetch = fetch) {
  return (await request<{ user: ManagedUser }>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) }, fetcher)).user
}

export async function updateManagedUser(id: string, input: Partial<Pick<ManagedUser, 'role' | 'status'>>, fetcher: typeof fetch = fetch) {
  return (await request<{ user: ManagedUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }, fetcher)).user
}
