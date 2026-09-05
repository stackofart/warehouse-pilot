import { describe, expect, it } from 'vitest'
import { adminHash, adminSectionFromHash } from './routing'

describe('administrator navigation', () => {
  it('keeps legacy order links and pallet navigation within the administrator shell', () => {
    expect(adminHash('#work/order-1')).toBe('#admin/orders/order-1')
    expect(adminHash('#route/order-1')).toBe('#admin/orders/order-1')
    expect(adminHash('#pallet/order-1')).toBe('#admin/pallet/order-1')
    expect(adminSectionFromHash('#admin/orders/order-1')).toBe('orders')
    expect(adminSectionFromHash('#admin/pallet/order-1')).toBe('pallet')
  })
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
