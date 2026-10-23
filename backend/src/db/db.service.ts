import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { env } from '../config/env';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: env.DATABASE_URL });

  /** Nest shutdown पर pool बंद — jest/open handles और graceful deploy दोनों साफ़. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] || null;
  }

  async tx<T>(fn: (q: DbService['query']) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const wrapper = async (sql: string, params: any[] = []) => (await c.query(sql, params)).rows;
      const out = await fn(wrapper as any);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      // Never mask the original error with a rollback failure (broken connection).
      try {
        await c.query('ROLLBACK');
      } catch {
        /* connection already gone — the pool will discard it */
      }
      throw e;
    } finally {
      c.release();
    }
  }
}

@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
