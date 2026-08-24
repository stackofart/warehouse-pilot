import { emptyOrderSummary, type OcrResult, type RecognizedOrderSummary } from './ocr'

function mergeSummary(results: OcrResult[]): RecognizedOrderSummary {
  const merged = emptyOrderSummary()
  for (const key of Object.keys(merged) as Array<keyof RecognizedOrderSummary>) {
    for (let index = results.length - 1; index >= 0; index -= 1) {
      if (results[index].summary[key]) {
        merged[key] = results[index].summary[key]
        break
      }
    }
  }
  return merged
}

export function mergeOcrResults(results: OcrResult[]): OcrResult {
  if (!results.length) throw new Error('Нет результатов распознавания')
  const items = results.flatMap((result) => result.items).map((item, index) => ({ ...item, row: index + 1 }))
  const confidence = Math.round(results.reduce((sum, result) => sum + result.confidence, 0) / results.length)
  return {
    ...results[0],
    text: results.map((result) => result.text).filter(Boolean).join('\n\n--- Следующее фото ---\n\n'),
    confidence,
    orderNumber: results.map((result) => result.orderNumber).find(Boolean) ?? '',
    summary: mergeSummary(results),
    items,
    validRowCount: items.filter((item) => item.warnings.length === 0).length,
    detectedRows: items.length,
    usedPerspectiveCorrection: results.some((result) => result.usedPerspectiveCorrection),
  }
}
