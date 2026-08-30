import { describe, expect, it } from 'vitest'
import { adminSectionFromHash } from './routing'

describe('administrator navigation', () => {
  it('maps administrator hashes to sections', () => {
    expect(adminSectionFromHash('#admin')).toBe('overview')
    expect(adminSectionFromHash('#admin/warehouse')).toBe('warehouse')
    expect(adminSectionFromHash('#admin/products')).toBe('products')
    expect(adminSectionFromHash('#admin/workers')).toBe('workers')
    expect(adminSectionFromHash('#admin/orders')).toBe('orders')
    expect(adminSectionFromHash('#admin/reports')).toBe('reports')
    expect(adminSectionFromHash('#admin/settings')).toBe('settings')
  })

  it('falls back to overview for unknown routes', () => {
    expect(adminSectionFromHash('#admin/unknown')).toBe('overview')
    expect(adminSectionFromHash('#orders')).toBe('overview')
  })
})
