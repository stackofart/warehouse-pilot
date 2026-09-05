import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
describe('authenticated service worker isolation', () => {
  it('does not intercept API/profile/catalog/image requests, even when legacy cached values exist', () => {
    const handlers: Record<string, (event: unknown) => void> = {}
    const forbidden = () => { throw new Error('Authenticated data must not touch CacheStorage') }
    vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { URL, self: { location: { origin: 'https://test.local' }, addEventListener: (type: string, callback: (event: unknown) => void) => { handlers[type] = callback } }, caches: { match: forbidden, open: forbidden } })
    for (const path of ['/api/me', '/api/admin/products', '/api/catalog/search?q=beer', '/api/catalog/products/p/image']) {
      expect(() => handlers.fetch({ request: new Request('https://test.local' + path), respondWith: forbidden })).not.toThrow()
    }
  })
})
