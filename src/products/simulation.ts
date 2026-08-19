import type { Product, ProductInput } from './storage'

type Preset = {
  unitsPerBox: number
  itemSpec: Required<NonNullable<Product['itemSpec']>>
  box: { lengthCm: number; widthCm: number; heightCm: number; emptyWeightKg: number; maxTopLoadKg: number }
  rigidity: number
  fragility: number
}

const presets: Array<{ matches: RegExp; value: Preset }> = [
  { matches: /פרינגלס|pringles/i, value: { unitsPerBox: 14, itemSpec: { lengthCm: 8.6, widthCm: 8.6, heightCm: 25, weightKg: .18 }, box: { lengthCm: 45, widthCm: 35, heightCm: 27, emptyWeightKg: .8, maxTopLoadKg: 10 }, rigidity: 2, fragility: 4 } },
  { matches: /מילקה|milka|שוקולד/i, value: { unitsPerBox: 24, itemSpec: { lengthCm: 16, widthCm: 8, heightCm: 1, weightKg: .1 }, box: { lengthCm: 39, widthCm: 19, heightCm: 14, emptyWeightKg: .7, maxTopLoadKg: 25 }, rigidity: 3, fragility: 2 } },
  { matches: /פחית|פפר|pepper|355\s*מ[״"]?ל|can\b/i, value: { unitsPerBox: 24, itemSpec: { lengthCm: 6.6, widthCm: 6.6, heightCm: 12.2, weightKg: .38 }, box: { lengthCm: 40, widthCm: 27, heightCm: 13, emptyWeightKg: .8, maxTopLoadKg: 35 }, rigidity: 4, fragility: 2 } },
]

function genericPreset(product: Product): Preset {
  const seed = [...product.sku].reduce((total, digit) => total * 31 + Number(digit), 17)
  const unitsPerBox = product.unitsPerBox ?? [6, 12, 18, 24][seed % 4]
  const itemLength = 6 + seed % 7
  const itemWidth = 4 + Math.floor(seed / 7) % 6
  const itemHeight = 3 + Math.floor(seed / 17) % 13
  const itemWeight = Number((.12 + (seed % 10) * .07).toFixed(2))
  return {
    unitsPerBox,
    itemSpec: { lengthCm: itemLength, widthCm: itemWidth, heightCm: itemHeight, weightKg: itemWeight },
    box: {
      lengthCm: 30 + seed % 11,
      widthCm: 22 + Math.floor(seed / 5) % 9,
      heightCm: 18 + Math.floor(seed / 11) % 10,
      emptyWeightKg: .7,
      maxTopLoadKg: 18 + seed % 18,
    },
    rigidity: 2 + seed % 3,
    fragility: 2 + Math.floor(seed / 3) % 3,
  }
}

export function hasCompleteTechnicalData(product: Product) {
  return Boolean(product.itemSpec?.lengthCm && product.itemSpec.widthCm && product.itemSpec.heightCm && product.itemSpec.weightKg
    && product.boxSpec?.lengthCm && product.boxSpec.widthCm && product.boxSpec.heightCm && product.boxSpec.weightKg
    && product.boxSpec.maxTopLoadKg && product.rigidity && product.fragility && product.unitsPerBox)
}

export function simulateProductTechnicalData(product: Product): ProductInput | null {
  if (hasCompleteTechnicalData(product)) return null
  const preset = presets.find(({ matches }) => matches.test(product.name))?.value ?? genericPreset(product)
  const unitsPerBox = product.unitsPerBox ?? preset.unitsPerBox
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    location: product.location,
    description: product.description,
    unitsPerBox,
    itemSpec: { ...preset.itemSpec, ...product.itemSpec },
    boxSpec: {
      lengthCm: preset.box.lengthCm,
      widthCm: preset.box.widthCm,
      heightCm: preset.box.heightCm,
      weightKg: Number((unitsPerBox * preset.itemSpec.weightKg + preset.box.emptyWeightKg).toFixed(2)),
      maxTopLoadKg: preset.box.maxTopLoadKg,
      ...product.boxSpec,
    },
    rigidity: product.rigidity ?? preset.rigidity,
    fragility: product.fragility ?? preset.fragility,
    imageDataUrl: product.imageDataUrl,
    technicalDataSource: 'simulated',
  }
}
