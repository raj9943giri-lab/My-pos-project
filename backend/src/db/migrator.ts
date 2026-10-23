import * as fs from 'fs';
import * as path from 'path';
import { DbService } from './db.service';
import { env } from '../config/env';

/** Applies database/migrations/*.sql in filename order (001…), once each. */
export async function runMigrations(db?: DbService): Promise<void> {
  const svc = db || new DbService();
  const dir = env.MIGRATIONS_DIR;
  if (!fs.existsSync(dir)) {
    console.warn('[migrate] no dir:', dir);
    return;
  }
  await svc.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const applied = new Set(
    (await svc.query<{ filename: string }>('SELECT filename FROM schema_migrations')).map((r) => r.filename),
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log('[migrate] applying', f);
    try {
      // Multi-statement file (own BEGIN/COMMIT allowed) — pool.query runs it as script.
      await svc.pool.query(sql);
      await svc.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
    } catch (e: any) {
      console.error('[migrate] FAILED', f, e.message);
      throw e;
    }
  }
}
