export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

export async function readJson(request) {
  try {
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Missing body')
    const chunks = []; let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2 * 1024 * 1024) { await reader.cancel(); return { response: jsonResponse({ error: 'JSON превышает 2 МБ.' }, 413) } }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return { body: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { response: jsonResponse({ error: 'Не удалось прочитать JSON запроса.', code: 'invalid_json' }, 400) }
  }
}

export function methodNotAllowed(allowed) {
  return jsonResponse({ error: 'Метод не поддерживается.', code: 'method_not_allowed' }, 405, { allow: allowed.join(', ') })
}
