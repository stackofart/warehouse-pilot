import { validateOrderItem, type RecognizedOrderItem } from '../recognition/ocr'
import { isProductVerified, type Product } from './storage'

type Candidate = {
  product: Product
  score: number
  nameSimilarity: number
  barcodeMatch: boolean
  skuMatch: boolean
  addressMatch: boolean
}

function compactDigits(value: string) {
  return value.replace(/\D/g, '')
}

function compactAddress(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

export function normalizeProductName(value: string) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('he')
    .replace(/[\u0591-\u05c7]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function productNameSimilarity(left: string, right: string) {
  const a = normalizeProductName(left)
  const b = normalizeProductName(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const grams = (value: string) => {
    const padded = ` ${value} `
    const result = new Map<string, number>()
    for (let index = 0; index < padded.length - 1; index += 1) {
      const gram = padded.slice(index, index + 2)
      result.set(gram, (result.get(gram) ?? 0) + 1)
    }
    return result
  }
  const aGrams = grams(a)
  const bGrams = grams(b)
  let overlap = 0
  let aTotal = 0
  let bTotal = 0
  for (const count of aGrams.values()) aTotal += count
  for (const count of bGrams.values()) bTotal += count
  for (const [gram, count] of aGrams) overlap += Math.min(count, bGrams.get(gram) ?? 0)
  return (2 * overlap) / (aTotal + bTotal)
}

function scoreCandidate(item: RecognizedOrderItem, product: Product): Candidate {
  const barcode = compactDigits(item.barcode)
  const productBarcode = compactDigits(product.barcode)
  const sku = compactDigits(item.sku)
  const productSku = compactDigits(product.sku)
  const barcodeMatch = Boolean(barcode && productBarcode && barcode === productBarcode)
  const skuMatch = Boolean(sku && productSku && sku === productSku)
  const addressMatch = Boolean(item.address && product.location && compactAddress(item.address) === compactAddress(product.location))
  const nameSimilarity = productNameSimilarity(item.description, product.name)
  const unitsMatch = Number(item.unitsPerBox) > 0 && Number(product.unitsPerBox) > 0
    && Math.abs(Number(item.unitsPerBox) - Number(product.unitsPerBox)) < .01
  const score = Math.min(100, Math.round(
    (barcodeMatch ? 65 : 0)
    + (skuMatch ? 45 : 0)
    + (addressMatch ? 20 : 0)
    + nameSimilarity * 25
    + (unitsMatch ? 5 : 0),
  ))
  return { product, score, nameSimilarity, barcodeMatch, skuMatch, addressMatch }
}

function isConfident(candidate: Candidate) {
  return candidate.barcodeMatch
    || (candidate.skuMatch && (candidate.addressMatch || candidate.nameSimilarity >= .35))
    || candidate.score >= 70
}

function reasonFor(candidate: Candidate): NonNullable<RecognizedOrderItem['catalogMatchReason']> {
  if (candidate.barcodeMatch && candidate.skuMatch) return 'identifiers'
  if (candidate.barcodeMatch) return 'barcode'
  if (candidate.skuMatch) return 'sku'
  return 'combined'
}

export function reconcileRecognizedItems(items: RecognizedOrderItem[], products: Product[]) {
  let matched = 0
  let corrected = 0
  let unverified = 0

  const reconciled = items.map((item, index): RecognizedOrderItem => {
    const candidates = products.map((product) => scoreCandidate(item, product)).sort((left, right) => right.score - left.score)
    const best = candidates[0]
    if (!best || !isConfident(best)) {
      unverified += 1
      return {
        ...item,
        row: index + 1,
        productVerification: 'unverified',
        catalogMatchScore: best?.score ?? 0,
        catalogMatchReason: 'none',
        catalogCorrectedFields: [],
      }
    }

    const correctedFields: NonNullable<RecognizedOrderItem['catalogCorrectedFields']> = []
    const replacements = {
      address: best.product.location.trim().toUpperCase(),
      sku: compactDigits(best.product.sku),
      barcode: compactDigits(best.product.barcode),
      description: best.product.name.trim(),
      unitsPerBox: Number(best.product.unitsPerBox) > 0 ? String(best.product.unitsPerBox) : item.unitsPerBox,
    }
    for (const key of Object.keys(replacements) as Array<keyof typeof replacements>) {
      if (replacements[key] && replacements[key] !== item[key]) correctedFields.push(key)
    }
    const normalized = { ...item, ...replacements }
    matched += 1
    if (correctedFields.length) corrected += 1
    if (!isProductVerified(best.product)) unverified += 1
    return {
      ...normalized,
      row: index + 1,
      warnings: validateOrderItem(normalized),
      productVerification: isProductVerified(best.product) ? 'verified' : 'unverified',
      catalogProductId: best.product.id,
      catalogMatchScore: best.score,
      catalogMatchReason: reasonFor(best),
      catalogCorrectedFields: correctedFields,
    }
  })

  return { items: reconciled, matched, corrected, unverified }
}
