export type AppRole = 'picker' | 'admin'

export const APP_ROLE_STORAGE_KEY = 'warehouse-pilot:role'

export function normalizeAppRole(value: unknown): AppRole {
  return value === 'admin' ? 'admin' : 'picker'
}

export function loadAppRole(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AppRole {
  if (!storage) return 'picker'
  try {
    return normalizeAppRole(storage.getItem(APP_ROLE_STORAGE_KEY))
  } catch {
    return 'picker'
  }
}

export function saveAppRole(role: AppRole, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return
  try {
    storage.setItem(APP_ROLE_STORAGE_KEY, role)
  } catch {
    // The selected role still works for the current tab when storage is unavailable.
  }
}
