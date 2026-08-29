import readerWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export type DecodedBarcode = {
  text: string
  format: string
  orientation: number
  lineCount: number
}

type ZXingReader = typeof import('zxing-wasm/reader')

const locateWasm = (path: string, prefix: string) => (
  path.endsWith('.wasm') ? readerWasmUrl : `${prefix}${path}`
)

let readerPromise: Promise<ZXingReader> | null = null

async function loadReader() {
  if (!readerPromise) {
    readerPromise = import('zxing-wasm/reader').then(async (reader) => {
      await reader.prepareZXingModule({
        overrides: { locateFile: locateWasm },
        fireImmediately: true,
      })
      return reader
    }).catch((reason) => {
      readerPromise = null
      throw reason
    })
  }
  return readerPromise
}

export async function prepareBarcodeEngine() {
  await loadReader()
}

export async function decodeBarcodes(input: Blob | ImageData): Promise<DecodedBarcode[]> {
  const reader = await loadReader()
  const results = await reader.readBarcodes(input, {
    formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'ITF14', 'DataBar'],
    binarizer: 'LocalAverage',
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
    minLineCount: 2,
    maxNumberOfSymbols: 1,
    returnErrors: false,
  })

  return results
    .filter((result) => result.isValid && result.text.trim())
    .map((result) => ({
      text: result.text.trim(),
      format: result.format,
      orientation: result.orientation,
      lineCount: result.lineCount,
    }))
}
