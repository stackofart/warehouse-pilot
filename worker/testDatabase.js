import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of ['0001_identity_and_catalog.sql', '0002_operations.sql', '0003_pallet_states.sql', '0004_report_photos.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  const binding = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      const bound = args => ({
        bind(...values) { if (values.length > 100) throw new Error('D1 maximum 100 bound parameters'); if (values.includes(undefined)) throw new Error('Undefined D1 binding'); return bound(values) },
        async all() { return { results: stmt.all(...args) } },
        async first() { return stmt.get(...args) || null },
        async run() { const result = stmt.run(...args); return { success: true, meta: { changes: Number(result.changes) } } },
      })
      return bound([])
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const now = new Date().toISOString()
  for (const [id, role, operational] of [['admin', 'admin', null], ['picker', 'picker', null], ['other', 'picker', null], ['driver', 'picker', 'replenisher']]) sqlite.prepare('INSERT INTO users (id, email, display_name, role, operational_role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, `${id}@test.local`, id, role, operational, 'active', now, now)
  return { DB: binding, sqlite, close: () => sqlite.close() }
}
