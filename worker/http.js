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
    return { body: await request.json() }
  } catch {
    return { response: jsonResponse({ error: 'Не удалось прочитать JSON запроса.', code: 'invalid_json' }, 400) }
  }
}

export function methodNotAllowed(allowed) {
  return jsonResponse({ error: 'Метод не поддерживается.', code: 'method_not_allowed' }, 405, { allow: allowed.join(', ') })
}
