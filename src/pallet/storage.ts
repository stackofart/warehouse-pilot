import { apiRequest, mayUseOfflineCache } from '../storage/apiClient'
import { getStorageScope, KV_STORE, openDatabase, requestToPromise } from '../storage/database'
import type { PalletPlacement } from './packing'
export type PalletState = { id: string; placements: PalletPlacement[]; version: number; revision: number; mutationId?: string; attempted?: boolean; status: 'synced' | 'pending' | 'conflict'; error?: string }
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
let queue: Promise<unknown> = Promise.resolve()
function locked<T>(run: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(`warehouse-pallet-${getStorageScope()}`, run)
  const next = queue.then(run, run); queue = next.catch(() => undefined); return next
}
async function read(orderId: string) {
  const db = await openDatabase()
  try { return await requestToPromise(db.transaction(KV_STORE).objectStore(KV_STORE).get(`pallet:${orderId}`)) as PalletState | undefined } finally { db.close() }
}
async function write(state: PalletState, scope = getStorageScope()) {
  const db = await openDatabase(false, scope)
  try { const tx = db.transaction(KV_STORE, 'readwrite'); tx.objectStore(KV_STORE).put(state); await done(tx) } finally { db.close() }
}
async function send(state: PalletState) {
  const scope = getStorageScope()
  state = { ...state, attempted: true }; await write(state, scope)
  try {
    const result = await apiRequest<{ placements: PalletPlacement[]; version: number }>(`/api/orders/${state.id.slice(7)}/pallet`, { method: 'PUT', body: JSON.stringify({ placements: state.placements, version: state.version, mutationId: state.mutationId }) })
    state = { ...state, ...result, status: 'synced', attempted: false, error: undefined }
  } catch (error) { if (!mayUseOfflineCache(error)) state = { ...state, status: 'conflict', error: String(error) } }
  await write(state, scope); return state
}
export function loadPalletState(orderId: string, demo = false, discard = false) {
  return locked(async () => {
    const scope = getStorageScope()
    const local = await read(orderId)
    if (!discard && local && (demo || local.status !== 'synced')) return local
    if (demo) return { id: `pallet:${orderId}`, placements: [], version: 0, revision: 0, status: 'synced' } as PalletState
    try {
      const remote = await apiRequest<{ placements: PalletPlacement[]; version: number }>(`/api/orders/${orderId}/pallet`)
      const state: PalletState = { ...remote, id: `pallet:${orderId}`, revision: (local?.revision || 0) + 1, status: 'synced' }
      await write(state, scope); return state
    } catch (error) { if (!discard && local && mayUseOfflineCache(error)) return local; throw error }
  })
}
export function savePalletState(input: PalletState, placements: PalletPlacement[], demo = false) {
  return locked(async () => {
    let current = await read(input.id.slice(7))
    if (current && ((current.revision || 0) !== input.revision || current.status === 'conflict')) throw new Error('Компоновка изменена. Обновите её перед редактированием.')
    if (current?.attempted && current.status === 'pending') {
      if (navigator.onLine) current = await send(current)
      if (current.status !== 'synced') throw new Error('Сначала синхронизируйте предыдущее размещение. Оно сохранено локально.')
    }
    const next: PalletState = { ...input, placements, version: current?.version || input.version, revision: input.revision + 1, mutationId: crypto.randomUUID(), attempted: false, status: demo ? 'synced' : 'pending', error: undefined }
    await write(next)
    return demo || !navigator.onLine ? next : send(next)
  })
}
export function flushPallets() {
  return locked(async () => {
    if (!getStorageScope() || !navigator.onLine) return
    const scope = getStorageScope()
    const db = await openDatabase()
    let states: PalletState[]
    try { states = await requestToPromise(db.transaction(KV_STORE).objectStore(KV_STORE).getAll()) } finally { db.close() }
    for (const state of states.filter(row => row.id.startsWith('pallet:') && row.status === 'pending')) { if (scope !== getStorageScope()) break; await send(state) }
  })
}
