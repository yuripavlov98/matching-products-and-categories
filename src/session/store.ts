import { v4 as uuidv4 } from 'uuid'
import type { MappingResponse, SeoCategory } from '../lib/types'
import type { ParsedProducts } from '../lib/seo-mapper'

export interface ProductPayload extends ParsedProducts {
  id: string
  mapped?: MappingResponse
}

export interface SessionData {
  id: string
  createdAt: number
  categories: SeoCategory[] | null
  products: ProductPayload[]
}

const sessions = new Map<string, SessionData>()
const SESSION_TTL_MS = 1000 * 60 * 60 // 1 hour

export function createSession(): SessionData {
  const id = uuidv4()
  const session: SessionData = {
    id,
    createdAt: Date.now(),
    categories: null,
    products: []
  }
  sessions.set(id, session)
  return session
}

export function getSession(sessionId: string): SessionData | null {
  const session = sessions.get(sessionId)
  if (!session) return null
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId)
    return null
  }
  return session
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function upsertSeoCategories(sessionId: string, categories: SeoCategory[]): SessionData {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('Сессия не найдена')
  }
  session.categories = categories
  session.products.forEach((product) => {
    product.mapped = undefined
  })
  return session
}

export function addProductDataset(sessionId: string, parsedProducts: ParsedProducts): ProductPayload {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('Сессия не найдена')
  }
  const payload: ProductPayload = {
    ...parsedProducts,
    id: uuidv4()
  }
  session.products.push(payload)
  return payload
}

export function updateMapping(sessionId: string, productId: string, mapping: MappingResponse): void {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('Сессия не найдена')
  }
  const target = session.products.find((product) => product.id === productId)
  if (!target) {
    throw new Error('Файл товаров не найден в сессии')
  }
  target.mapped = mapping
}

export function clearSession(sessionId: string): SessionData {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('Сессия не найдена')
  }
  session.categories = null
  session.products = []
  return session
}

export function listSessions(): SessionData[] {
  return Array.from(sessions.values())
}
