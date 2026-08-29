export type ResearchConfidence = 'low' | 'medium' | 'high'
export type ResearchValueType = 'published' | 'estimated' | 'calculated' | 'unchanged' | 'not_found'

export type ResearchValue<T> = {
  value: T | null
  confidence: ResearchConfidence
  valueType: ResearchValueType
  sourceUrls: string[]
  note: string
}

export type ProductResearchSource = {
  url: string
  title: string
}

export type ProductResearchResult = {
  auditMode: 'corrections'
  barcode: string
  identityMatch: 'exact' | 'probable' | 'ambiguous' | 'not_found'
  identityConfidence: number
  name: ResearchValue<string>
  brand: ResearchValue<string>
  description: ResearchValue<string>
  netContent: ResearchValue<string>
  unit: {
    lengthCm: ResearchValue<number>
    widthCm: ResearchValue<number>
    heightCm: ResearchValue<number>
    grossWeightKg: ResearchValue<number>
  }
  casePack: {
    barcode: ResearchValue<string>
    unitsPerCase: ResearchValue<number>
    lengthCm: ResearchValue<number>
    widthCm: ResearchValue<number>
    heightCm: ResearchValue<number>
    grossWeightKg: ResearchValue<number>
  }
  conflicts: string[]
  warnings: string[]
  sources: ProductResearchSource[]
  model: string
  researchedAt: string
}

export type ProductResearchRecord = {
  status: 'needs_review' | 'verified'
  result: ProductResearchResult
  reviewedAt?: string
}

export type TechnicalVerificationStatus =
  | 'not_searched'
  | 'needs_review'
  | 'partially_verified'
  | 'verified'
  | 'insufficient_data'
  | 'conflict'
