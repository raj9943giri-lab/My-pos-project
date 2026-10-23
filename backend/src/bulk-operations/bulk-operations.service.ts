import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ShopScopeService } from '../shop-scope/shop-scope.service';
import { Http400, Http404 } from '../common/http-errors';
import { InventoryService } from '../inventory/inventory.service';
import { BulkActiveDto, BulkCategoryDto, BulkStockDto, BulkStockItemDto } from './dto';
import { coerceIds, classifyStockItem, MAX_BULK_ITEMS } from './bulk';

/**
 * PART 3 — bulk operations.
 *
 *   POST /bulk-operations/stock     STAFF भी चला सकता (requireOperate)
 *   POST /bulk-operations/category  OWNER / MANAGER (requireManage)
 *   POST /bulk-operations/active    OWNER / MANAGER (requireManage)
 *
 * Bulk PRICE editing stays at `POST /products/bulk-price` (one write path for
 * prices); this module covers everything else that touches many products.
 * Every stock write happens inside one transaction with row locks, and every
 * applied item is mirrored into `inventory_movements` by InventoryService.
 */
@Injectable()
export class BulkOperationsService {
  constructor(private db: DbService, private scope: ShopScopeService, private logs: InventoryService) {}

  /* -------------------------------- stock ---------------------------------- */

  /** One-shot stock update for up to 200 products. */
  async stock(userId: string, dto: BulkStockDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireOperate(userId, shopId);

    const items = (dto.items || []).slice(0, MAX_BULK_ITEMS) as BulkStockItemDto[];
    const ids = coerceIds(items.map((i) => i && i.id));
    if (!ids.length) throw Http400('आइडी समझ नहीं आई — id नंबर भेजें');

    return this.db.tx(async (q) => {
      const rows = await q<{ id: number; name: string; stock: number }>(
        `SELECT id, name, stock FROM products
          WHERE shop_id = $1 AND is_active AND id = ANY($2::bigint[])
          ORDER BY id
          FOR UPDATE`,
        [shopId, ids],
      );
      const byId = new Map<number, { name: string; stock: number }>();
      for (const r of rows) byId.set(Number(r.id), { name: r.name, stock: Number(r.stock) });

      const changes: any[] = [];
      const missing: number[] = [];
      const unchanged: number[] = [];

      for (const item of items) {
        const id = Number(item && item.id);
        if (!Number.isInteger(id) || !byId.has(id)) {
          if (!missing.includes(id)) missing.push(id);
          continue;
        }
        const cur = byId.get(id)!.stock;
        const res = classifyStockItem(cur, item);
        if (res.status === 'unchanged') {
          unchanged.push(id);
          continue;
        }
        await q(
          `UPDATE products SET stock = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
          [res.after, id, shopId],
        );
        await this.logs.log(q, {
          shopId,
          productId: id,
          kind: 'BULK',
          delta: res.delta,
          before: res.before,
          after: res.after,
          note: dto.note,
          actorId: userId,
        });
        byId.set(id, { name: byId.get(id)!.name, stock: res.after });
        changes.push({
          id: id,
          name: byId.get(id)!.name,
          delta: res.delta,
          before: res.before,
          after: res.after,
        });
      }

      return {
        ok: true,
        requested: items.length,
        updated: changes.length,
        unchanged: unchanged.length,
        missing: missing.length,
        missingIds: missing,
        changes,
        note: dto.note || null,
      };
    });
  }

  /* ------------------------------- category -------------------------------- */

  /** Move many products into one category (find-or-create by name). */
  async assignCategory(userId: string, dto: BulkCategoryDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const ids = coerceIds(dto.ids);
    if (!ids.length) throw Http400('आइडी समझ नहीं आई — id नंबर भेजें');

    let categoryId: number | null = null;
    let categoryName = '';
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const row = await this.db.one<{ id: number; name: string }>(
        'SELECT id, name FROM product_categories WHERE id = $1 AND shop_id = $2',
        [dto.categoryId, shopId],
      );
      if (!row) throw Http400('यह कैटेगरी इस दुकान की नहीं है');
      categoryId = row.id;
      categoryName = row.name;
    } else {
      const name = (dto.category || '').trim();
      if (!name) throw Http400('category या categoryId एक भेजें');
      const found = await this.db.one<{ id: number; name: string }>(
        'SELECT id, name FROM product_categories WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1',
        [shopId, name],
      );
      if (found) {
        categoryId = found.id;
        categoryName = found.name;
      } else {
        const created = await this.db.one<{ id: number }>(
          `INSERT INTO product_categories (shop_id, name, emoji, sort_order)
           VALUES ($1, $2, '🧺',
                   (SELECT COALESCE(MAX(sort_order), 0) + 1
                      FROM product_categories WHERE shop_id = $1))
           ON CONFLICT (shop_id, name) DO NOTHING
           RETURNING id`,
          [shopId, name],
        );
        if (created) categoryId = created.id;
        else {
          const again = await this.db.one<{ id: number; name: string }>(
            'SELECT id, name FROM product_categories WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1',
            [shopId, name],
          );
          if (!again) throw Http404('कैटेगरी नहीं बन पाई');
          categoryId = again.id;
          categoryName = again.name;
        }
      }
    }

    const moved = await this.db.query<{ id: number; name: string }>(
      `UPDATE products SET category_id = $1, updated_at = now()
        WHERE shop_id = $2 AND is_active AND id = ANY($3::bigint[])
        RETURNING id::text AS id, name`,
      [categoryId, shopId, ids],
    );
    const movedSet = new Set(moved.map((r) => String(r.id)));

    return {
      ok: true,
      categoryId: categoryId,
      category: categoryName,
      updated: moved.length,
      missing: ids.filter((id) => !movedSet.has(String(id))).length,
      items: moved.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  /* -------------------------------- active --------------------------------- */

  /** Bulk soft-delete (active=false) or restore (active=true). */
  async setActive(userId: string, dto: BulkActiveDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const ids = coerceIds(dto.ids);
    if (!ids.length) throw Http400('आइडी समझ नहीं आई — id नंबर भेजें');

    const active = dto.active === undefined ? false : !!dto.active;
    const rows = await this.db.query<{ id: string; name: string }>(
      `UPDATE products SET is_active = $1, updated_at = now()
        WHERE shop_id = $2 AND is_active <> $1 AND id = ANY($3::bigint[])
        RETURNING id::text AS id, name`,
      [active, shopId, ids],
    );

    return {
      ok: true,
      active,
      updated: rows.length,
      items: rows.map((r) => ({ id: r.id, name: r.name })),
    };
  }
}
