import { emptyOrderSummary, formatRecognizedOrderText, isValidGtin, validateOrderItem, type RecognizedOrderItem, type RecognizedOrderSummary } from '../recognition/ocr'
import { saveOrderProducts } from '../products/storage'
import { saveOrder, type SavedOrder } from './storage'

export const ORDER_DOCUMENT_SCHEMA = 'warehouse-pilot.order'
export const ORDER_DOCUMENT_VERSION = 2
export const ORDERS_BACKUP_SCHEMA = 'warehouse-pilot.orders-backup'

export type OrderItemTransfer = {
  row: number
  address: string
  sku: string
  barcode: string
  description: string
  quantity: number
  unitsPerBox: number
  boxCount: number
}

export type OrderDocument = {
  schema: typeof ORDER_DOCUMENT_SCHEMA
  version: typeof ORDER_DOCUMENT_VERSION
  order: {
    orderNumber: string
    notes?: string
    summary?: RecognizedOrderSummary
    items: OrderItemTransfer[]
  }
}

export type OrdersDatabaseExport = {
  schema: typeof ORDERS_BACKUP_SCHEMA
  version: 1
  exportedAt: string
  orders: Array<Omit<SavedOrder, 'customer'>>
}

export class OrderImportValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Файл заказа не прошёл проверку (${issues.length})`)
    this.name = 'OrderImportValidationError'
    this.issues = issues
  }
}

const ADDRESS_PATTERN = /^[1-9]\d{0,2}\.[A-H]$/
const SKU_PATTERN = /^\d{3,10}$/
const BARCODE_PATTERN = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const normalizeText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function checkExactKeys(value: Record<string, unknown>, allowed: string[], path: string, issues: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(`${path}: неизвестное поле «${key}»`)
}

function requireText(value: unknown, path: string, issues: string[], options: { allowEmpty?: boolean; maxLength?: number } = {}) {
  if (typeof value !== 'string') {
    issues.push(`${path}: ожидается строка`)
    return ''
  }
  const result = value.trim()
  if (!options.allowEmpty && !result) issues.push(`${path}: поле обязательно`)
  if (result.length > (options.maxLength ?? 500)) issues.push(`${path}: превышена максимальная длина ${options.maxLength ?? 500}`)
  return result
}

function requirePositiveNumber(value: unknown, path: string, issues: string[], integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    issues.push(`${path}: ожидается ${integer ? 'целое ' : ''}число больше нуля`)
    return 0
  }
  return value
}

function parseSummary(value: unknown, issues: string[]): RecognizedOrderSummary {
  const summary = emptyOrderSummary()
  if (value === undefined) return summary
  if (!isRecord(value)) {
    issues.push('order.summary: ожидается объект')
    return summary
  }
  const keys = Object.keys(summary) as Array<keyof RecognizedOrderSummary>
  checkExactKeys(value, keys, 'order.summary', issues)
  for (const key of keys) {
    if (!(key in value)) issues.push(`order.summary.${key}: поле обязательно (используйте пустую строку, если значения нет)`)
    summary[key] = requireText(value[key], `order.summary.${key}`, issues, { allowEmpty: true, maxLength: 32 })
  }
  return summary
}

function parseItem(value: unknown, index: number, issues: string[]): OrderItemTransfer {
  const path = `order.items[${index}]`
  const keys = ['row', 'address', 'sku', 'barcode', 'description', 'quantity', 'unitsPerBox', 'boxCount']
  if (!isRecord(value)) {
    issues.push(`${path}: ожидается объект`)
    return { row: index + 1, address: '', sku: '', barcode: '', description: '', quantity: 0, unitsPerBox: 0, boxCount: 0 }
  }
  checkExactKeys(value, keys, path, issues)
  for (const key of keys) if (!(key in value)) issues.push(`${path}.${key}: поле обязательно`)
  const row = requirePositiveNumber(value.row, `${path}.row`, issues, true)
  const address = requireText(value.address, `${path}.address`, issues, { maxLength: 10 }).toUpperCase()
  const sku = requireText(value.sku, `${path}.sku`, issues, { maxLength: 10 })
  const barcode = requireText(value.barcode, `${path}.barcode`, issues, { maxLength: 14 })
  const description = requireText(value.description, `${path}.description`, issues, { maxLength: 500 })
  const quantity = requirePositiveNumber(value.quantity, `${path}.quantity`, issues)
  const unitsPerBox = requirePositiveNumber(value.unitsPerBox, `${path}.unitsPerBox`, issues, true)
  const boxCount = requirePositiveNumber(value.boxCount, `${path}.boxCount`, issues, true)
  if (address && !ADDRESS_PATTERN.test(address)) issues.push(`${path}.address: нужен формат ROW.SECTOR, например 23.F`)
  if (sku && !SKU_PATTERN.test(sku)) issues.push(`${path}.sku: ожидается строка из 3–10 цифр`)
  if (barcode && (!BARCODE_PATTERN.test(barcode) || !isValidGtin(barcode))) issues.push(`${path}.barcode: нужен корректный GTIN-8/12/13/14 с верной контрольной цифрой`)
  if (quantity && unitsPerBox && boxCount && Math.abs(quantity - unitsPerBox * boxCount) > .02) issues.push(`${path}: quantity должен равняться unitsPerBox × boxCount`)
  return { row, address, sku, barcode, description, quantity, unitsPerBox, boxCount }
}

export function parseOrderDocument(text: string): OrderDocument {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new OrderImportValidationError(['Файл не является корректным JSON']) }
  const issues: string[] = []
  if (!isRecord(value)) throw new OrderImportValidationError(['Корень JSON должен быть объектом'])
  checkExactKeys(value, ['schema', 'version', 'order'], '$', issues)
  if (value.schema !== ORDER_DOCUMENT_SCHEMA) issues.push(`schema: ожидается «${ORDER_DOCUMENT_SCHEMA}»`)
  if (value.version !== 1 && value.version !== ORDER_DOCUMENT_VERSION) issues.push(`version: поддерживаются версии 1 и ${ORDER_DOCUMENT_VERSION}`)

  const orderValue = value.order
  let orderNumber = ''
  let notes = ''
  let summary = emptyOrderSummary()
  let items: OrderItemTransfer[] = []
  if (!isRecord(orderValue)) {
    issues.push('order: ожидается объект')
  } else {
    // customer is accepted for v1 compatibility, then deliberately discarded.
    checkExactKeys(orderValue, ['orderNumber', 'notes', 'summary', 'customer', 'items'], 'order', issues)
    orderNumber = requireText(orderValue.orderNumber, 'order.orderNumber', issues, { maxLength: 64 })
    if ('notes' in orderValue) notes = requireText(orderValue.notes, 'order.notes', issues, { allowEmpty: true, maxLength: 2000 })
    summary = parseSummary(orderValue.summary, issues)
    if (!Array.isArray(orderValue.items) || orderValue.items.length === 0) issues.push('order.items: нужен непустой массив')
    else {
      items = orderValue.items.map((item, index) => parseItem(item, index, issues))
      const seenRows = new Set<number>()
      for (const item of items) {
        if (seenRows.has(item.row)) issues.push(`order.items: номер строки ${item.row} повторяется`)
        seenRows.add(item.row)
      }
    }
  }
  if (issues.length) throw new OrderImportValidationError(issues)
  return { schema: ORDER_DOCUMENT_SCHEMA, version: ORDER_DOCUMENT_VERSION, order: { orderNumber, notes, summary, items } }
}

function toRecognizedItem(item: OrderItemTransfer): RecognizedOrderItem {
  const converted = { ...item, quantity: String(item.quantity), unitsPerBox: String(item.unitsPerBox), boxCount: String(item.boxCount) }
  return { ...converted, confidence: 100, warnings: validateOrderItem(converted), productVerification: 'verified' }
}

export async function importOrderDocument(document: OrderDocument, sourceFileName: string, existingOrders: SavedOrder[]) {
  const duplicate = existingOrders.find((order) => normalizeText(order.orderNumber).toLocaleLowerCase() === normalizeText(document.order.orderNumber).toLocaleLowerCase())
  if (duplicate) throw new OrderImportValidationError([`order.orderNumber: заказ «${document.order.orderNumber}» уже сохранён`])
  const items = document.order.items.map(toRecognizedItem)
  const savedOrder = await saveOrder({
    id: crypto.randomUUID(), orderNumber: document.order.orderNumber, notes: document.order.notes ?? '',
    summary: document.order.summary ?? emptyOrderSummary(), items, rawText: '', sourceFileName, sourceFileNames: [sourceFileName],
  })
  const products = await saveOrderProducts(items, { overwriteExisting: false, newProductVerification: 'verified', source: 'imported' })
  return { savedOrder, products }
}

export function createOrdersDatabaseExport(orders: SavedOrder[]): OrdersDatabaseExport {
  return {
    schema: ORDERS_BACKUP_SCHEMA, version: 1, exportedAt: new Date().toISOString(),
    orders: orders.map(({ customer: _legacyCustomer, ...order }) => ({
      ...order,
      rawText: formatRecognizedOrderText(order.orderNumber, order.items, order.summary ?? emptyOrderSummary()),
      summary: order.summary ?? emptyOrderSummary(),
      sourceFileNames: order.sourceFileNames ?? (order.sourceFileName ? [order.sourceFileName] : []),
    })),
  }
}

export const orderJsonSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': 'https://warehouse-pilot.local/schemas/order-import-v2.schema.json',
  title: 'Warehouse Pilot order import v2', description: 'Один локально импортируемый заказ Warehouse Pilot без данных заказчика.',
  type: 'object', additionalProperties: false, required: ['schema', 'version', 'order'],
  properties: { schema: { const: ORDER_DOCUMENT_SCHEMA }, version: { const: ORDER_DOCUMENT_VERSION }, order: { '$ref': '#/$defs/order' } },
  '$defs': {
    summary: { type: 'object', additionalProperties: false, required: ['itemCount', 'totalQuantity', 'packageCount', 'totalWeightKg'], properties: { itemCount: { type: 'string' }, totalQuantity: { type: 'string' }, packageCount: { type: 'string' }, totalWeightKg: { type: 'string' } } },
    item: { type: 'object', additionalProperties: false, required: ['row', 'address', 'sku', 'barcode', 'description', 'quantity', 'unitsPerBox', 'boxCount'], properties: {
      row: { type: 'integer', minimum: 1 }, address: { type: 'string', pattern: '^[1-9]\\d{0,2}\\.[A-H]$' }, sku: { type: 'string', pattern: '^\\d{3,10}$' },
      barcode: { type: 'string', pattern: '^(?:\\d{8}|\\d{12}|\\d{13}|\\d{14})$' }, description: { type: 'string', minLength: 1, maxLength: 500 },
      quantity: { type: 'number', exclusiveMinimum: 0 }, unitsPerBox: { type: 'integer', minimum: 1 }, boxCount: { type: 'integer', minimum: 1 },
    } },
    order: { type: 'object', additionalProperties: false, required: ['orderNumber', 'items'], properties: {
      orderNumber: { type: 'string', minLength: 1, maxLength: 64 }, notes: { type: 'string', maxLength: 2000 }, summary: { '$ref': '#/$defs/summary' },
      items: { type: 'array', minItems: 1, items: { '$ref': '#/$defs/item' } },
    } },
  },
} as const

export const orderImportExample: OrderDocument = {
  schema: ORDER_DOCUMENT_SCHEMA, version: ORDER_DOCUMENT_VERSION,
  order: {
    orderNumber: 'SO26017112', notes: 'Проверить замену перед сборкой',
    summary: { itemCount: '13', totalQuantity: '369', packageCount: '24', totalWeightKg: '77.71' },
    items: [{ row: 1, address: '23.F', sku: '1511', barcode: '7290121920285', description: 'Milka шоколад молочный 90 г', quantity: 48, unitsPerBox: 24, boxCount: 2 }],
  },
}

export const orderImportInstructions = `# Импорт заказа в Warehouse Pilot

Формат: UTF-8 JSON. Один файл содержит ровно один заказ. Текущая схема: \`${ORDER_DOCUMENT_SCHEMA}\`, версия \`${ORDER_DOCUMENT_VERSION}\`.

## Обязательная структура

\`\`\`json
${JSON.stringify(orderImportExample, null, 2)}
\`\`\`

## Правила

1. На верхнем уровне допустимы только \`schema\`, \`version\` и \`order\`.
2. \`order.orderNumber\` — непустая строка, уникальная среди уже сохранённых заказов.
3. Данные заказчика не импортируются и не хранятся. Старое поле \`customer\` из версии 1 принимается только для совместимости и отбрасывается.
4. \`summary\` необязателен. Его строковые поля: \`itemCount\`, \`totalQuantity\`, \`packageCount\`, \`totalWeightKg\`. Для неизвестного значения используйте пустую строку.
5. \`items\` — непустой массив. \`row\` — уникальный положительный целый номер строки.
6. Адрес записывается как \`ROW.SECTOR\`, например \`23.F\`.
7. \`sku\` — строка из 3–10 цифр. \`barcode\` — строка GTIN-8/12/13/14 с корректной контрольной цифрой.
8. Обязательно равенство \`quantity = unitsPerBox × boxCount\` с допуском 0,02.
9. Неизвестные поля запрещены. Ошибочный файл целиком отклоняется.
10. Новые товары из проверенного JSON-импорта добавляются как проверенные; существующие карточки не перезаписываются.

Полное машинно-читаемое описание доступно в файле \`warehouse-pilot-order.schema.json\`.
`
