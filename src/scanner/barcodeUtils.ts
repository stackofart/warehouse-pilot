import type { Product } from '../products/storage'

export type BarcodeConsensus = {
  value: string
  format: string
  hits: number
  lastSeenAt: number
}

export function normalizeBarcode(value: string) {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

export function barcodeLookupKeys(value: string) {
  const normalized = normalizeBarcode(value)
  const keys = new Set<string>()
  if (normalized) keys.add(normalized)

  if (/^0\d{12}$/.test(normalized)) keys.add(normalized.slice(1))
  if (/^\d{12}$/.test(normalized)) keys.add(`0${normalized}`)

  return [...keys]
}

export function findProductByBarcode(products: Product[], value: string) {
  const scannedKeys = new Set(barcodeLookupKeys(value))
  if (!scannedKeys.size) return undefined

  return products.find((product) => barcodeLookupKeys(product.barcode).some((key) => scannedKeys.has(key)))
}

export function advanceBarcodeConsensus(
  previous: BarcodeConsensus | null,
  value: string,
  format: string,
  seenAt: number,
  options: { requiredHits?: number; maxGapMs?: number } = {},
) {
  const requiredHits = options.requiredHits ?? 2
  const maxGapMs = options.maxGapMs ?? 1_200
  const normalized = normalizeBarcode(value)
  if (!normalized) return { consensus: null, confirmed: false }

  const sameRecentCode = previous
    && previous.value === normalized
    && previous.format === format
    && seenAt - previous.lastSeenAt <= maxGapMs
  const consensus: BarcodeConsensus = sameRecentCode
    ? { ...previous, hits: previous.hits + 1, lastSeenAt: seenAt }
    : { value: normalized, format, hits: 1, lastSeenAt: seenAt }

  return { consensus, confirmed: consensus.hits >= requiredHits }
}
