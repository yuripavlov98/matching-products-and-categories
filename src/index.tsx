import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-pages'
import { createSession, deleteSession, getSession, addProductDataset, listSessions, updateMapping, upsertSeoCategories, clearSession } from './session/store'
import { DEFAULT_OPTIONS, SeoMapper } from './lib/seo-mapper'
import type { MappingOptions } from './lib/types'
import { buildWorkbook, buildZipArchive } from './lib/exporters'

const app = new Hono()
const mapper = new SeoMapper()

app.use('/static/*', serveStatic({ root: './public' }))
app.use('/assets/*', serveStatic({ root: './public' }))
app.use('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))
app.use('/manifest.json', serveStatic({ path: './public/manifest.json' }))

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE'] }))

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

app.post('/api/session', async (c) => {
  const session = createSession()
  return c.json({ sessionId: session.id })
})

app.delete('/api/session/:id', (c) => {
  const sessionId = c.req.param('id')
  deleteSession(sessionId)
  return c.json({ success: true })
})

app.delete('/api/session/:id/reset', (c) => {
  const sessionId = c.req.param('id')
  try {
    const session = clearSession(sessionId)
    return c.json({ success: true, session })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404)
  }
})

app.post('/api/session/:id/seo', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return c.json({ error: 'Файл не найден' }, 400)
    }
    const buffer = await file.arrayBuffer()
    const categories = mapper.parseSeoStructure(buffer)
    upsertSeoCategories(sessionId, categories)
    return c.json({ success: true, categoriesCount: categories.length })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

app.post('/api/session/:id/products', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return c.json({ error: 'Файл не найден' }, 400)
    }
    const buffer = await file.arrayBuffer()
    const dataset = mapper.parseProducts(buffer, file.name)
    const payload = addProductDataset(sessionId, dataset)
    return c.json({
      success: true,
      productId: payload.id,
      brandName: payload.brandName,
      totalProducts: payload.records.length,
      sourceFile: payload.sourceFile
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

interface RunRequestBody {
  options?: Partial<MappingOptions>
  productIds?: string[]
}

app.post('/api/session/:id/run', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const session = getSession(sessionId)
    if (!session) {
      return c.json({ error: 'Сессия не найдена' }, 404)
    }
    if (!session.categories || session.categories.length === 0) {
      return c.json({ error: 'Не загружена SEO структура' }, 400)
    }

    const body = (await c.req.json()) as RunRequestBody
    const options: MappingOptions = {
      ...DEFAULT_OPTIONS,
      ...(body.options ?? {})
    }

    const productIds = body.productIds ?? session.products.map((product) => product.id)
    const results = []

    for (const productId of productIds) {
      const payload = session.products.find((product) => product.id === productId)
      if (!payload) {
        continue
      }
      const mapping = await mapper.mapProducts(session.categories, payload, options)
      updateMapping(sessionId, productId, mapping)
      results.push({ productId, mapping })
    }

    return c.json({
      success: true,
      processed: results.map((item) => ({
        productId: item.productId,
        stats: item.mapping.stats
      }))
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

app.get('/api/session/:id/results', (c) => {
  const sessionId = c.req.param('id')
  const session = getSession(sessionId)
  if (!session) {
    return c.json({ error: 'Сессия не найдена' }, 404)
  }
  return c.json({
    categoriesLoaded: !!session.categories,
    products: session.products.map((product) => ({
      id: product.id,
      brandName: product.brandName,
      sourceFile: product.sourceFile,
      totalProducts: product.records.length,
      hasResults: !!product.mapped,
      stats: product.mapped?.stats,
      mappedItems: product.mapped?.items
    }))
  })
})

app.get('/api/session/:id/download/:productId', (c) => {
  try {
    const sessionId = c.req.param('id')
    const productId = c.req.param('productId')
    const session = getSession(sessionId)
    if (!session) {
      return c.json({ error: 'Сессия не найдена' }, 404)
    }
    const product = session.products.find((item) => item.id === productId)
    if (!product || !product.mapped) {
      return c.json({ error: 'Результат не найден' }, 404)
    }
    const workbook = buildWorkbook(product.mapped)
    const fileName = `processed_${product.sourceFile}`
    return new Response(workbook, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
      }
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

app.get('/api/session/:id/download', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const session = getSession(sessionId)
    if (!session) {
      return c.json({ error: 'Сессия не найдена' }, 404)
    }
    const ready = session.products.filter((product) => product.mapped)
    if (!ready.length) {
      return c.json({ error: 'Нет обработанных файлов' }, 400)
    }
    const archive = await buildZipArchive(
      ready.map((product) => ({
        filename: `processed_${product.sourceFile}`,
        mapping: product.mapped!
      }))
    )
    const zipName = `processed_products_${Date.now()}.zip`
    return new Response(archive, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`
      }
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

app.get('/api/sessions', () => {
  return Response.json({ sessions: listSessions() })
})

app.get('*', serveStatic({ root: './public', path: 'index.html' }))

export default app
