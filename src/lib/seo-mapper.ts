import * as XLSX from 'xlsx'
import { v4 as uuidv4 } from 'uuid'
import { TfIdfVectorizer } from './tfidf'
import {
  CategoryPath,
  CandidateMatch,
  MappingOptions,
  MappingResponse,
  MappedProduct,
  ProductRecord,
  SeoCategory
} from './types'
import {
  computeOverlap,
  generateCharNgrams,
  joinTokens,
  normalizeTokens
} from './text'

export interface ParsedProducts {
  brandName: string | null
  sourceFile: string
  records: ProductRecord[]
}

export const DEFAULT_OPTIONS: MappingOptions = {
  similarityThreshold: 0.55,
  gapThreshold: 0.05,
  tokenOverlapThreshold: 1,
  useOpenAI: false,
  confidenceMinPercent: 50
}

const OPENAI_MODEL = 'text-embedding-3-small'
const OPENAI_TOP_K = 6
const OPENAI_SIMILARITY_THRESHOLD = 0.78
const OPENAI_GAP_THRESHOLD = 0.02

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>
}

async function fetchOpenAIEmbeddings(inputs: string[], apiKey: string): Promise<Float32Array[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: inputs
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI embeddings request failed (${response.status}): ${errorText}`)
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse
  return json.data.map((item) => normalizeVector(item.embedding))
}

function normalizeVector(vector: number[] | Float32Array): Float32Array {
  const floatArr = vector instanceof Float32Array ? vector : Float32Array.from(vector)
  let norm = 0
  for (let i = 0; i < floatArr.length; i++) {
    norm += floatArr[i] * floatArr[i]
  }
  norm = Math.sqrt(norm)
  if (norm === 0) return floatArr
  const normalized = new Float32Array(floatArr.length)
  for (let i = 0; i < floatArr.length; i++) {
    normalized[i] = floatArr[i] / norm
  }
  return normalized
}

function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  const length = Math.min(vecA.length, vecB.length)
  let dot = 0
  for (let i = 0; i < length; i++) {
    dot += vecA[i] * vecB[i]
  }
  return dot
}

function extractBrandName(filename: string): string | null {
  const match = filename.match(/бренд\s*-\s*([^.]*)/i)
  if (match && match[1]) {
    return match[1].trim()
  }
  return null
}

function toArrayBuffer(file: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (file instanceof ArrayBuffer) return file
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

export class SeoMapper {
  parseSeoStructure(fileBuffer: ArrayBuffer | Uint8Array): SeoCategory[] {
    const workbook = XLSX.read(toArrayBuffer(fileBuffer), { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      raw: false,
      defval: ''
    }) as unknown[][]

    const categories: SeoCategory[] = []

    rows.forEach((row) => {
      const cell = row[0]
      if (!cell) return
      const rawPath = String(cell).trim()
      if (!rawPath) return
      const levels = rawPath.split('///').map((level) => level.trim()).filter(Boolean)
      const tokens = normalizeTokens(rawPath)
      categories.push({
        id: uuidv4(),
        rawPath,
        levels,
        tokens,
        normalizedText: joinTokens(tokens)
      })
    })

    return categories
  }

  parseProducts(fileBuffer: ArrayBuffer | Uint8Array, filename: string): ParsedProducts {
    const workbook = XLSX.read(toArrayBuffer(fileBuffer), { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
      raw: false,
      defval: '',
      blankrows: false
    })

    const brandName = extractBrandName(filename)

    const records: ProductRecord[] = rows.map((row, index) => {
      const productName = String(row['Product name'] ?? row['product name'] ?? '').trim()
      const categoryOld = String(row['Category'] ?? row['category'] ?? '').trim() || undefined
      const description = String(row['Description'] ?? row['description'] ?? '').trim() || undefined
      const metaDescription = String(row['Meta description'] ?? '').trim()
      const pageTitle = String(row['Page title'] ?? '').trim()
      const seoName = String(row['SEO name'] ?? '').trim()
      const characteristics = String(row['Характеристики'] ?? '').trim()

      const aggregatedText = [
        productName,
        categoryOld ?? '',
        description ?? '',
        metaDescription,
        pageTitle,
        seoName,
        characteristics
      ]
        .filter(Boolean)
        .join(' ')

      const tokens = normalizeTokens(aggregatedText)

      return {
        id: uuidv4(),
        sourceFile: filename,
        rowIndex: index,
        fields: row,
        productName,
        categoryOld,
        description,
        aggregatedText,
        tokens
      }
    })

    return {
      brandName,
      sourceFile: filename,
      records
    }
  }

  async mapProducts(
    categories: SeoCategory[],
    products: ParsedProducts,
    options: MappingOptions = DEFAULT_OPTIONS
  ): Promise<MappingResponse> {
    if (!categories.length) {
      throw new Error('SEO структура не загружена')
    }

    const categoryMap = new Map<string, SeoCategory>()
    categories.forEach((category) => {
      categoryMap.set(category.id, category)
    })

    const wordVectorizer = new TfIdfVectorizer(categories.map((c) => c.tokens))
    const categoryWordVectors = categories.map((c) => wordVectorizer.vectorize(c.tokens))

    const categoryCharTokens = categories.map((c) => generateCharNgrams(c.rawPath))
    const charVectorizer = new TfIdfVectorizer(categoryCharTokens)
    const categoryCharVectors = categoryCharTokens.map((tokens) => charVectorizer.vectorize(tokens))

    const mappedProducts: MappedProduct[] = []

    for (const product of products.records) {
      const productWordVec = wordVectorizer.vectorize(product.tokens)
      const charTokens = generateCharNgrams(`${product.productName} ${product.categoryOld ?? ''}`)
      const productCharVec = charVectorizer.vectorize(charTokens)

      const oldTokens = new Set(normalizeTokens(product.categoryOld))
      const productTokenSet = new Set(product.tokens)

      let rankedCandidates: CandidateMatch[] = categories.map((category, index) => {
        const wordScore = wordVectorizer.similarity(productWordVec, categoryWordVectors[index])
        const charScore = charVectorizer.similarity(productCharVec, categoryCharVectors[index])

        let combined = 0.6 * wordScore + 0.4 * charScore

        const categoryTokenSet = new Set(category.tokens)

        if (oldTokens.size > 0) {
          const overlapOld = computeOverlap(oldTokens, categoryTokenSet)
          if (overlapOld > 0) {
            combined += 0.05 * overlapOld
          }
        }

        const overlap = computeOverlap(productTokenSet, categoryTokenSet)
        const unionSize = productTokenSet.size + categoryTokenSet.size - overlap
        const jaccard = unionSize > 0 ? overlap / unionSize : 0
        combined += 0.1 * jaccard

        return {
          categoryId: category.id,
          categoryPath: category.rawPath,
          score: Number(combined.toFixed(6)),
          overlap,
          jaccard: Number(jaccard.toFixed(6))
        }
      })

      rankedCandidates.sort((a, b) => b.score - a.score)
      let best = rankedCandidates[0]
      let second = rankedCandidates[1]
      let gap = best && second ? best.score - second.score : best?.score ?? 0
      let summary = best
        ? `score=${best.score.toFixed(2)}, overlap=${best.overlap}, gap=${gap.toFixed(2)}, jaccard=${best.jaccard.toFixed(
            2
          )}`
        : ''

      let status: 'mapped' | 'not_mapped' = 'mapped'
      let reason = summary ? `Автоматически сопоставлено (${summary})` : 'Автоматически сопоставлено'

      let confidencePercent = Math.round((best?.score ?? 0) * 100)

      if (!best) {
        status = 'not_mapped'
        reason = 'Кандидаты не найдены'
      } else {
        const passesScore = best.score >= options.similarityThreshold
        const passesOverlap = best.overlap >= options.tokenOverlapThreshold
        const passesGap = gap >= options.gapThreshold
        const passesJaccard = best.jaccard >= 0.3

        const allowMapping =
          (passesScore && passesOverlap && passesGap) ||
          (passesScore && passesOverlap && passesJaccard && gap >= options.gapThreshold * 0.4) ||
          (passesScore && passesJaccard && best.overlap >= options.tokenOverlapThreshold + 1 && (!second || gap >= options.gapThreshold * 0.2)) ||
          (passesScore && passesJaccard && best.score >= options.similarityThreshold + 0.08)

        if (!allowMapping) {
          status = 'not_mapped'
          reason = summary ? `Недостаточная уверенность (${summary})` : 'Недостаточная уверенность'
        }
      }

      if (status === 'not_mapped' && options.useOpenAI && options.openAIApiKey) {
        try {
          const openAIResult = await this.refineWithOpenAI(
            product,
            rankedCandidates,
            categoryMap,
            options
          )
          if (openAIResult) {
            rankedCandidates = openAIResult.rankedCandidates
            best = rankedCandidates[0]
            second = rankedCandidates[1]
            gap = best && second ? best.score - second.score : best?.score ?? 0
            summary = best
              ? `score=${best.score.toFixed(2)}, overlap=${best.overlap}, gap=${gap.toFixed(2)}, jaccard=${best.jaccard.toFixed(
                  2
                )}`
              : ''
            confidencePercent = Math.round((best?.score ?? 0) * 100)

            if (openAIResult.status === 'mapped' && openAIResult.bestCandidate) {
              best = openAIResult.bestCandidate
              second = rankedCandidates[1]
              gap = best && second ? best.score - second.score : best?.score ?? 0
              summary = best
                ? `score=${best.score.toFixed(2)}, overlap=${best.overlap}, gap=${gap.toFixed(2)}, jaccard=${best.jaccard.toFixed(
                    2
                  )}`
                : ''
              status = 'mapped'
              confidencePercent = openAIResult.confidence
              reason = openAIResult.reason + (summary ? `; ${summary}` : '')
            } else if (openAIResult.reason) {
              reason = openAIResult.reason + (summary ? `; ${summary}` : '')
            }
          }
        } catch (error) {
          const fallbackMessage = `OpenAI fallback error: ${(error as Error).message}`
          reason = reason ? `${reason}; ${fallbackMessage}` : `${fallbackMessage}${summary ? `; ${summary}` : ''}`
        }
      }

      if (status === 'not_mapped' && confidencePercent >= options.confidenceMinPercent) {
        reason += reason ? '; ' : ''
        reason += 'Порог уверенности не достигнут'
      }

      if (!reason) {
        reason = summary
          ? status === 'mapped'
            ? `Автоматически сопоставлено (${summary})`
            : `Недостаточная уверенность (${summary})`
          : status === 'mapped'
            ? 'Автоматически сопоставлено'
            : 'Категория не найдена'
      }

      mappedProducts.push({
        ...product,
        seoCategory: status === 'mapped' && best ? best.categoryPath : null,
        confidence: confidencePercent,
        status,
        candidates: rankedCandidates.slice(0, 5),
        reason
      })
    }

    const mappedCount = mappedProducts.filter((item) => item.status === 'mapped').length
    const categoriesUsed = new Set(
      mappedProducts.filter((item) => item.seoCategory).map((item) => item.seoCategory as CategoryPath)
    ).size

    return {
      items: mappedProducts,
      stats: {
        brandName: products.brandName,
        sourceFile: products.sourceFile,
        totalProducts: mappedProducts.length,
        mappedProducts: mappedCount,
        unmappedProducts: mappedProducts.length - mappedCount,
        mappingSuccessRate: mappedProducts.length ? (mappedCount / mappedProducts.length) * 100 : 0,
        categoriesUsed
      }
    }
  }

  private async refineWithOpenAI(
    product: ProductRecord,
    rankedCandidates: CandidateMatch[],
    categoryMap: Map<string, SeoCategory>,
    options: MappingOptions
  ): Promise<{
    status: 'mapped' | 'not_mapped'
    bestCandidate: CandidateMatch | null
    rankedCandidates: CandidateMatch[]
    confidence: number
    reason: string
  } | null> {
    const apiKey = options.openAIApiKey
    if (!apiKey) return null

    const productText = product.aggregatedText?.trim()
    if (!productText) {
      return {
        status: 'not_mapped',
        bestCandidate: rankedCandidates[0] ?? null,
        rankedCandidates,
        confidence: 0,
        reason: 'OpenAI: недостаточно текста для построения эмбеддингов'
      }
    }

    const topCandidates = rankedCandidates.slice(0, Math.min(OPENAI_TOP_K, rankedCandidates.length))
    if (!topCandidates.length) {
      return null
    }

    const candidateTexts = topCandidates.map((candidate) => {
      const category = categoryMap.get(candidate.categoryId)
      return category?.rawPath ?? candidate.categoryPath
    })

    const embeddings = await fetchOpenAIEmbeddings([productText, ...candidateTexts], apiKey)
    const productEmbedding = embeddings[0]
    const rescoredTop = topCandidates.map((candidate, index) => {
      const similarity = cosineSimilarity(productEmbedding, embeddings[index + 1])
      return {
        ...candidate,
        score: Number(similarity.toFixed(6))
      }
    })

    const rescoredSorted = [...rescoredTop].sort((a, b) => b.score - a.score)
    const best = rescoredSorted[0]
    const second = rescoredSorted[1]
    const gap = best && second ? best.score - second.score : best ? best.score : 0
    const confidencePercent = Math.round((best?.score ?? 0) * 100)

    const mergedCandidates = [...rescoredSorted, ...rankedCandidates.slice(topCandidates.length)]
    mergedCandidates.sort((a, b) => b.score - a.score)

    const similarityThreshold = Math.max(options.similarityThreshold, OPENAI_SIMILARITY_THRESHOLD)
    const gapThreshold = Math.max(options.gapThreshold / 2, OPENAI_GAP_THRESHOLD)
    const requiredOverlap = Math.max(0, options.tokenOverlapThreshold - 1)

    if (
      best &&
      best.score >= similarityThreshold &&
      best.overlap >= requiredOverlap &&
      (!second || gap >= gapThreshold)
    ) {
      return {
        status: 'mapped',
        bestCandidate: best,
        rankedCandidates: mergedCandidates,
        confidence: confidencePercent,
        reason: `OpenAI embeddings подтвердили категорию (score=${best.score.toFixed(
          2
        )}, gap=${gap.toFixed(2)})`
      }
    }

    return {
      status: 'not_mapped',
      bestCandidate: best ?? null,
      rankedCandidates: mergedCandidates,
      confidence: confidencePercent,
      reason: `OpenAI embeddings не дали уверенного совпадения (max=${(best?.score ?? 0).toFixed(
        2
      )}, gap=${gap.toFixed(2)})`
    }
  }
}
