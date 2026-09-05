import { useEffect, useState } from 'react'
import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'
import type { PackingOptions, PalletPlacement, PalletPlan } from './packing'
export function usePalletPlan(order: SavedOrder | undefined, products: Product[], fixed: PalletPlacement[], options: PackingOptions) {
  const [plan, setPlan] = useState<PalletPlan | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  useEffect(() => {
    setPlan(null); setError('')
    if (!order) return
    setWorking(true)
    const worker = new Worker(new URL('../workers/packing.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = event => { setWorking(false); setPlan(event.data.plan || null); setError(event.data.error || '') }
    worker.onerror = () => { setWorking(false); setError('Не удалось выполнить расчёт палеты.') }
    worker.postMessage({ order, products, fixed, options })
    return () => worker.terminate()
  }, [order, products, fixed, options])
  return { plan, error, working }
}
