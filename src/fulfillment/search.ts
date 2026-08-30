import type { FulfillmentItemStatus } from './workflow'

export type FulfillmentSearchEntry = {
  row: number
  address: string
  name: string
  barcode: string
  sku: string
  status: FulfillmentItemStatus
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactSearchValue(value: string) {
  return normalizeSearchValue(value).replace(/[^\p{L}\p{N}]/gu, '')
}

function matchScore(entry: FulfillmentSearchEntry, query: string) {
  const normalizedQuery = normalizeSearchValue(query)
  const compactQuery = compactSearchValue(query)
  if (!normalizedQuery || !compactQuery) return null

  const identifiers = [entry.barcode, entry.sku, entry.address].map(compactSearchValue).filter(Boolean)
  if (identifiers.includes(compactQuery)) return 0
  if (identifiers.some((value) => value.startsWith(compactQuery))) return 1

  const normalizedName = normalizeSearchValue(entry.name)
  if (normalizedName.startsWith(normalizedQuery)) return 2

  const normalizedFields = [entry.name, entry.barcode, entry.sku, entry.address].map(normalizeSearchValue)
  const compactFields = [entry.name, entry.barcode, entry.sku, entry.address].map(compactSearchValue)
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const matches = tokens.every((token) => {
    const compactToken = compactSearchValue(token)
    return normalizedFields.some((value) => value.includes(token))
      || compactFields.some((value) => value.includes(compactToken))
  })
  return matches ? 3 : null
}

export function searchFulfillmentEntries(entries: FulfillmentSearchEntry[], query: string) {
  return entries
    .map((entry, index) => ({ entry, index, score: matchScore(entry, query) }))
    .filter((candidate): candidate is { entry: FulfillmentSearchEntry; index: number; score: number } => candidate.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ entry }) => entry)
}
