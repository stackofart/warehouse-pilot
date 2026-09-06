/** Resize on device, strip metadata, and keep the offline report below the JSON limit. */
export async function prepareReportPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) throw new Error('Выберите фото размером до 25 МБ.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode().catch(() => { throw new Error('Не удалось открыть фото. Попробуйте JPEG или PNG.') })
    const ratio = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить фото.')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', .8)
    if (data.length > 1400000) throw new Error('Фото слишком большое. Попробуйте меньший снимок.')
    return data
  } finally { URL.revokeObjectURL(url) }
}
