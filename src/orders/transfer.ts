import { isValidGtin, validateOrderItem, type RecognizedCustomer, type RecognizedOrderItem } from '../recognition/ocr'
import { saveOrderProducts } from '../products/storage'
import { saveOrder, type SavedOrder } from './storage'

export const ORDER_DOCUMENT_SCHEMA = 'warehouse-pilot.order'
export const ORDER_DOCUMENT_VERSION = 1

type OrderCustomerTransfer = Omit<RecognizedCustomer, 'raw'>

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
    customer: OrderCustomerTransfer
    items: OrderItemTransfer[]
  }
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
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${path}: неизвестное поле «${key}»`)
  }
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

function parseCustomer(value: unknown, issues: string[]): OrderCustomerTransfer {
  const path = 'order.customer'
  const keys = ['name', 'address', 'city', 'phone', 'customerNumber']
  if (!isRecord(value)) {
    issues.push(`${path}: ожидается объект`)
    return { name: '', address: '', city: '', phone: '', customerNumber: '' }
  }
  checkExactKeys(value, keys, path, issues)
  for (const key of keys) {
    if (!(key in value)) issues.push(`${path}.${key}: поле обязательно (используйте пустую строку, если данных нет)`)
  }
  return {
    name: requireText(value.name, `${path}.name`, issues, { allowEmpty: true, maxLength: 200 }),
    address: requireText(value.address, `${path}.address`, issues, { allowEmpty: true, maxLength: 200 }),
    city: requireText(value.city, `${path}.city`, issues, { allowEmpty: true, maxLength: 100 }),
    phone: requireText(value.phone, `${path}.phone`, issues, { allowEmpty: true, maxLength: 40 }),
    customerNumber: requireText(value.customerNumber, `${path}.customerNumber`, issues, { allowEmpty: true, maxLength: 64 }),
  }
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
  if (quantity && unitsPerBox && boxCount && Math.abs(quantity - unitsPerBox * boxCount) > .02) {
    issues.push(`${path}: quantity должен равняться unitsPerBox × boxCount`)
  }

  return { row, address, sku, barcode, description, quantity, unitsPerBox, boxCount }
}

export function parseOrderDocument(text: string): OrderDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new OrderImportValidationError(['Файл не является корректным JSON'])
  }

  const issues: string[] = []
  if (!isRecord(value)) throw new OrderImportValidationError(['Корень JSON должен быть объектом'])
  checkExactKeys(value, ['schema', 'version', 'order'], '$', issues)
  if (value.schema !== ORDER_DOCUMENT_SCHEMA) issues.push(`schema: ожидается «${ORDER_DOCUMENT_SCHEMA}»`)
  if (value.version !== ORDER_DOCUMENT_VERSION) issues.push(`version: поддерживается только ${ORDER_DOCUMENT_VERSION}`)

  const orderValue = value.order
  let orderNumber = ''
  let customer: OrderCustomerTransfer = { name: '', address: '', city: '', phone: '', customerNumber: '' }
  let items: OrderItemTransfer[] = []
  if (!isRecord(orderValue)) {
    issues.push('order: ожидается объект')
  } else {
    checkExactKeys(orderValue, ['orderNumber', 'customer', 'items'], 'order', issues)
    orderNumber = requireText(orderValue.orderNumber, 'order.orderNumber', issues, { maxLength: 64 })
    customer = parseCustomer(orderValue.customer, issues)
    if (!Array.isArray(orderValue.items) || orderValue.items.length === 0) {
      issues.push('order.items: нужен непустой массив')
    } else {
      items = orderValue.items.map((item, index) => parseItem(item, index, issues))
      const seenRows = new Set<number>()
      for (const item of items) {
        if (seenRows.has(item.row)) issues.push(`order.items: номер строки ${item.row} повторяется`)
        seenRows.add(item.row)
      }
    }
  }

  if (issues.length) throw new OrderImportValidationError(issues)
  return { schema: ORDER_DOCUMENT_SCHEMA, version: ORDER_DOCUMENT_VERSION, order: { orderNumber, customer, items } }
}

function toRecognizedItem(item: OrderItemTransfer): RecognizedOrderItem {
  const converted = {
    ...item,
    quantity: String(item.quantity),
    unitsPerBox: String(item.unitsPerBox),
    boxCount: String(item.boxCount),
  }
  return { ...converted, confidence: 100, warnings: validateOrderItem(converted) }
}

export async function importOrderDocument(document: OrderDocument, sourceFileName: string, existingOrders: SavedOrder[]) {
  const duplicate = existingOrders.find((order) => normalizeText(order.orderNumber).toLocaleLowerCase() === normalizeText(document.order.orderNumber).toLocaleLowerCase())
  if (duplicate) throw new OrderImportValidationError([`order.orderNumber: заказ «${document.order.orderNumber}» уже сохранён`])

  const items = document.order.items.map(toRecognizedItem)
  const savedOrder = await saveOrder({
    id: crypto.randomUUID(),
    orderNumber: document.order.orderNumber,
    customer: { ...document.order.customer, raw: '' },
    items,
    rawText: '',
    sourceFileName,
  })
  const products = await saveOrderProducts(items, false)
  return { savedOrder, products }
}

export const orderJsonSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  '$id': 'https://warehouse-pilot.local/schemas/order-import-v1.schema.json',
  title: 'Warehouse Pilot order import v1',
  description: 'Один локально импортируемый заказ Warehouse Pilot.',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'version', 'order'],
  properties: {
    schema: { const: ORDER_DOCUMENT_SCHEMA },
    version: { const: ORDER_DOCUMENT_VERSION },
    order: { '$ref': '#/$defs/order' },
  },
  '$defs': {
    customer: {
      type: 'object', additionalProperties: false,
      required: ['name', 'address', 'city', 'phone', 'customerNumber'],
      properties: {
        name: { type: 'string', maxLength: 200 }, address: { type: 'string', maxLength: 200 },
        city: { type: 'string', maxLength: 100 }, phone: { type: 'string', maxLength: 40 }, customerNumber: { type: 'string', maxLength: 64 },
      },
    },
    item: {
      type: 'object', additionalProperties: false,
      required: ['row', 'address', 'sku', 'barcode', 'description', 'quantity', 'unitsPerBox', 'boxCount'],
      properties: {
        row: { type: 'integer', minimum: 1, description: 'Уникальный порядковый номер строки внутри заказа.' },
        address: { type: 'string', pattern: '^[1-9]\\d{0,2}\\.[A-H]$', examples: ['23.F'] },
        sku: { type: 'string', pattern: '^\\d{3,10}$', description: 'מק״ט хранится строкой, чтобы не терять ведущие нули.' },
        barcode: { type: 'string', pattern: '^(?:\\d{8}|\\d{12}|\\d{13}|\\d{14})$', description: 'GTIN с корректной контрольной цифрой.' },
        description: { type: 'string', minLength: 1, maxLength: 500 },
        quantity: { type: 'number', exclusiveMinimum: 0, description: 'Общее количество единиц товара.' },
        unitsPerBox: { type: 'integer', minimum: 1, description: 'Количество единиц товара в одной коробке.' },
        boxCount: { type: 'integer', minimum: 1, description: 'Количество коробок. quantity = unitsPerBox × boxCount.' },
      },
    },
    order: {
      type: 'object', additionalProperties: false, required: ['orderNumber', 'customer', 'items'],
      properties: {
        orderNumber: { type: 'string', minLength: 1, maxLength: 64 },
        customer: { '$ref': '#/$defs/customer' },
        items: { type: 'array', minItems: 1, items: { '$ref': '#/$defs/item' } },
      },
    },
  },
} as const

export const orderImportExample: OrderDocument = {
  schema: ORDER_DOCUMENT_SCHEMA,
  version: ORDER_DOCUMENT_VERSION,
  order: {
    orderNumber: 'SO26017112',
    customer: { name: 'Название клиента', address: 'Улица, дом', city: 'Город', phone: '0520000000', customerNumber: '4527' },
    items: [
      { row: 1, address: '23.F', sku: '1511', barcode: '7290121920285', description: 'Milka шоколад молочный 90 г', quantity: 48, unitsPerBox: 24, boxCount: 2 },
    ],
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
2. \`order.orderNumber\` — непустая строка, уникальная среди уже сохранённых заказов. Совпадение номера блокирует импорт.
3. Объект \`customer\` и все пять его полей обязательны. Если сведений нет, передайте пустую строку \`""\`.
4. \`items\` — непустой массив. \`row\` — уникальный положительный целый номер строки.
5. Адрес записывается как \`ROW.SECTOR\`: номер ряда, точка и заглавная буква A–H, например \`23.F\`. Геометрическая доступность адреса проверяется отдельно при построении маршрута.
6. \`sku\` (מק״ט) — строка из 3–10 цифр. \`barcode\` — строка GTIN-8/12/13/14 с корректной контрольной цифрой. Числовые коды нельзя передавать JSON-числами: это может удалить ведущие нули.
7. \`quantity\` — общее количество единиц, \`unitsPerBox\` — единиц в коробке, \`boxCount\` — число коробок. Обязательно равенство \`quantity = unitsPerBox × boxCount\` с допуском 0,02.
8. Неизвестные поля запрещены. Ошибочный файл целиком отклоняется и ничего не сохраняет.
9. После успешного импорта заказ появляется в разделе «Заказы». Новые товары также добавляются в справочник по מק״ט/штрихкоду; существующие карточки товара импорт заказа не перезаписывает.

Полное машинно-читаемое описание доступно в файле \`warehouse-pilot-order.schema.json\`, который скачивается рядом с этой инструкцией.
`
