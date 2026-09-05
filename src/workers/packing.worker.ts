import { optimizePallet } from '../pallet/packing'
self.onmessage = event => {
  try { const { order, products, fixed, options } = event.data; self.postMessage({ plan: optimizePallet(order, products, fixed, options) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Расчёт не выполнен' }) }
}
