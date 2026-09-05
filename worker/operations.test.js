import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import worker from './index.js'
import { testDatabase } from './testDatabase.js'
import { createFulfillmentSession, updateFulfillmentItem, updateFulfillmentItemNote, completeFastFulfillmentSession } from '../src/fulfillment/workflow'

let database
beforeEach(() => { database = testDatabase() })
afterEach(() => database.close())
async function call(role, path, method = 'GET', body) {
  const response = await worker.fetch(new Request(`https://warehouse.test${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }), { DB: database.DB }, { access: { getIdentity: async () => ({ email: `${role}@test.local` }) } })
  return { status: response.status, body: await response.json() }
}
const product = { sku: '1000', barcode: '7290000000000', name: 'Beer', location: '23.F', description: 'Original description', unitsPerBox: 12, boxSpec: { lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 10, maxTopLoadKg: 25 }, technicalDataSource: 'simulated', technicalVerificationStatus: 'unverified', verificationStatus: 'verified' }
async function setupOrder() {
  expect((await call('admin', '/api/admin/products', 'POST', product)).status).toBe(201)
  const made = await call('admin', '/api/orders/test-order', 'PUT', { orderNumber: 'SO1', source: 'json', lines: [{ id: '1', sku: product.sku, barcode: product.barcode, name: product.name, address: product.location, quantityUnits: 24, unitsPerBox: 12, boxCount: 2 }] })
  expect(made.status).toBe(201)
  expect((await call('admin', '/api/orders/test-order/assignment', 'PATCH', { assignedTo: 'picker', version: 1 })).status).toBe(200)
  return made.body.order
}
describe('operations with real SQLite schema and D1 parameter limits', () => {
  it('lets admins view an assigned order but reserves picking mutations for its picker', async () => {
    await setupOrder()
    const session = createFulfillmentSession('test-order', [1], { mode: 'fast' })
    const body = { session, expectedVersion: 0, mutationId: crypto.randomUUID() }
    expect((await call('admin', '/api/orders/test-order/session', 'PUT', body)).status).toBe(403)
    expect((await call('admin', '/api/orders/test-order/session')).body.session).toBeNull()
    expect((await call('picker', '/api/orders/test-order/session', 'PUT', body)).status).toBe(200)
    const picked = updateFulfillmentItem(session, 1, 'picked')
    expect((await call('picker', '/api/orders/test-order/session', 'PUT', { session: picked, expectedVersion: 1, mutationId: crypto.randomUUID() })).status).toBe(200)
    const observed = await call('admin', '/api/orders/test-order/session')
    expect(observed.body.session.items['1'].status).toBe('picked')
    expect((await call('admin', '/api/orders/test-order')).body.order.assigneeName).toBe('picker')
    expect((await call('admin', '/api/orders/test-order/session', 'PUT', { session: picked, expectedVersion: 2, mutationId: crypto.randomUUID() })).status).toBe(403)
  })
  it('rejects cross-site browser mutations before authenticating', async () => {
    const response = await worker.fetch(new Request('https://warehouse.test/api/reports', { method: 'POST', headers: { origin: 'https://unrelated.test', 'content-type': 'text/plain' }, body: '{}' }), {}, {})
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('invalid_origin')
  })
  it('synchronizes fixed pallet placements with role, revision and idempotency checks', async () => {
    await setupOrder()
    const placements = [{ id: 'box-1', orderRow: 1, palletIndex: 0, x: 0, y: 0, z: 0, lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 10 }]
    const body = { placements, version: 0, mutationId: crypto.randomUUID() }
    expect((await call('other', '/api/orders/test-order/pallet', 'PUT', body)).status).toBe(404)
    expect((await call('picker', '/api/orders/test-order/pallet', 'PUT', body)).body).toEqual({ placements, version: 1 })
    expect((await call('picker', '/api/orders/test-order/pallet', 'PUT', body)).body.version).toBe(1)
    expect((await call('admin', '/api/orders/test-order/pallet')).body.placements).toEqual(placements)
    expect((await call('picker', '/api/orders/test-order/pallet', 'PUT', { ...body, mutationId: crypto.randomUUID() })).status).toBe(409)
    expect((await call('picker', '/api/orders/test-order/pallet', 'PUT', { ...body, version: 1, mutationId: crypto.randomUUID(), placements: [{ ...placements[0], x: 119 }] })).status).toBe(400)
  })
  it('lists sessions in batches without exposing another picker work', async () => {
    await setupOrder()
    await call('picker', '/api/orders/test-order/session', 'PUT', { session: createFulfillmentSession('test-order', [1], { mode: 'fast' }), expectedVersion: 0, mutationId: crypto.randomUUID() })
    expect((await call('admin', '/api/picking-sessions')).body.items).toHaveLength(1)
    expect((await call('other', '/api/picking-sessions')).body.items).toHaveLength(0)
    expect((await call('driver', '/api/picking-sessions')).body.items).toHaveLength(0)
  })
  it('matches 31 two-identifier lines without exceeding 100 SQL bindings and includes full cards', async () => {
    await call('admin', '/api/admin/products', 'POST', product)
    const result = await call('picker', '/api/catalog/match', 'POST', { items: Array.from({ length: 31 }, (_, i) => ({ sku: String(1000 + i), barcode: String(7290000000000 + i) })) })
    expect(result.status).toBe(200)
    expect(result.body.items[0]).toMatchObject({ description: product.description, boxSpec: { weightKg: 10 }, technicalDataSource: 'simulated' })
  })
  it('preserves omitted technical fields and reports conflicting import values', async () => {
    await call('admin', '/api/admin/products', 'POST', product)
    const identity = { sku: product.sku, barcode: product.barcode, name: product.name, location: product.location }
    const imported = await call('admin', '/api/admin/products/import', 'POST', { products: [identity] })
    expect(imported.body.updated).toBe(1)
    const found = await call('picker', '/api/catalog/search?q=Beer')
    expect(found.body.items[0]).toMatchObject({ description: product.description, boxSpec: { weightKg: 10 }, technicalDataSource: 'simulated' })
    const conflict = await call('admin', '/api/admin/products/import', 'POST', { products: [{ ...identity, location: '24.A' }] })
    expect(conflict.body.skipped).toBe(1)
    expect((await call('picker', '/api/catalog/search?q=Beer')).body.items[0].location).toBe('23.F')
  })
  it('restricts creation and OCR to admins and orders to their assignee', async () => {
    await setupOrder()
    expect((await call('picker', '/api/recognize-order', 'POST', {})).status).toBe(403)
    expect((await call('picker', '/api/orders/forbidden', 'PUT', {})).status).toBe(403)
    expect((await call('picker', '/api/orders')).body.items).toHaveLength(1)
    expect((await call('other', '/api/orders')).body.items).toHaveLength(0)
    expect((await call('other', '/api/orders/test-order/session')).status).toBe(404)
  })
  it('saves comments independently, rejects stale writes, and records idempotent completion with an actor', async () => {
    await setupOrder()
    let session = createFulfillmentSession('test-order', [1], { mode: 'fast', now: '2026-09-05T10:00:00Z' })
    session = updateFulfillmentItemNote(session, 1, 'Another location', '2026-09-05T10:01:00Z')
    const input = { session, expectedVersion: 0, mutationId: crypto.randomUUID() }
    const first = await call('picker', '/api/orders/test-order/session', 'PUT', input)
    expect(first.status).toBe(200)
    expect(first.body.session.serverVersion).toBe(1)
    expect((await call('picker', '/api/orders/test-order/session', 'PUT', input)).body).toEqual(first.body)
    expect((await call('picker', '/api/orders/test-order/session', 'PUT', { ...input, mutationId: crypto.randomUUID() })).status).toBe(409)
    session = completeFastFulfillmentSession(first.body.session, '2026-09-05T10:10:00Z')
    const last = await call('picker', '/api/orders/test-order/session', 'PUT', { session, expectedVersion: 1, mutationId: crypto.randomUUID() })
    expect(last.status).toBe(200)
    expect(last.body.session.items['1']).toMatchObject({ status: 'picked', note: 'Another location' })
    expect(last.body.session.events.every(event => event.actorId === 'picker')).toBe(true)
    expect((await call('admin', '/api/orders')).body.items[0].status).toBe('completed')
    expect(database.sqlite.prepare('SELECT count(*) AS count FROM picking_events').get().count).toBe(2)
  })
  it('requires admin confirmation before moving a catalog location and creates a replenishment queue', async () => {
    await setupOrder()
    const id = crypto.randomUUID()
    const moved = await call('picker', '/api/reports', 'POST', { id, orderId: 'test-order', row: 1, kind: 'moved', suggestedAddress: '24.F', note: '' })
    expect(moved.status).toBe(201)
    expect(moved.body.report).toMatchObject({ note: '', suggestedAddress: '24.F' })
    let current = (await call('admin', '/api/admin/products')).body.items[0]
    expect(current.location).toBe('23.F')
    expect((await call('picker', `/api/reports/${id}`, 'PATCH', { status: 'resolved', version: 1 })).status).toBe(403)
    expect((await call('admin', `/api/reports/${id}`, 'PATCH', { status: 'resolved', version: 1, productVersion: current.version })).status).toBe(200)
    current = (await call('picker', '/api/catalog/search?q=Beer')).body.items[0]
    expect(current.location).toBe('24.F')
    const missing = crypto.randomUUID()
    await call('picker', '/api/reports', 'POST', { id: missing, orderId: 'test-order', row: 1, kind: 'missing', note: '' })
    expect((await call('driver', '/api/reports')).body.items).toHaveLength(1)
    expect((await call('driver', `/api/reports/${missing}`, 'PATCH', { status: 'checking-reserve', version: 1 })).status).toBe(200)
    expect((await call('picker', '/api/reports?orderId=test-order')).body.items[0].status).toBe('checking-reserve')
  })
  it('allows an administrator to provision a driver without widening the underlying picker role', async () => {
    const result = await call('admin', '/api/admin/users', 'POST', { email: 'newdriver@test.local', name: 'Driver', role: 'replenisher' })
    expect(result.status).toBe(201)
    expect(result.body.user.role).toBe('replenisher')
  })
})
