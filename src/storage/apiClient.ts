export class ApiError extends Error {
  constructor(message: string, public status: number, public code = '') { super(message) }
}
export async function apiRequest<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(path, { ...init, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(30000), headers: { accept: 'application/json', ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) window.dispatchEvent(new Event('warehouse:access-expired'))
    throw new ApiError(body?.error || 'Сервер не ответил корректно.', response.status, body?.code)
  }
  return body as T
}
export function mayUseOfflineCache(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500
}
