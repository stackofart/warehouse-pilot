import { createWorker, OEM, PSM } from 'tesseract.js'
import { buildColumnSheet, extractOrderTable } from './preprocess'

export type OcrProgress = {
  progress: number
  status: string
}

export type RecognizedOrderItem = {
  row: number
  address: string
  sku: string
  barcode: string
  description: string
  quantity: string
  unitsPerBox: string
  boxCount: string
  confidence: number
  warnings: string[]
  productVerification?: 'verified' | 'unverified'
  catalogProductId?: string
  catalogMatchScore?: number
  catalogMatchReason?: 'barcode' | 'sku' | 'identifiers' | 'combined' | 'none'
  catalogCorrectedFields?: Array<'address' | 'sku' | 'barcode' | 'description' | 'unitsPerBox'>
}

export type RecognizedOrderSummary = {
  itemCount: string
  totalQuantity: string
  packageCount: string
  totalWeightKg: string
}

export type OcrResult = {
  text: string
  confidence: number
  orderNumber: string
  summary: RecognizedOrderSummary
  items: RecognizedOrderItem[]
  validRowCount: number
  tablePreviewUrl: string
  detectedRows: number
  usedPerspectiveCorrection: boolean
  provider?: 'local' | 'openai'
  model?: string
}

type SheetValue = {
  text: string
  confidence: number
}

type TsvWord = {
  left: number
  text: string
  confidence: number
}

const publicPath = (path: string) => `${import.meta.env.BASE_URL}${path}`

function parseTsv(tsv: string | null, rowHeight: number, rowCount: number, rtl = false): SheetValue[] {
  const rows = Array.from({ length: rowCount }, () => [] as TsvWord[])
  if (!tsv) return rows.map(() => ({ text: '', confidence: 0 }))

  for (const line of tsv.split('\n').slice(1)) {
    const fields = line.split('\t')
    if (fields.length < 12 || fields[0] !== '5') continue
    const top = Number(fields[7])
    const height = Number(fields[9])
    const left = Number(fields[6])
    const confidence = Number(fields[10])
    const text = fields.slice(11).join('\t').trim()
    const row = Math.floor((top + height / 2) / rowHeight)
    if (text && row >= 0 && row < rowCount) rows[row].push({ left, text, confidence })
  }

  return rows.map((words) => {
    const ordered = [...words].sort((a, b) => rtl ? b.left - a.left : a.left - b.left)
    const confidence = ordered.length
      ? ordered.reduce((sum, word) => sum + Math.max(0, word.confidence), 0) / ordered.length
      : 0
    return {
      text: ordered.map((word) => word.text).join(' ').trim(),
      confidence,
    }
  })
}

async function recognizeSheet(
  worker: Tesseract.Worker,
  canvas: HTMLCanvasElement,
  rowHeight: number,
  rowCount: number,
  rtl = false,
) {
  const { data } = await worker.recognize(canvas, {}, { text: true, tsv: true })
  return parseTsv(data.tsv, rowHeight, rowCount, rtl)
}

async function recognizeCell(
  worker: Tesseract.Worker,
  tableCanvas: HTMLCanvasElement,
  band: { top: number; bottom: number },
  left: number,
  right: number,
  width = 320,
  binarize = false,
  rowHeight = 112,
): Promise<SheetValue> {
  const sheet = buildColumnSheet(tableCanvas, [band], left, right, { width, rowHeight, binarize })
  const { data } = await worker.recognize(sheet.canvas)
  return { text: data.text.trim(), confidence: data.confidence }
}

export function normalizeAddress(raw: string) {
  let value = raw.toUpperCase().replace(/[^0-9A-H.]/g, '')
  value = value.replace(/^I/, '1').replace(/^O/, '0')
  const suffixByDigit: Record<string, string> = { '0': 'D', '4': 'A', '5': 'F', '6': 'G', '8': 'B' }
  const compactDigitSuffix = value.match(/^(\d{1,2})\.?([04568])$/)
  if (compactDigitSuffix) value = `${compactDigitSuffix[1]}.${suffixByDigit[compactDigitSuffix[2]]}`
  const noisyLetterSuffix = value.match(/^(\d{1,2})8([A-H])$/)
  if (noisyLetterSuffix) value = `${noisyLetterSuffix[1]}.${noisyLetterSuffix[2]}`
  if (/^\d{1,2}[A-H]$/.test(value)) value = `${value.slice(0, -1)}.${value.slice(-1)}`
  const noisyTail = value.match(/(\d{1,2})\.?([04568])$/)
  if (noisyTail) value = `${noisyTail[1]}.${suffixByDigit[noisyTail[2]]}`
  const match = value.match(/\d{1,2}(?:\.\d)?\.[A-H]|\d{1,2}\.[A-H]/)
  return match?.[0] ?? value
}

export function normalizeDigits(raw: string, minimumLength = 1) {
  const candidates = raw.match(/\d+/g) ?? []
  return candidates.sort((a, b) => b.length - a.length).find((value) => value.length >= minimumLength) ?? ''
}

export function normalizeSku(raw: string) {
  const value = normalizeDigits(raw, 2)
  return value.length === 5 && value.startsWith('1') ? value.slice(1) : value
}

export function normalizeQuantity(raw: string) {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const match = cleaned.match(/\d+(?:\.\d{1,2})?/)
  if (!match) return ''
  const value = Number(match[0])
  if (!Number.isFinite(value)) return ''
  return value > 100 && Number.isInteger(value) && value % 100 === 0 ? String(value / 100) : String(value)
}

function normalizeBoxCount(raw: string) {
  const normalized = normalizeQuantity(raw)
  const exact = Number(normalized)
  if (Number.isInteger(exact) && exact >= 1 && exact <= 9) return String(exact)
  const digits: string[] = raw.match(/[1-9]/g) ?? []
  if (digits.includes('2')) return '2'
  if (digits.includes('1')) return '1'
  return ''
}

function cleanOcrLine(value: string) {
  return value
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseOrderNumber(...sources: string[]) {
  for (const source of sources) {
    const normalized = source
      .toUpperCase()
      .replace(/[|]/g, '1')
      .replace(/(?<=\d)[O](?=\d)/g, '0')
    const exact = normalized.match(/S[O0]\s*[-:]?\s*(26\d{6})/)
    if (exact) return `SO${exact[1]}`

    const orderLine = normalized.split(/\r?\n/).find((line) => /הזמנה|אישור|ORDER/.test(line)) ?? normalized
    const digits = orderLine.replace(/[^0-9]/g, '')
    const embedded = digits.match(/26\d{6}/)
    if (embedded) return `SO${embedded[0]}`
  }
  return ''
}

export function emptyOrderSummary(): RecognizedOrderSummary {
  return { itemCount: '', totalQuantity: '', packageCount: '', totalWeightKg: '' }
}

function numberNearLabel(text: string, label: RegExp) {
  for (const line of text.split(/\r?\n/).map(cleanOcrLine)) {
    if (!label.test(line)) continue
    label.lastIndex = 0
    const match = line.match(label)
    if (!match) continue
    const matchIndex = match.index ?? 0
    const after = line.slice(matchIndex + match[0].length).match(/\d+(?:[.,]\d+)?/)
    if (after) return after[0].replace(',', '.')
    const before = line.slice(0, matchIndex).match(/\d+(?:[.,]\d+)?(?=\D*$)/)
    if (before) return before[0].replace(',', '.')
  }
  return ''
}

export function parseOrderSummary(text: string): RecognizedOrderSummary {
  return {
    itemCount: numberNearLabel(text, /מס['׳״.\s]*פריטים/u),
    totalQuantity: numberNearLabel(text, /סה["״']?כ\s*כמות/u),
    packageCount: numberNearLabel(text, /מס['׳״.\s]*אריזות/u),
    totalWeightKg: numberNearLabel(text, /משקל/u),
  }
}

export function formatRecognizedOrderText(orderNumber: string, items: RecognizedOrderItem[], summary: RecognizedOrderSummary) {
  const lines = [orderNumber ? `Заказ: ${orderNumber}` : 'Заказ без распознанного номера']
  for (const item of items) {
    lines.push(`${item.row}. ${item.address} | ${item.sku} | ${item.barcode} | ${item.description} | ${item.unitsPerBox} × ${item.boxCount} = ${item.quantity}`)
  }
  const totals = [
    summary.itemCount ? `позиций ${summary.itemCount}` : '',
    summary.totalQuantity ? `количество ${summary.totalQuantity}` : '',
    summary.packageCount ? `упаковок ${summary.packageCount}` : '',
    summary.totalWeightKg ? `вес ${summary.totalWeightKg} кг` : '',
  ].filter(Boolean)
  if (totals.length) lines.push(`Итоги: ${totals.join(' · ')}`)
  return lines.join('\n')
}

async function buildImageRegion(
  image: File,
  region: { x: number; y: number; width: number; height: number },
  scale = 2,
) {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  const sourceX = Math.round(bitmap.width * region.x)
  const sourceY = Math.round(bitmap.height * region.y)
  const sourceWidth = Math.round(bitmap.width * region.width)
  const sourceHeight = Math.round(bitmap.height * region.height)
  canvas.width = sourceWidth * scale
  canvas.height = sourceHeight * scale
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is not available')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

function chooseAddress(primary: SheetValue, candidate: SheetValue) {
  const primaryValue = normalizeAddress(primary.text)
  const candidateValue = normalizeAddress(candidate.text)
  const addressPattern = /^\d{1,2}(?:\.\d)?\.[A-H]$/
  if (!addressPattern.test(candidateValue)) return primary
  if (!addressPattern.test(primaryValue)) return candidate
  if (candidateValue === primaryValue) return candidate.confidence > primary.confidence ? candidate : primary

  const primaryParts = primaryValue.match(/^(\d+).*([A-H])$/)
  const candidateParts = candidateValue.match(/^(\d+).*([A-H])$/)
  if (primaryParts && candidateParts && primaryParts[2] === candidateParts[2] && candidateParts[1].length > primaryParts[1].length) return candidate
  return candidate.confidence > primary.confidence + 18 ? candidate : primary
}

function chooseBarcode(primary: SheetValue, candidates: SheetValue[]) {
  const values = [primary, ...candidates].map((field) => ({
    field,
    value: normalizeDigits(field.text, 8),
  }))
  const valid = values.filter(({ value }) => isValidGtin(value))
  if (valid.length) return valid.sort((a, b) => b.field.confidence - a.field.confidence)[0].field
  return primary
}

export function isValidGtin(value: string) {
  if (![8, 12, 13, 14].includes(value.length) || !/^\d+$/.test(value)) return false
  const digits = value.split('').map(Number)
  const checkDigit = digits.pop()!
  let sum = 0
  let weight = 3
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += digits[index] * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10 === checkDigit
}

export function validateOrderItem(item: Pick<RecognizedOrderItem, 'address' | 'sku' | 'barcode' | 'description' | 'quantity' | 'unitsPerBox' | 'boxCount'>) {
  const warnings: string[] = []
  if (!/^\d{1,2}(?:\.\d)?\.[A-H]$/.test(item.address)) warnings.push('Проверьте адрес')
  if (!/^\d{3,7}$/.test(item.sku)) warnings.push('Проверьте מק״ט')
  if (!isValidGtin(item.barcode)) warnings.push('Ошибка штрихкода')
  if (!item.quantity || Number(item.quantity) <= 0) warnings.push('Проверьте количество')
  if (!item.unitsPerBox || Number(item.unitsPerBox) <= 0) warnings.push('Проверьте единиц в коробке')
  if (!item.boxCount || Number(item.boxCount) <= 0) warnings.push('Проверьте число коробок')
  if (Number(item.quantity) > 0 && Number(item.unitsPerBox) > 0 && Number(item.boxCount) > 0
    && Math.abs(Number(item.quantity) - Number(item.unitsPerBox) * Number(item.boxCount)) > .02) {
    warnings.push('Количество не совпадает с упаковками')
  }
  if (!item.description) warnings.push('Нет описания')
  return warnings
}

function makeItems(fields: {
  addresses: SheetValue[]
  skus: SheetValue[]
  barcodes: SheetValue[]
  descriptions: SheetValue[]
  quantities: SheetValue[]
  unitsPerBox: SheetValue[]
  boxCounts: SheetValue[]
}) {
  return fields.addresses.map((addressField, index): RecognizedOrderItem => {
    const address = normalizeAddress(addressField.text)
    const sku = normalizeSku(fields.skus[index]?.text ?? '')
    const barcode = normalizeDigits(fields.barcodes[index]?.text ?? '', 8)
    const description = fields.descriptions[index]?.text.trim() ?? ''
    const quantity = normalizeQuantity(fields.quantities[index]?.text ?? '')
    let unitsPerBox = normalizeQuantity(fields.unitsPerBox[index]?.text ?? '')
    const boxCount = normalizeBoxCount(fields.boxCounts[index]?.text ?? '')
    if (Number(quantity) > 0 && Number(boxCount) > 0) {
      const calculated = Number(quantity) / Number(boxCount)
      if (Number.isFinite(calculated)) unitsPerBox = String(Number(calculated.toFixed(2)))
    }
    const warnings = validateOrderItem({ address, sku, barcode, description, quantity, unitsPerBox, boxCount })
    const confidenceFields = [
      addressField.confidence,
      fields.skus[index]?.confidence ?? 0,
      fields.barcodes[index]?.confidence ?? 0,
      fields.descriptions[index]?.confidence ?? 0,
      fields.quantities[index]?.confidence ?? 0,
      fields.unitsPerBox[index]?.confidence ?? 0,
      fields.boxCounts[index]?.confidence ?? 0,
    ].filter((value) => value > 0)
    const confidence = confidenceFields.length
      ? Math.round(confidenceFields.reduce((sum, value) => sum + value, 0) / confidenceFields.length)
      : 0
    return { row: index + 1, address, sku, barcode, description, quantity, unitsPerBox, boxCount, confidence, warnings }
  })
}

export async function recognizeOrderImage(
  image: File,
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  onProgress({ progress: .02, status: 'detecting table' })
  const table = await extractOrderTable(image)
  onProgress({ progress: .14, status: 'building columns' })

  const columns = table.columnLines
  const end = columns.length - 1
  if (end < 8 || table.rowBands.length < 1) throw new Error('Order table grid was not detected')

  const rowCount = table.rowBands.length
  const addressSheet = buildColumnSheet(table.tableCanvas, table.rowBands, columns[end - 1], columns[end], { width: 300 })
  const skuSheet = buildColumnSheet(table.tableCanvas, table.rowBands, columns[end - 3], columns[end - 2], { width: 260 })
  const barcodeSheet = buildColumnSheet(table.tableCanvas, table.rowBands, columns[end - 4], columns[end - 3], { width: 430 })
  const descriptionSheet = buildColumnSheet(table.tableCanvas, table.rowBands, columns[end - 6], columns[end - 5], { width: 900, rtl: true, rowHeight: 78 })
  const unitsPerBoxSheet = buildColumnSheet(table.tableCanvas, table.rowBands, columns[4], columns[5], { width: 320 })
  const boxCountSheet = buildColumnSheet(table.tableCanvas, table.rowBands, columns[3], columns[4], { width: 260 })

  let currentStage = 'loading OCR'
  let stageStart = .15
  let stageSpan = .12
  const worker = await createWorker(['heb', 'eng'], OEM.LSTM_ONLY, {
    workerPath: publicPath('ocr/worker.min.js'),
    corePath: publicPath('ocr/core'),
    langPath: publicPath('ocr/lang'),
    workerBlobURL: false,
    logger: ({ progress }) => onProgress({ progress: Math.min(.98, stageStart + progress * stageSpan), status: currentStage }),
  })

  try {
    currentStage = 'reading addresses'
    stageStart = .27
    stageSpan = .1
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: '0123456789.ABCDEFGH',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
    const addresses = await recognizeSheet(worker, addressSheet.canvas, addressSheet.rowHeight, rowCount)

    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.ABCDEFGH',
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    })
    for (let index = 0; index < rowCount; index += 1) {
      stageStart = .34 + index / rowCount * .04
      stageSpan = .04 / rowCount
      const candidate = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[end - 1], columns[end], 320, true)
      addresses[index] = chooseAddress(addresses[index], candidate)
    }

    currentStage = 'reading sku'
    stageStart = .37
    stageSpan = .09
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_COLUMN })
    const skus = await recognizeSheet(worker, skuSheet.canvas, skuSheet.rowHeight, rowCount)

    const missingSkuRows = skus.map((value, index) => ({ value, index })).filter(({ value }) => !/^\d{3,7}$/.test(normalizeSku(value.text)))
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.RAW_LINE })
    for (let fallbackIndex = 0; fallbackIndex < missingSkuRows.length; fallbackIndex += 1) {
      const { index } = missingSkuRows[fallbackIndex]
      currentStage = 'reading sku'
      stageStart = .43 + fallbackIndex / Math.max(1, missingSkuRows.length) * .03
      stageSpan = .03 / Math.max(1, missingSkuRows.length)
      skus[index] = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[end - 3], columns[end - 2], 360)
    }

    const unresolvedSkuRows = skus.map((value, index) => ({ value, index })).filter(({ value }) => !/^\d{3,7}$/.test(normalizeSku(value.text)))
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_WORD })
    for (const { index } of unresolvedSkuRows) {
      skus[index] = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[end - 3], columns[end - 2], 420, true)
    }

    currentStage = 'reading barcodes'
    stageStart = .46
    stageSpan = .1
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_COLUMN })
    const barcodes = await recognizeSheet(worker, barcodeSheet.canvas, barcodeSheet.rowHeight, rowCount)

    const invalidBarcodeRows = barcodes
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => !isValidGtin(normalizeDigits(value.text, 8)))
    for (let fallbackIndex = 0; fallbackIndex < invalidBarcodeRows.length; fallbackIndex += 1) {
      const { index, value } = invalidBarcodeRows[fallbackIndex]
      currentStage = 'verifying barcodes'
      stageStart = .52 + fallbackIndex / Math.max(1, invalidBarcodeRows.length) * .04
      stageSpan = .04 / Math.max(1, invalidBarcodeRows.length)
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.RAW_LINE })
      const plain = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[end - 4], columns[end - 3], 620, false, 128)
      const binary = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[end - 4], columns[end - 3], 620, true, 128)
      barcodes[index] = chooseBarcode(value, [plain, binary])
    }

    currentStage = 'reading quantities'
    stageStart = .56
    stageSpan = .08
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: PSM.SINGLE_LINE })
    const quantities: SheetValue[] = []
    for (let index = 0; index < rowCount; index += 1) {
      stageStart = .56 + index / rowCount * .08
      stageSpan = .08 / rowCount
      quantities.push(await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[0], columns[1], 320, false, 92))
    }

    currentStage = 'reading packaging'
    stageStart = .62
    stageSpan = .08
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: PSM.SINGLE_COLUMN })
    const unitsPerBox = await recognizeSheet(worker, unitsPerBoxSheet.canvas, unitsPerBoxSheet.rowHeight, rowCount)
    const boxCounts = await recognizeSheet(worker, boxCountSheet.canvas, boxCountSheet.rowHeight, rowCount)

    await worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: PSM.SINGLE_CHAR })
    for (let index = 0; index < rowCount; index += 1) {
      if (!normalizeQuantity(unitsPerBox[index]?.text ?? '')) {
        const plain = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[4], columns[5], 400, false, 112)
        unitsPerBox[index] = normalizeQuantity(plain.text)
          ? plain
          : await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[4], columns[5], 400, true, 112)
      }
      if (!normalizeQuantity(boxCounts[index]?.text ?? '')) {
        const plain = await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[3], columns[4], 360, false, 112)
        boxCounts[index] = normalizeQuantity(plain.text)
          ? plain
          : await recognizeCell(worker, table.tableCanvas, table.rowBands[index], columns[3], columns[4], 360, true, 112)
      }
    }

    currentStage = 'reading descriptions'
    stageStart = .7
    stageSpan = .12
    await worker.setParameters({
      tessedit_char_whitelist: '',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    })
    const descriptions = await recognizeSheet(worker, descriptionSheet.canvas, descriptionSheet.rowHeight, rowCount, true)

    const weakDescriptions = descriptions
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value.text.replace(/[^\p{L}\p{N}]/gu, '').length < 5)
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.SINGLE_LINE })
    for (const { index } of weakDescriptions) {
      currentStage = 'verifying descriptions'
      descriptions[index] = await recognizeCell(
        worker,
        table.tableCanvas,
        table.rowBands[index],
        columns[end - 6],
        columns[end - 5],
        1200,
        false,
        132,
      )
    }

    currentStage = 'reading order number'
    stageStart = .82
    stageSpan = .04
    const orderRegion = await buildImageRegion(image, { x: .24, y: .22, width: .62, height: .13 })
    const { data: orderData } = await worker.recognize(orderRegion)

    currentStage = 'reading document'
    stageStart = .86
    stageSpan = .13
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.AUTO })
    const { data } = await worker.recognize(image, { rotateAuto: true })
    const items = makeItems({ addresses, skus, barcodes, descriptions, quantities, unitsPerBox, boxCounts })
    const validRowCount = items.filter((item) => item.warnings.length === 0).length

    const orderNumber = parseOrderNumber(orderData.text, data.text)
    const summary = parseOrderSummary(data.text)
    return {
      text: formatRecognizedOrderText(orderNumber, items, summary),
      confidence: Math.round(data.confidence),
      orderNumber,
      summary,
      items,
      validRowCount,
      tablePreviewUrl: table.previewUrl,
      detectedRows: rowCount,
      usedPerspectiveCorrection: table.usedPerspectiveCorrection,
      provider: 'local',
    }
  } finally {
    await worker.terminate()
  }
}
