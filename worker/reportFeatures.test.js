import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import worker from './index.js'
import { testDatabase } from './testDatabase.js'

let database, objects, env
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII='
async function raw(role, path, method = 'GET', body) {
  return worker.fetch(new Request(`https://warehouse.test${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), env, { access: { getIdentity: async () => ({ email: `${role}@test.local` }) } })
}
async function call(role, path, method, body) { const response = await raw(role, path, method, body); return { status: response.status, body: await response.json() } }
beforeEach(async () => {
  database = testDatabase(); objects = new Map()
  env = { DB: database.DB, PRODUCT_IMAGES: {
    async put(key, data, metadata) { objects.set(key, { body: data, ...metadata }) },
    async get(key) { return objects.get(key) },
    async delete(key) { objects.delete(key) },
  } }
  await call('admin', '/api/orders/report-order', 'PUT', { source: 'json', orderNumber: 'QA', lines: [{ sku: '1000', barcode: '7290000000000', name: 'Beer', address: '23.F', quantityUnits: 12, unitsPerBox: 12, boxCount: 1 }] })
  await call('admin', '/api/orders/report-order/assignment', 'PATCH', { version: 1, assignedTo: 'picker' })
})
afterEach(() => database.close())
const input = kind => ({ id: crypto.randomUUID(), orderId: 'report-order', row: 1, kind, note: '', photoDataUrl: png })

describe('private report photos and admin notifications', () => {
  it('stores a photo once on retries and restricts photo access by assignment and role', async () => {
    const body = input('damaged')
    const made = await call('picker', '/api/reports', 'POST', body)
    expect(made.status).toBe(201)
    expect(objects.size).toBe(1)
    expect((await call('picker', '/api/reports', 'POST', body)).status).toBe(201)
    expect(objects.size).toBe(1)
    const url = made.body.report.photoUrl
    for (const role of ['picker', 'admin']) { const response = await raw(role, url); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('content-type')).toBe('image/png') }
    expect((await raw('other', url)).status).toBe(404)
    expect((await raw('driver', url)).status).toBe(404)
    await call('admin', '/api/orders/report-order/assignment', 'PATCH', { version: 2, assignedTo: 'other' })
    expect((await raw('picker', url)).status).toBe(404)
    expect((await raw('other', url)).status).toBe(200)
  })
  it('lets the replenisher see missing-stock evidence and keeps notifications admin-only', async () => {
    expect((await call('picker', '/api/reports/notifications')).status).toBe(403)
    const made = await call('picker', '/api/reports', 'POST', input('missing'))
    expect((await raw('driver', made.body.report.photoUrl)).status).toBe(200)
    const summary = await call('admin', '/api/reports/notifications')
    expect(summary.body).toMatchObject({ total: 1, latest: { id: made.body.report.id, name: 'Beer', kind: 'missing' } })
    await call('admin', `/api/reports/${made.body.report.id}`, 'PATCH', { version: 1, status: 'resolved' })
    expect((await call('admin', '/api/reports/notifications')).body).toEqual({ total: 0, latest: null })
  })
  it('rejects forged/oversized images and never drops the attachment silently when R2 is unavailable', async () => {
    for (const data of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJjZA==', 'x'.repeat(1400001)]) {
      expect((await call('picker', '/api/reports', 'POST', { ...input('damaged'), photoDataUrl: data })).status).toBe(400)
    }
    expect(objects.size).toBe(0)
    env.PRODUCT_IMAGES = undefined
    expect((await call('picker', '/api/reports', 'POST', input('damaged'))).status).toBe(503)
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM reports').get().n).toBe(0)
    expect((await call('picker', '/api/reports', 'POST', { ...input('moved'), suggestedAddress: '24.F', photoDataUrl: undefined })).status).toBe(201)
  })
  it('exports all catalog pages by stable IDs, including full technical cards, for admins only', async () => {
    const statement = database.sqlite.prepare('INSERT INTO products (id, sku, barcode, name, location, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (let i = 0; i < 105; i++) statement.run(`product-${String(i).padStart(3, '0')}`, String(1000 + i), String(7290000000000 + i), 'Beer', '23.F', 'Description', new Date().toISOString(), new Date().toISOString())
    expect((await call('picker', '/api/admin/products/export')).status).toBe(403)
    expect((await call('driver', '/api/admin/products/export')).status).toBe(403)
    const first = (await call('admin', '/api/admin/products/export')).body
    expect(first.items).toHaveLength(100)
    expect(first.items[0].description).toBe('Description')
    const last = (await call('admin', `/api/admin/products/export?cursor=${first.nextCursor}`)).body
    expect(last.items).toHaveLength(5); expect(last.nextCursor).toBeNull()
    expect(new Set([...first.items, ...last.items].map(row => row.id)).size).toBe(105)
  })
})
