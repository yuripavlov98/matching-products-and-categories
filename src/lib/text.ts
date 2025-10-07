import { newStemmer } from 'snowball-stemmers'

const stemmer = newStemmer('russian')

const STOP_WORDS = new Set<string>([
  'и', 'в', 'во', 'не', 'что', 'он', 'она', 'но', 'а', 'как', 'к', 'ко', 'до', 'вы', 'мы', 'они',
  'из', 'у', 'по', 'на', 'это', 'тот', 'та', 'те', 'для', 'при', 'от', 'со', 'соответствие',
  'комплект', 'система', 'системы', 'системный', 'оборудование', 'оборудования', 'решение',
  'решения', 'платформа', 'платформы', 'серия', 'серии', 'тип', 'типа', 'устройство',
  'устройства', 'timmer', 'бренд', 'brand', 'series', 'system', 'systems', 'device', 'devices'
])

const TOKEN_REGEX = /[a-zа-яё0-9]+/gi

export function tokenize(text: string | undefined | null): string[] {
  if (!text) return []
  const matches = text.match(TOKEN_REGEX)
  return matches ? matches : []
}

export function normalizeTokens(text: string | undefined | null): string[] {
  return tokenize(text)
    .map((token) => token.toLowerCase())
    .map((token) => stemmer.stem(token))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

export function joinTokens(tokens: string[]): string {
  return tokens.join(' ')
}

export function generateCharNgrams(value: string, min = 3, max = 5): string[] {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ')
  const cleaned = normalized.replace(/[^a-zа-яё0-9 ]/g, '')
  const ngrams: string[] = []
  for (let n = min; n <= max; n++) {
    for (let i = 0; i <= cleaned.length - n; i++) {
      ngrams.push(cleaned.slice(i, i + n))
    }
  }
  return ngrams
}

export function computeOverlap(tokensA: Set<string>, tokensB: Set<string>): number {
  let count = 0
  tokensA.forEach((token) => {
    if (tokensB.has(token)) count += 1
  })
  return count
}
