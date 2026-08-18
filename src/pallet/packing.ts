import type { SavedOrder } from '../orders/storage'
import type { Product } from '../products/storage'

export type PackingBox = {
  id: string
  orderRow: number
  productId: string
  sku: string
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  maxTopLoadKg?: number
  rigidity: number
  fragility: number
}

export type PalletPlacement = PackingBox & {
  x: number
  y: number
  z: number
  loadAboveKg: number
  fixed?: boolean
  palletIndex: number
}

export type PalletLoad = {
  index: number
  placements: PalletPlacement[]
  totalWeightKg: number
  heightCm: number
  volumeUtilization: number
  layerCount: number
}

export type PackingIssue = {
  orderRow: number
  sku: string
  name: string
  reason: 'PRODUCT_NOT_FOUND' | 'BOX_COUNT_UNKNOWN' | 'BOX_DIMENSIONS_MISSING' | 'BOX_WEIGHT_MISSING' | 'RATINGS_MISSING' | 'NO_SAFE_POSITION'
}

export type PalletPlan = {
  pallet: { lengthCm: 120; widthCm: 80 }
  placements: PalletPlacement[]
  pallets: PalletLoad[]
  requiredPallets: number
  issues: PackingIssue[]
  totalWeightKg: number
  heightCm: number
  volumeUtilization: number
}

const PALLET_LENGTH_CM = 120
const PALLET_WIDTH_CM = 80
const EPSILON = 1e-6
const MAX_LAYERS = 6
type PlacementCandidate = PackingBox & { x: number; y: number; z: number }

function overlap1d(a: number, aSize: number, b: number, bSize: number) {
  return Math.max(0, Math.min(a + aSize, b + bSize) - Math.max(a, b))
}

function intersects(candidate: PlacementCandidate, placed: PalletPlacement) {
  return overlap1d(candidate.x, candidate.lengthCm, placed.x, placed.lengthCm) > EPSILON
    && overlap1d(candidate.y, candidate.widthCm, placed.y, placed.widthCm) > EPSILON
    && overlap1d(candidate.z, candidate.heightCm, placed.z, placed.heightCm) > EPSILON
}

function supportFor(candidate: PlacementCandidate, placements: PalletPlacement[]) {
  if (candidate.z < EPSILON) return { valid: true, loads: [] as Array<{ placement: PalletPlacement; load: number }> }
  const supporters = placements.map((placement) => {
    if (Math.abs(placement.z + placement.heightCm - candidate.z) > EPSILON) return null
    const area = overlap1d(candidate.x, candidate.lengthCm, placement.x, placement.lengthCm)
      * overlap1d(candidate.y, candidate.widthCm, placement.y, placement.widthCm)
    return area > EPSILON ? { placement, area } : null
  }).filter((entry): entry is { placement: PalletPlacement; area: number } => Boolean(entry))
  const footprint = candidate.lengthCm * candidate.widthCm
  const supportedArea = supporters.reduce((total, supporter) => total + supporter.area, 0)
  if (supportedArea / footprint < .9) return { valid: false, loads: [] as Array<{ placement: PalletPlacement; load: number }> }

  const loads = supporters.map(({ placement, area }) => ({ placement, load: candidate.weightKg * area / supportedArea }))
  const valid = loads.every(({ placement, load }) => placement.maxTopLoadKg !== undefined && placement.loadAboveKg + load <= placement.maxTopLoadKg + EPSILON)
  return { valid, loads }
}

function candidatePositions(placements: PalletPlacement[], lengthCm: number, widthCm: number) {
  const existingLevels = [...new Set(placements.map((placement) => placement.z))].sort((a, b) => a - b)
  const candidateLevels = [...new Set([0, ...placements.map((placement) => placement.z + placement.heightCm)])]
    .filter((level) => !existingLevels.some((existing) => Math.abs(existing - level) < EPSILON)).sort((a, b) => a - b)
  const allowedLevels = [...existingLevels, ...candidateLevels.slice(0, Math.max(0, MAX_LAYERS - existingLevels.length))].sort((a, b) => a - b)
  const positions: Array<{ x: number; y: number; z: number; edgeScore: number; compactWaste: number; cornerDistance: number }> = []
  for (const z of allowedLevels) {
    const relevant = placements.filter((placement) => Math.abs(placement.z - z) < EPSILON || Math.abs(placement.z + placement.heightCm - z) < EPSILON)
    const sameLayer = placements.filter((placement) => Math.abs(placement.z - z) < EPSILON)
    const xs = [...new Set([0, PALLET_LENGTH_CM - lengthCm, (PALLET_LENGTH_CM - lengthCm) / 2, ...relevant.flatMap((placement) => [placement.x, placement.x + placement.lengthCm, placement.x - lengthCm])])]
    const ys = [...new Set([0, PALLET_WIDTH_CM - widthCm, (PALLET_WIDTH_CM - widthCm) / 2, ...relevant.flatMap((placement) => [placement.y, placement.y + placement.widthCm, placement.y - widthCm])])]
    for (const x of xs) for (const y of ys) {
      if (x < -EPSILON || y < -EPSILON || x + lengthCm > PALLET_LENGTH_CM + EPSILON || y + widthCm > PALLET_WIDTH_CM + EPSILON) continue
      const edgeScore = Number(Math.abs(x) < EPSILON) + Number(Math.abs(y) < EPSILON) + Number(Math.abs(x + lengthCm - PALLET_LENGTH_CM) < EPSILON) + Number(Math.abs(y + widthCm - PALLET_WIDTH_CM) < EPSILON)
      const centerX = x + lengthCm / 2
      const centerY = y + widthCm / 2
      const minX = Math.min(x, ...sameLayer.map((placement) => placement.x))
      const minY = Math.min(y, ...sameLayer.map((placement) => placement.y))
      const maxX = Math.max(x + lengthCm, ...sameLayer.map((placement) => placement.x + placement.lengthCm))
      const maxY = Math.max(y + widthCm, ...sameLayer.map((placement) => placement.y + placement.widthCm))
      const occupiedArea = lengthCm * widthCm + sameLayer.reduce((total, placement) => total + placement.lengthCm * placement.widthCm, 0)
      const compactWaste = (maxX - minX) * (maxY - minY) - occupiedArea
      const cornerDistance = Math.min(
        Math.hypot(centerX, centerY), Math.hypot(PALLET_LENGTH_CM - centerX, centerY),
        Math.hypot(centerX, PALLET_WIDTH_CM - centerY), Math.hypot(PALLET_LENGTH_CM - centerX, PALLET_WIDTH_CM - centerY),
      )
      positions.push({ x, y, z, edgeScore, compactWaste, cornerDistance })
    }
  }
  return positions
}

function tryPlace(box: PackingBox, placements: PalletPlacement[], palletIndex: number) {
  const orientations = box.lengthCm === box.widthCm
    ? [{ lengthCm: box.lengthCm, widthCm: box.widthCm }]
    : [{ lengthCm: box.lengthCm, widthCm: box.widthCm }, { lengthCm: box.widthCm, widthCm: box.lengthCm }]
  const choices = orientations.flatMap((orientation) => candidatePositions(placements, orientation.lengthCm, orientation.widthCm).map((position) => ({ orientation, position })))
    .sort((left, right) => left.position.z - right.position.z
      || (PALLET_LENGTH_CM * PALLET_WIDTH_CM - Math.floor(PALLET_LENGTH_CM / left.orientation.lengthCm) * Math.floor(PALLET_WIDTH_CM / left.orientation.widthCm) * left.orientation.lengthCm * left.orientation.widthCm)
        - (PALLET_LENGTH_CM * PALLET_WIDTH_CM - Math.floor(PALLET_LENGTH_CM / right.orientation.lengthCm) * Math.floor(PALLET_WIDTH_CM / right.orientation.widthCm) * right.orientation.lengthCm * right.orientation.widthCm)
      || left.position.compactWaste - right.position.compactWaste
      || right.position.edgeScore - left.position.edgeScore
      || left.position.cornerDistance - right.position.cornerDistance)
  for (const { orientation, position } of choices) {
      const candidate = { ...box, ...orientation, x: position.x, y: position.y, z: position.z }
      if (candidate.x + candidate.lengthCm > PALLET_LENGTH_CM + EPSILON || candidate.y + candidate.widthCm > PALLET_WIDTH_CM + EPSILON) continue
      if (placements.some((placement) => intersects(candidate, placement))) continue
      const support = supportFor(candidate, placements)
      if (!support.valid) continue
      const placement: PalletPlacement = { ...candidate, loadAboveKg: 0, palletIndex }
      for (const load of support.loads) load.placement.loadAboveKg += load.load
      return placement
  }
  return null
}

function palletLoad(index: number, placements: PalletPlacement[]): PalletLoad {
  const heightCm = placements.reduce((height, placement) => Math.max(height, placement.z + placement.heightCm), 0)
  const packedVolume = placements.reduce((volume, placement) => volume + placement.lengthCm * placement.widthCm * placement.heightCm, 0)
  return {
    index,
    placements,
    totalWeightKg: placements.reduce((weight, placement) => weight + placement.weightKg, 0),
    heightCm,
    volumeUtilization: heightCm ? packedVolume / (PALLET_LENGTH_CM * PALLET_WIDTH_CM * heightCm) : 0,
    layerCount: new Set(placements.map((placement) => placement.z.toFixed(3))).size,
  }
}

function boxCount(orderItem: SavedOrder['items'][number], product: Product) {
  const explicit = Number(orderItem.boxCount)
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  const quantity = Number(orderItem.quantity)
  const unitsPerBox = product.unitsPerBox ?? Number(orderItem.unitsPerBox)
  return quantity > 0 && unitsPerBox > 0 ? Math.ceil(quantity / unitsPerBox) : 0
}

export function optimizePallet(order: SavedOrder, products: Product[], fixedPlacements: PalletPlacement[] = []): PalletPlan {
  const productsBySku = new Map(products.map((product) => [product.sku, product]))
  const productsByBarcode = new Map(products.map((product) => [product.barcode, product]))
  const boxes: PackingBox[] = []
  const issues: PackingIssue[] = []

  for (const item of order.items) {
    const product = productsBySku.get(item.sku) ?? productsByBarcode.get(item.barcode)
    if (!product) {
      issues.push({ orderRow: item.row, sku: item.sku, name: item.description, reason: 'PRODUCT_NOT_FOUND' })
      continue
    }
    const count = boxCount(item, product)
    if (!count) {
      issues.push({ orderRow: item.row, sku: item.sku, name: item.description, reason: 'BOX_COUNT_UNKNOWN' })
      continue
    }
    if (!product.boxSpec?.lengthCm || !product.boxSpec.widthCm || !product.boxSpec.heightCm) {
      issues.push({ orderRow: item.row, sku: item.sku, name: item.description, reason: 'BOX_DIMENSIONS_MISSING' })
      continue
    }
    if (!product.boxSpec.weightKg) {
      issues.push({ orderRow: item.row, sku: item.sku, name: item.description, reason: 'BOX_WEIGHT_MISSING' })
      continue
    }
    if (!product.rigidity || !product.fragility) {
      issues.push({ orderRow: item.row, sku: item.sku, name: item.description, reason: 'RATINGS_MISSING' })
      continue
    }
    for (let index = 0; index < Math.min(count, 200); index += 1) {
      boxes.push({
        id: `${item.row}:${product.id}:${index + 1}`,
        orderRow: item.row,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        lengthCm: product.boxSpec.lengthCm,
        widthCm: product.boxSpec.widthCm,
        heightCm: product.boxSpec.heightCm,
        weightKg: product.boxSpec.weightKg,
        maxTopLoadKg: product.boxSpec.maxTopLoadKg,
        rigidity: product.rigidity,
        fragility: product.fragility,
      })
    }
  }

  boxes.sort((left, right) => right.lengthCm * right.widthCm - left.lengthCm * left.widthCm
    || right.weightKg - left.weightKg
    || right.rigidity - left.rigidity
    || left.fragility - right.fragility)

  const palletPlacements: PalletPlacement[][] = [fixedPlacements.map((placement) => ({ ...placement, palletIndex: 0, fixed: true }))]
  const fixedIds = new Set(fixedPlacements.map((placement) => placement.id))
  for (const box of boxes) {
    if (fixedIds.has(box.id)) continue
    let placement: PalletPlacement | null = null
    for (let index = 0; index < palletPlacements.length && !placement; index += 1) {
      placement = tryPlace(box, palletPlacements[index], index)
      if (placement) palletPlacements[index].push(placement)
    }
    if (!placement) {
      const index = palletPlacements.length
      const next: PalletPlacement[] = []
      placement = tryPlace(box, next, index)
      if (placement) {
        next.push(placement)
        palletPlacements.push(next)
      } else issues.push({ orderRow: box.orderRow, sku: box.sku, name: box.name, reason: 'NO_SAFE_POSITION' })
    }
  }

  const pallets = palletPlacements.filter((placements) => placements.length).map((placements, index) => palletLoad(index, placements))
  const first = pallets[0] ?? palletLoad(0, [])
  return {
    pallet: { lengthCm: 120, widthCm: 80 },
    placements: first.placements,
    pallets,
    requiredPallets: pallets.length,
    issues,
    totalWeightKg: first.totalWeightKg,
    heightCm: first.heightCm,
    volumeUtilization: first.volumeUtilization,
  }
}
