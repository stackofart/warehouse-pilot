import type { CV } from '@techstark/opencv-js'

export type CellBand = {
  top: number
  bottom: number
}

export type TableExtraction = {
  tableCanvas: HTMLCanvasElement
  rowBands: CellBand[]
  columnLines: number[]
  previewUrl: string
  usedPerspectiveCorrection: boolean
}

type RuntimeCv = CV & { onRuntimeInitialized?: () => void }

let cvPromise: Promise<CV> | null = null

async function loadOpenCv(): Promise<CV> {
  if (cvPromise) return cvPromise

  cvPromise = new Promise<CV>((resolve, reject) => {
    const existing = (window as unknown as { cv?: RuntimeCv | Promise<RuntimeCv> }).cv

    const finishLoading = async () => {
      try {
        const candidate = (window as unknown as { cv: RuntimeCv | Promise<RuntimeCv> }).cv
        const cv = candidate instanceof Promise ? await candidate : candidate
        if (cv.Mat) {
          resolve(cv)
          return
        }
        cv.onRuntimeInitialized = () => resolve(cv)
      } catch (error) {
        reject(error)
      }
    }

    if (existing) {
      void finishLoading()
      return
    }

    const script = document.createElement('script')
    script.src = `${import.meta.env.BASE_URL}cv/opencv.js`
    script.async = true
    script.onload = () => void finishLoading()
    script.onerror = () => reject(new Error('OpenCV.js failed to load'))
    document.head.appendChild(script)
  })

  return cvPromise
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D is not available')
  context.drawImage(image, 0, 0)
  image.close()
  return canvas
}

function distance(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function contourCorners(contour: { data32S: Int32Array }): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let index = 0; index < contour.data32S.length; index += 2) {
    points.push([contour.data32S[index], contour.data32S[index + 1]])
  }

  if (!points.length) return []

  const topLeft = points.reduce((best, point) => point[0] + point[1] < best[0] + best[1] ? point : best)
  const bottomRight = points.reduce((best, point) => point[0] + point[1] > best[0] + best[1] ? point : best)
  const topRight = points.reduce((best, point) => point[0] - point[1] > best[0] - best[1] ? point : best)
  const bottomLeft = points.reduce((best, point) => point[1] - point[0] > best[1] - best[0] ? point : best)
  return [topLeft, topRight, bottomRight, bottomLeft]
}

function groupCoordinates(values: number[]): number[] {
  if (!values.length) return []
  const groups: number[][] = [[values[0]]]
  for (const value of values.slice(1)) {
    const current = groups[groups.length - 1]
    if (value - current[current.length - 1] <= 3) current.push(value)
    else groups.push([value])
  }
  return groups.map((group) => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length))
}

function repairRowLines(lines: number[], height: number) {
  const repaired = [...lines]
  if (!repaired.length) return repaired
  if (repaired[0] > 5) repaired.unshift(0)
  if (height - 1 - repaired[repaired.length - 1] > 5) repaired.push(height - 1)
  if (repaired.length < 4) return repaired

  const itemGaps = repaired.slice(2).map((value, index) => value - repaired[index + 1]).filter((gap) => gap > 7)
  const sorted = [...itemGaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (!median) return repaired

  const result = [repaired[0]]
  repaired.slice(1).forEach((line, index) => {
    const previous = repaired[index]
    const gap = line - previous
    const missing = index > 0 && gap > median * 1.65 ? Math.round(gap / median) - 1 : 0
    for (let step = 1; step <= missing; step += 1) result.push(Math.round(previous + gap * step / (missing + 1)))
    result.push(line)
  })
  return result
}

function projectionLines(
  mat: { rows: number; cols: number; data: Uint8Array },
  axis: 'horizontal' | 'vertical',
  minimumRatio: number,
) {
  const length = axis === 'horizontal' ? mat.rows : mat.cols
  const crossLength = axis === 'horizontal' ? mat.cols : mat.rows
  const coordinates: number[] = []

  for (let coordinate = 0; coordinate < length; coordinate += 1) {
    let active = 0
    for (let cross = 0; cross < crossLength; cross += 1) {
      const row = axis === 'horizontal' ? coordinate : cross
      const column = axis === 'horizontal' ? cross : coordinate
      if (mat.data[row * mat.cols + column] > 0) active += 1
    }
    if (active / crossLength >= minimumRatio) coordinates.push(coordinate)
  }

  return groupCoordinates(coordinates)
}

function fallbackColumns(width: number) {
  const ratios = [0, .073, .12, .176, .225, .29, .335, .64, .70, .84, .89, .93, 1]
  return ratios.map((ratio) => Math.round(width * ratio))
}

export async function extractOrderTable(file: File): Promise<TableExtraction> {
  const cv = await loadOpenCv()
  const sourceCanvas = await fileToCanvas(file)
  const source = cv.imread(sourceCanvas)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const binary = new cv.Mat()
  const horizontal = new cv.Mat()
  const vertical = new cv.Mat()
  const grid = new cv.Mat()
  const hierarchy = new cv.Mat()
  const contours = new cv.MatVector()
  let selectedContour: InstanceType<CV['Mat']> | null = null

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0)
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 13)

    const horizontalKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(28, Math.round(source.cols / 28)), 1))
    const verticalKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.max(24, Math.round(source.rows / 38))))
    cv.morphologyEx(binary, horizontal, cv.MORPH_OPEN, horizontalKernel)
    cv.morphologyEx(binary, vertical, cv.MORPH_OPEN, verticalKernel)
    cv.add(horizontal, vertical, grid)
    const connector = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.dilate(grid, grid, connector, new cv.Point(-1, -1), 2)
    horizontalKernel.delete()
    verticalKernel.delete()
    connector.delete()

    cv.findContours(grid, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let bestScore = 0
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index)
      const rect = cv.boundingRect(contour)
      const areaRatio = (rect.width * rect.height) / (source.cols * source.rows)
      const aspectRatio = rect.width / Math.max(rect.height, 1)
      const score = areaRatio * Math.min(aspectRatio, 3)
      const plausible = areaRatio > .12 && aspectRatio > 1.25 && rect.y > source.rows * .12
      if (plausible && score > bestScore) {
        selectedContour?.delete()
        selectedContour = contour.clone()
        bestScore = score
      }
      contour.delete()
    }

    let tableCanvas = document.createElement('canvas')
    let usedPerspectiveCorrection = false

    if (selectedContour) {
      const corners = contourCorners(selectedContour)
      if (corners.length === 4) {
        const [topLeft, topRight, bottomRight, bottomLeft] = corners
        const width = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))
        const height = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))

        if (width > source.cols * .45 && height > source.rows * .2) {
          const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat())
          const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
          const transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints)
          const warped = new cv.Mat()
          cv.warpPerspective(source, warped, transform, new cv.Size(Math.round(width), Math.round(height)), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))
          tableCanvas.width = warped.cols
          tableCanvas.height = warped.rows
          cv.imshow(tableCanvas, warped)
          usedPerspectiveCorrection = true
          sourcePoints.delete()
          destinationPoints.delete()
          transform.delete()
          warped.delete()
        }
      }
    }

    if (!usedPerspectiveCorrection) {
      const rect = selectedContour ? cv.boundingRect(selectedContour) : {
        x: Math.round(source.cols * .04),
        y: Math.round(source.rows * .23),
        width: Math.round(source.cols * .92),
        height: Math.round(source.rows * .48),
      }
      tableCanvas.width = rect.width
      tableCanvas.height = rect.height
      tableCanvas.getContext('2d')?.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    }

    const table = cv.imread(tableCanvas)
    const tableGray = new cv.Mat()
    const tableBinary = new cv.Mat()
    const tableHorizontal = new cv.Mat()
    const tableVertical = new cv.Mat()
    cv.cvtColor(table, tableGray, cv.COLOR_RGBA2GRAY)
    cv.adaptiveThreshold(tableGray, tableBinary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 12)
    const rowKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(30, Math.round(table.cols / 22)), 1))
    const columnKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.max(18, Math.round(table.rows / 12))))
    cv.morphologyEx(tableBinary, tableHorizontal, cv.MORPH_OPEN, rowKernel)
    cv.morphologyEx(tableBinary, tableVertical, cv.MORPH_OPEN, columnKernel)

    let rowLines = projectionLines(tableHorizontal, 'horizontal', .45)
    if (rowLines.length < 20) rowLines = projectionLines(tableHorizontal, 'horizontal', .25)
    rowLines = repairRowLines(rowLines, table.rows)
    const detectedColumnLines = projectionLines(tableVertical, 'vertical', .2)

    // The narrow columns on the left can be interrupted by handwritten picker
    // marks, while the six right-hand rules around description/barcode/SKU and
    // address remain reliable. Combine those measured rules with calibrated
    // left-side ratios instead of shifting fields when only part of the grid is
    // detected. This also supports minor layout-width variations between forms.
    const calibratedColumns = fallbackColumns(table.cols)
    const detectedSuffix = detectedColumnLines.slice(-6)
    const hasReliableSuffix = detectedSuffix.length === 6
      && detectedSuffix[0] > table.cols * .5
      && detectedSuffix[5] > table.cols * .96
      && detectedSuffix.every((line, index) => index === 0 || line - detectedSuffix[index - 1] > table.cols * .018)
    const columnLines = hasReliableSuffix
      ? [...calibratedColumns.slice(0, 7), ...detectedSuffix]
      : calibratedColumns

    const allBands = rowLines.slice(0, -1).map((line, index) => ({
      top: line,
      bottom: rowLines[index + 1],
    })).filter((band) => band.bottom - band.top >= 8)

    // The first band is the header, all following bands are order rows. Orders
    // in the same form can contain 13, 25, 27 (or another number of) items, so
    // a fixed 25-row fallback reads empty paper as products on short orders.
    const rowBands = allBands.length >= 2 && allBands.length <= 100
      ? allBands.slice(1)
      : []

    const previewUrl = tableCanvas.toDataURL('image/jpeg', .86)
    table.delete()
    tableGray.delete()
    tableBinary.delete()
    tableHorizontal.delete()
    tableVertical.delete()
    rowKernel.delete()
    columnKernel.delete()

    return { tableCanvas, rowBands, columnLines, previewUrl, usedPerspectiveCorrection }
  } finally {
    selectedContour?.delete()
    source.delete()
    gray.delete()
    blurred.delete()
    binary.delete()
    horizontal.delete()
    vertical.delete()
    grid.delete()
    hierarchy.delete()
    contours.delete()
  }
}

export function buildColumnSheet(
  tableCanvas: HTMLCanvasElement,
  rowBands: CellBand[],
  left: number,
  right: number,
  options: { rowHeight?: number; width?: number; rtl?: boolean; binarize?: boolean } = {},
) {
  const rowHeight = options.rowHeight ?? 72
  const width = options.width ?? Math.max(260, (right - left) * 3)
  const sheet = document.createElement('canvas')
  sheet.width = width
  sheet.height = rowBands.length * rowHeight
  const context = sheet.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D is not available')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, sheet.width, sheet.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  rowBands.forEach((band, index) => {
    const touchesTableEdge = left <= 1 || right >= tableCanvas.width - 2
    const insetX = touchesTableEdge ? 0 : Math.min(3, Math.max(1, (right - left) * .025))
    const insetY = Math.min(3, Math.max(1, (band.bottom - band.top) * .12))
    const sourceWidth = Math.max(1, right - left - insetX * 2)
    const sourceHeight = Math.max(1, band.bottom - band.top - insetY * 2)
    const availableHeight = rowHeight - 18
    const scale = Math.min((width - 20) / sourceWidth, availableHeight / sourceHeight)
    const targetWidth = sourceWidth * scale
    const targetHeight = sourceHeight * scale
    const targetX = options.rtl ? width - targetWidth - 10 : 10
    const targetY = index * rowHeight + (rowHeight - targetHeight) / 2
    context.drawImage(tableCanvas, left + insetX, band.top + insetY, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight)
  })

  const pixels = context.getImageData(0, 0, sheet.width, sheet.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114
    let adjusted = gray > 210 ? 255 : Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128))
    if (options.binarize) adjusted = adjusted < 185 ? 0 : 255
    pixels.data[index] = adjusted
    pixels.data[index + 1] = adjusted
    pixels.data[index + 2] = adjusted
  }
  context.putImageData(pixels, 0, 0)
  return { canvas: sheet, rowHeight }
}
