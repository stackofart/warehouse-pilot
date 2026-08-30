import { describe, expect, it, vi } from 'vitest'
import { APP_ROLE_STORAGE_KEY, loadAppRole, normalizeAppRole, saveAppRole } from './roles'

describe('application roles', () => {
  it('accepts only the administrator role explicitly', () => {
    expect(normalizeAppRole('admin')).toBe('admin')
    expect(normalizeAppRole('picker')).toBe('picker')
    expect(normalizeAppRole('owner')).toBe('picker')
    expect(normalizeAppRole(null)).toBe('picker')
  })

  it('loads a saved role and safely falls back to picker', () => {
    expect(loadAppRole({ getItem: () => 'admin' })).toBe('admin')
    expect(loadAppRole({ getItem: () => 'unknown' })).toBe('picker')
    expect(loadAppRole({ getItem: () => { throw new Error('blocked') } })).toBe('picker')
  })

  it('stores the selected role under a stable key', () => {
    const setItem = vi.fn()
    saveAppRole('admin', { setItem })
    expect(setItem).toHaveBeenCalledWith(APP_ROLE_STORAGE_KEY, 'admin')
  })
})
