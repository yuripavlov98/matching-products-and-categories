import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import type { MappingResponse, MappedProduct } from './types'

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return ''
  return value
}

function buildCategoryBrand(brandName: string | null | undefined, categoryPath: string | null): string {
  const normalized = typeof categoryPath === 'string' ? categoryPath.trim() : ''
  if (!normalized) {
    return brandName ?? ''
  }
  if (normalized.toLowerCase() === 'не найдено') {
    return 'Не найдено'
  }
  if (!brandName) {
    return normalized
  }
  const levels = normalized.split('///').map((level) => level.trim()).filter(Boolean)
  if (!levels.length) {
    return `${brandName}///${normalized} ${brandName}`
  }
  return [...levels.map((level) => `${brandName}///${level}`), brandName].join(' ')
}

const OUTPUT_COLUMNS = [
  'Product code',
  'Language',
  'Category old',
  'Category',
  'Category brand',
  'Price',
  'Images',
  'Product name',
  'Description',
  'Meta description',
  'Page title',
  'SEO name',
  'Характеристики'
] as const

function buildRow(product: MappedProduct, brandName: string | null): Record<string, unknown> {
  const row: Record<string, unknown> = {}

  const productCode =
    (product.fields['Product code'] as unknown) ??
    (product.fields['product code'] as unknown) ??
    (product.fields['Артикул'] as unknown) ??
    ''
  const originalCategory =
    (product.fields['Category'] as unknown) ??
    (product.fields['category'] as unknown) ??
    product.categoryOld ??
    ''
  const productName =
    product.productName ||
    (product.fields['Product name'] as unknown as string) ||
    (product.fields['product name'] as unknown as string) ||
    ''
  const rawCategory = typeof product.seoCategory === 'string' ? product.seoCategory : 'Не найдено'
  const normalizedCategory = rawCategory
    .split('///')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('///') || 'Не найдено'
  const inferredBrand = (product.fields['Brand'] as string) || (product.fields['brand'] as string) || undefined

  row['Product code'] = normalizeValue(productCode)
  row['Language'] = normalizeValue(product.fields['Language'] ?? product.fields['language'] ?? '')
  row['Category old'] = normalizeValue(originalCategory)
  row['Category'] = normalizeValue(normalizedCategory)
  row['Category brand'] = buildCategoryBrand(brandName ?? inferredBrand, normalizedCategory)
  row['Price'] = normalizeValue(product.fields['Price'] ?? product.fields['price'] ?? '')
  row['Images'] = normalizeValue(product.fields['Images'] ?? product.fields['images'] ?? '')
  row['Product name'] = normalizeValue(productName)
  row['Description'] = normalizeValue(product.fields['Description'] ?? product.fields['description'] ?? '')
  row['Meta description'] = normalizeValue(
    product.fields['Meta description'] ?? product.fields['meta description'] ?? ''
  )
  row['Page title'] = normalizeValue(product.fields['Page title'] ?? product.fields['page title'] ?? '')
  row['SEO name'] = normalizeValue(product.fields['SEO name'] ?? product.fields['seo name'] ?? '')
  row['Характеристики'] = normalizeValue(product.fields['Характеристики'] ?? '')

  const preserved = { ...product.fields }
  delete preserved['Category']
  delete preserved['category']
  delete preserved['Product name']
  delete preserved['product name']
  delete preserved['Product code']
  delete preserved['product code']

  Object.keys(preserved).forEach((key) => {
    if (!(key in row)) {
      row[key] = normalizeValue(preserved[key])
    }
  })

  const orderedRow: Record<string, unknown> = {}
  OUTPUT_COLUMNS.forEach((column) => {
    orderedRow[column] = column in row ? row[column] : ''
  })

  Object.keys(row).forEach((key) => {
    if (!(key in orderedRow)) {
      orderedRow[key] = row[key]
    }
  })

  return orderedRow
}

export function buildWorkbook(mapping: MappingResponse): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  const brand = mapping.stats.brandName ?? null
  const rows = mapping.items.map((item) => buildRow(item, brand))
  const worksheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
}

export async function buildZipArchive(mappings: { filename: string; mapping: MappingResponse }[]): Promise<ArrayBuffer> {
  const zip = new JSZip()
  mappings.forEach(({ filename, mapping }) => {
    const workbookArray = buildWorkbook(mapping)
    const uint8 = new Uint8Array(workbookArray)
    zip.file(filename, uint8)
  })
  const content = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  return content
}
