import { jsonResponse, methodNotAllowed, readJson } from './http.js'

const MAX_PICKER_RESULTS = 20
const MAX_ADMIN_RESULTS = 100
const MAX_IMPORT_ROWS = 500

const text = (value, length = 500) => typeof value === 'string' ? value.trim().slice(0, length) : ''
const digits = (value, length = 32) => text(value, length).replace(/\D/g, '')
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null

function productFromRow(row, full = false) {
  const product = {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    location: row.location,
    unitsPerBox: row.units_per_box,
    verificationStatus: row.verification_status,
    version: row.version,
    updatedAt: row.updated_at,
  }
  if (!full) return product
  return {
    ...product,
    description: row.description || '',
    brand: row.brand || '',
    netContent: row.net_content || '',
    caseBarcode: row.case_barcode || '',
    itemSpec: {
      lengthCm: row.item_length_cm,
      widthCm: row.item_width_cm,
      heightCm: row.item_height_cm,
      weightKg: row.item_weight_kg,
    },
    boxSpec: {
      lengthCm: row.box_length_cm,
      widthCm: row.box_width_cm,
      heightCm: row.box_height_cm,
      weightKg: row.box_weight_kg,
      maxTopLoadKg: row.box_max_top_load_kg,
    },
    rigidity: row.rigidity,
    fragility: row.fragility,
    verificationSource: row.verification_source,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  }
}

function normalizedProduct(input, existingId = '') {
  const now = new Date().toISOString()
  return {
    id: text(input?.id, 80) || existingId || crypto.randomUUID(),
    sku: digits(input?.sku, 32),
    barcode: digits(input?.barcode, 32),
    name: text(input?.name, 300),
    location: text(input?.location, 32).toUpperCase(),
    description: text(input?.description, 2000),
    brand: text(input?.brand, 160),
    netContent: text(input?.netContent, 120),
    unitsPerBox: positive(input?.unitsPerBox),
    caseBarcode: digits(input?.caseBarcode, 32),
    itemSpec: input?.itemSpec && typeof input.itemSpec === 'object' ? input.itemSpec : {},
    boxSpec: input?.boxSpec && typeof input.boxSpec === 'object' ? input.boxSpec : {},
    rigidity: positive(input?.rigidity),
    fragility: positive(input?.fragility),
    verificationStatus: input?.verificationStatus === 'unverified' ? 'unverified' : 'verified',
    verificationSource: ['manual', 'imported', 'recognition', 'legacy'].includes(input?.verificationSource) ? input.verificationSource : 'imported',
    verifiedAt: input?.verificationStatus === 'unverified' ? null : text(input?.verifiedAt, 50) || now,
    now,
  }
}

function validateProduct(product) {
  if (!product.sku || !product.barcode || !product.name || !product.location) return 'Нужны מק״ט, штрихкод, название и адрес.'
  if (product.barcode.length < 8 || product.barcode.length > 14) return 'Штрихкод должен содержать от 8 до 14 цифр.'
  return ''
}

function productBindings(product, actorId) {
  return [
    product.id, product.sku, product.barcode, product.name, product.location, product.description,
    product.brand, product.netContent, product.unitsPerBox, product.caseBarcode,
    positive(product.itemSpec.lengthCm), positive(product.itemSpec.widthCm), positive(product.itemSpec.heightCm), positive(product.itemSpec.weightKg),
    positive(product.boxSpec.lengthCm), positive(product.boxSpec.widthCm), positive(product.boxSpec.heightCm), positive(product.boxSpec.weightKg), positive(product.boxSpec.maxTopLoadKg),
    product.rigidity, product.fragility, product.verificationStatus, product.verificationSource, product.verifiedAt,
    product.now, product.now, actorId,
  ]
}

const productInsertSql = `INSERT INTO products (
  id, sku, barcode, name, location, description, brand, net_content, units_per_box, case_barcode,
  item_length_cm, item_width_cm, item_height_cm, item_weight_kg,
  box_length_cm, box_width_cm, box_height_cm, box_weight_kg, box_max_top_load_kg,
  rigidity, fragility, verification_status, verification_source, verified_at,
  created_at, updated_at, updated_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

async function pickerSearch(request, env) {
  const url = new URL(request.url)
  const query = text(url.searchParams.get('q'), 120)
  if (query.length < 2) return jsonResponse({ error: 'Введите минимум два символа для поиска.', code: 'query_too_short' }, 400)
  const numeric = digits(query)
  const like = `%${query.replace(/[%_]/g, '')}%`
  const result = await env.DB.prepare(`SELECT id, sku, barcode, name, location, units_per_box, verification_status, version, updated_at
    FROM products
    WHERE deleted_at IS NULL AND (barcode = ? OR sku = ? OR name LIKE ? COLLATE NOCASE OR location LIKE ? COLLATE NOCASE)
    ORDER BY CASE WHEN barcode = ? THEN 0 WHEN sku = ? THEN 1 WHEN location = ? COLLATE NOCASE THEN 2 ELSE 3 END, name
    LIMIT ?`)
    .bind(numeric, numeric, like, like, numeric, numeric, query.toUpperCase(), MAX_PICKER_RESULTS)
    .all()
  return jsonResponse({ items: result.results.map((row) => productFromRow(row)), limit: MAX_PICKER_RESULTS })
}

async function matchProducts(request, env) {
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const items = Array.isArray(parsed.body?.items) ? parsed.body.items.slice(0, 100) : []
  const keys = [...new Set(items.flatMap((item) => [digits(item?.barcode), digits(item?.sku)].filter(Boolean)))].slice(0, 200)
  if (!keys.length) return jsonResponse({ items: [] })
  const placeholders = keys.map(() => '?').join(',')
  const result = await env.DB.prepare(`SELECT id, sku, barcode, name, location, units_per_box, verification_status, version, updated_at
    FROM products WHERE deleted_at IS NULL AND (barcode IN (${placeholders}) OR sku IN (${placeholders})) LIMIT 100`)
    .bind(...keys, ...keys)
    .all()
  return jsonResponse({ items: result.results.map((row) => productFromRow(row)) })
}

async function adminList(request, env) {
  const url = new URL(request.url)
  const query = text(url.searchParams.get('q'), 120)
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))
  const like = `%${query.replace(/[%_]/g, '')}%`
  const where = query ? 'deleted_at IS NULL AND (barcode = ? OR sku = ? OR name LIKE ? COLLATE NOCASE OR location LIKE ? COLLATE NOCASE)' : 'deleted_at IS NULL'
  const numeric = digits(query)
  const statement = env.DB.prepare(`SELECT * FROM products WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
  const result = query
    ? await statement.bind(numeric, numeric, like, like, MAX_ADMIN_RESULTS, offset).all()
    : await statement.bind(MAX_ADMIN_RESULTS, offset).all()
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN verification_status = 'unverified' THEN 1 ELSE 0 END) AS unverified FROM products WHERE deleted_at IS NULL`)
  const counts = await countStatement.first()
  return jsonResponse({ items: result.results.map((row) => productFromRow(row, true)), total: counts?.total ?? 0, unverified: counts?.unverified ?? 0, offset, limit: MAX_ADMIN_RESULTS })
}

async function adminCreate(request, env, user) {
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const product = normalizedProduct(parsed.body)
  const validation = validateProduct(product)
  if (validation) return jsonResponse({ error: validation, code: 'invalid_product' }, 400)
  try {
    await env.DB.prepare(productInsertSql).bind(...productBindings(product, user.id)).run()
  } catch (reason) {
    console.error('Product insert failed', reason)
    return jsonResponse({ error: 'Товар с таким מק״ט или штрихкодом уже существует.', code: 'product_conflict' }, 409)
  }
  return jsonResponse({ product }, 201)
}

async function adminImport(request, env, user) {
  const parsed = await readJson(request)
  if (parsed.response) return parsed.response
  const source = Array.isArray(parsed.body?.products) ? parsed.body.products : []
  if (!source.length) return jsonResponse({ error: 'Список товаров пуст.', code: 'empty_import' }, 400)
  if (source.length > MAX_IMPORT_ROWS) return jsonResponse({ error: `За один раз можно импортировать не более ${MAX_IMPORT_ROWS} товаров.`, code: 'import_too_large' }, 413)

  let created = 0
  let updated = 0
  let skipped = 0
  const errors = []
  for (let index = 0; index < source.length; index += 1) {
    const candidate = normalizedProduct(source[index])
    const validation = validateProduct(candidate)
    if (validation) {
      skipped += 1
      errors.push({ index, error: validation })
      continue
    }
    const matches = await env.DB.prepare('SELECT id FROM products WHERE deleted_at IS NULL AND (barcode = ? OR sku = ?) LIMIT 2').bind(candidate.barcode, candidate.sku).all()
    const matchedIds = [...new Set(matches.results.map((row) => row.id))]
    if (matchedIds.length > 1) {
      skipped += 1
      errors.push({ index, error: 'מק״ט и штрихкод принадлежат разным товарам.' })
      continue
    }
    const existing = matchedIds.length ? { id: matchedIds[0] } : null
    if (!existing) {
      try {
        await env.DB.prepare(productInsertSql).bind(...productBindings(candidate, user.id)).run()
        created += 1
      } catch (reason) {
        console.warn('Imported product insert failed', reason)
        skipped += 1
        errors.push({ index, error: 'Конфликт מק״ט или штрихкода.' })
      }
      continue
    }
    try {
      await env.DB.prepare(`UPDATE products SET sku = ?, barcode = ?, name = ?, location = ?, description = ?, brand = ?, net_content = ?, units_per_box = ?, case_barcode = ?,
        item_length_cm = ?, item_width_cm = ?, item_height_cm = ?, item_weight_kg = ?, box_length_cm = ?, box_width_cm = ?, box_height_cm = ?, box_weight_kg = ?, box_max_top_load_kg = ?,
        rigidity = ?, fragility = ?, verification_status = ?, verification_source = ?, verified_at = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(candidate.sku, candidate.barcode, candidate.name, candidate.location, candidate.description, candidate.brand, candidate.netContent, candidate.unitsPerBox, candidate.caseBarcode,
          positive(candidate.itemSpec.lengthCm), positive(candidate.itemSpec.widthCm), positive(candidate.itemSpec.heightCm), positive(candidate.itemSpec.weightKg),
          positive(candidate.boxSpec.lengthCm), positive(candidate.boxSpec.widthCm), positive(candidate.boxSpec.heightCm), positive(candidate.boxSpec.weightKg), positive(candidate.boxSpec.maxTopLoadKg),
          candidate.rigidity, candidate.fragility, candidate.verificationStatus, candidate.verificationSource, candidate.verifiedAt, candidate.now, user.id, existing.id)
        .run()
      updated += 1
    } catch (reason) {
      console.warn('Imported product update failed', reason)
      skipped += 1
      errors.push({ index, error: 'Не удалось обновить товар из-за конфликта.' })
    }
  }
  await env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, 'catalog_imported', 'product_catalog', 'shared', JSON.stringify({ created, updated, skipped }), new Date().toISOString())
    .run()
  return jsonResponse({ created, updated, skipped, errors: errors.slice(0, 25) })
}

export async function handleCatalogRequest(request, env, user, isAdmin) {
  const url = new URL(request.url)
  if (url.pathname === '/api/catalog/search') {
    return request.method === 'GET' ? pickerSearch(request, env) : methodNotAllowed(['GET'])
  }
  if (url.pathname === '/api/catalog/match') {
    return request.method === 'POST' ? matchProducts(request, env) : methodNotAllowed(['POST'])
  }
  if (url.pathname === '/api/admin/products') {
    if (!isAdmin) return jsonResponse({ error: 'Эта операция доступна только администратору.', code: 'admin_required' }, 403)
    if (request.method === 'GET') return adminList(request, env)
    if (request.method === 'POST') return adminCreate(request, env, user)
    return methodNotAllowed(['GET', 'POST'])
  }
  if (url.pathname === '/api/admin/products/import') {
    if (!isAdmin) return jsonResponse({ error: 'Эта операция доступна только администратору.', code: 'admin_required' }, 403)
    return request.method === 'POST' ? adminImport(request, env, user) : methodNotAllowed(['POST'])
  }
  return null
}
