import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ShopScopeService } from '../shop-scope/shop-scope.service';
import { normalizeKind, sanitizeNote, MovementKind } from './movements';

/**
 * PART 3 — inventory management.
 *
 * Two read surfaces for the stock screen (any member role may read):
 *   - `summary` — one-shot dashboard card (counts + value on stock)
 *   - `movements` — audit trail of every stock change
 *
 * Writes do NOT live here: the single source of truth for changing stock is
 * `PATCH /products/:id/stock` and `POST /bulk-operations/stock`. Both call
 * `log()` inside the same transaction as the product UPDATE so the audit
 * can never drift out of sync with the stock column.
 */
@Injectable()
export class InventoryService {
  constructor(private db: DbService, private scope: ShopScopeService) {}

  /* ------------------------------- summary -------------------------------- */

  /** Dashboard totals for the stock screen's header card. */
  async summary(userId: string) {
    const shopId = await this.scope.requireShopId(userId);
    const row = await this.db.one<{
      active: number;
      inactive: number;
      low: number;
      out: number;
      units: number;
      value: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE p.is_active)::int                                  AS active,
         COUNT(*) FILTER (WHERE NOT p.is_active)::int                              AS inactive,
         COUNT(*) FILTER (WHERE p.is_active AND p.stock > 0
                            AND p.stock <= p.low_at)::int                           AS low,
         COUNT(*) FILTER (WHERE p.is_active AND p.stock <= 0)::int                  AS out,
         COALESCE(SUM(p.stock) FILTER (WHERE p.is_active), 0)::int                  AS units,
         COALESCE(SUM(p.stock * p.price) FILTER (WHERE p.is_active), 0)::float8     AS value
        FROM products p
       WHERE p.shop_id = $1`,
      [shopId],
    );
    const out = row?.out ?? 0;
    const low = row?.low ?? 0;
    const active = row?.active ?? 0;
    return {
      shopId,
      products: active,
      inactive: row?.inactive ?? 0,
      low,
      out,
      alert: low + out,
      units: row?.units ?? 0,
      // अंदाज़न मूल्य — selling price × stock (mrp नहीं)
      value: Math.round((row?.value || 0) * 100) / 100,
    };
  }

  /* ------------------------------ movements -------------------------------- */

  /** Recent audit rows (optionally filtered to one product). */
  async movements(userId: string, q?: { productId?: number; limit?: number }) {
    const shopId = await this.scope.requireShopId(userId);

    const limit = Math.min(Math.max(Number(q && q.limit) || 30, 1), 100);
    const where: string[] = ['m.shop_id = $1'];
    const vals: any[] = [shopId];
    if (q && q.productId !== undefined && q.productId !== null) {
      vals.push(q.productId);
      where.push(`m.product_id = $${vals.length}`);
    }

    const rows = await this.db.query(
      `SELECT m.id::text            AS id,
              m.product_id::text    AS "productId",
              p.name                AS "product",
              m.kind                AS kind,
              m.delta               AS delta,
              m.stock_before        AS before,
              m.stock_after         AS after,
              m.note                AS note,
              u.name                AS "actorName",
              m.created_at          AS "createdAt"
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN users u ON u.id = m.actor_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.created_at DESC
        LIMIT $${vals.length + 1}`,
      [...vals, limit],
    );
    return { items: rows, count: rows.length, limit };
  }

  /* -------------------------------- log ------------------------------------ */

  /**
   * Append one audit row. `q` defaults to a bare pool query; callers inside a
   * transaction pass their own query fn so the row writes (or rolls back)
   * together with the stock update.
   */
  async log(
    q: (sql: string, params?: any[]) => Promise<any[]>,
    params: {
      shopId: string;
      productId: number;
      kind: MovementKind | string;
      delta: number;
      before: number;
      after: number;
      note?: unknown;
      actorId?: string;
    },
  ): Promise<void> {
    await q(
      `INSERT INTO inventory_movements
         (shop_id, product_id, kind, delta, stock_before, stock_after, note, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.shopId,
        params.productId,
        normalizeKind(params.kind),
        Math.round(Number(params.delta) || 0),
        Math.round(Number(params.before) || 0),
        Math.round(Number(params.after) || 0),
        sanitizeNote(params.note),
        params.actorId || null,
      ],
    );
  }
}
