export class TfIdfVectorizer {
  private vocabulary: Map<string, number>
  private idf: Float32Array
  private vocabSize: number

  constructor(documents: string[][]) {
    this.vocabulary = new Map<string, number>()

    documents.forEach((tokens) => {
      tokens.forEach((token) => {
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, this.vocabulary.size)
        }
      })
    })

    this.vocabSize = this.vocabulary.size

    const docFreq = new Float32Array(this.vocabSize)
    documents.forEach((tokens) => {
      const seen = new Set<number>()
      tokens.forEach((token) => {
        const idx = this.vocabulary.get(token)
        if (idx !== undefined && !seen.has(idx)) {
          docFreq[idx] += 1
          seen.add(idx)
        }
      })
    })

    const totalDocs = Math.max(1, documents.length)
    this.idf = new Float32Array(this.vocabSize)
    for (let i = 0; i < this.vocabSize; i++) {
      this.idf[i] = Math.log((totalDocs + 1) / (docFreq[i] + 1)) + 1
    }
  }

  vectorize(tokens: string[]): Float32Array {
    const tf = new Float32Array(this.vocabSize)
    tokens.forEach((token) => {
      const idx = this.vocabulary.get(token)
      if (idx !== undefined) tf[idx] += 1
    })

    let norm = 0
    for (let i = 0; i < this.vocabSize; i++) {
      tf[i] *= this.idf[i]
      norm += tf[i] * tf[i]
    }

    norm = Math.sqrt(norm)
    if (norm === 0) return tf

    for (let i = 0; i < this.vocabSize; i++) {
      tf[i] /= norm
    }

    return tf
  }

  similarity(vecA: Float32Array, vecB: Float32Array): number {
    let sum = 0
    for (let i = 0; i < this.vocabSize; i++) {
      sum += vecA[i] * vecB[i]
    }
    return sum
  }
}
