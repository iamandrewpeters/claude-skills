// A D1-compatible binding over node:sqlite, so tests run the Worker's real SQL
// against a real SQLite database built from migrations/ — the same files
// `wrangler d1 migrations apply` runs in production.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const plain = (row) => (row ? { ...row } : row);

function statement(db, sql, params) {
  return {
    bind: (...args) => statement(db, sql, args.map(norm)),
    async all() {
      return { success: true, results: db.prepare(sql).all(...params).map(plain) };
    },
    async first(column) {
      const row = db.prepare(sql).get(...params);
      if (!row) return null;
      return column ? row[column] : plain(row);
    },
    async run() {
      const st = db.prepare(sql);
      if (/\breturning\b/i.test(sql)) {
        return { success: true, results: st.all(...params).map(plain), meta: {} };
      }
      const r = st.run(...params);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  };
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return {
    prepare: (sql) => statement(db, sql, []),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    // Test-only escape hatch for assertions.
    rows: (sql, ...args) => db.prepare(sql).all(...args.map(norm)).map(plain),
    row: (sql, ...args) => plain(db.prepare(sql).get(...args.map(norm))),
  };
}
