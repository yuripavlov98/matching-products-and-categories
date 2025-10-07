export type CategoryPath = string

export interface SeoCategory {
  id: string
  rawPath: string
  levels: string[]
  tokens: string[]
  normalizedText: string
}

export interface ProductRecord {
  id: string
  sourceFile: string
  rowIndex: number
  fields: Record<string, unknown>
  productName: string
  categoryOld?: string
  description?: string
  aggregatedText: string
  tokens: string[]
}

export interface CandidateMatch {
  categoryId: string
  categoryPath: string
  score: number
  overlap: number
  jaccard: number
}

export interface MappingOptions {
  similarityThreshold: number
  gapThreshold: number
  tokenOverlapThreshold: number
  useOpenAI: boolean
  openAIApiKey?: string
  confidenceMinPercent: number
}

export interface MappedProduct extends ProductRecord {
  seoCategory: string | null
  confidence: number
  status: 'mapped' | 'not_mapped'
  candidates: CandidateMatch[]
  reason: string
}

export interface MappingStatistics {
  brandName: string | null
  sourceFile: string
  totalProducts: number
  mappedProducts: number
  unmappedProducts: number
  mappingSuccessRate: number
  categoriesUsed: number
}

export interface MappingResponse {
  items: MappedProduct[]
  stats: MappingStatistics
}
