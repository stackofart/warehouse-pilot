import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { configureStorageScope } from '../storage/database'
import { flushPallets, loadPalletState, savePalletState } from './storage'
import type { PalletPlacement } from './packing'
const box = { id: 'box', orderRow: 1, palletIndex: 0, x: 0, y: 0, z: 0, lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 10 } as PalletPlacement
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('window', new EventTarget()); configureStorageScope('picker-a') })
afterEach(() => { configureStorageScope(null); vi.unstubAllGlobals() })
describe('fixed pallet state', () => {
  it('keeps offline placements, syncs them and rejects stale tabs', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'PUT' ? Response.json({ placements: JSON.parse(String(init.body)).placements, version: 1 }) : Response.json({ placements: [], version: 0 }))
    vi.stubGlobal('fetch', fetcher)
    const first = await loadPalletState('order')
    vi.stubGlobal('navigator', { onLine: false })
    const saved = await savePalletState(first, [box])
    expect(saved.status).toBe('pending')
    await expect(savePalletState(first, [])).rejects.toThrow('изменена')
    expect((await loadPalletState('order')).placements).toHaveLength(1)
    vi.stubGlobal('navigator', { onLine: true }); await flushPallets()
    expect(fetcher).toHaveBeenCalledTimes(2)
    configureStorageScope('picker-b')
    expect((await loadPalletState('order')).placements).toHaveLength(0)
  })
  it('keeps a server conflict until explicit resolution', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => init.method === 'PUT' ? Response.json({ error: 'Conflict' }, { status: 409 }) : Response.json({ placements: [], version: 2 })))
    const first = await loadPalletState('order')
    const conflict = await savePalletState(first, [box])
    expect(conflict.status).toBe('conflict')
    expect((await loadPalletState('order')).placements).toHaveLength(1)
    expect((await loadPalletState('order', false, true)).placements).toHaveLength(0)
  })
})
