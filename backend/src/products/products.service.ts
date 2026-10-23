import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ShopScopeService } from '../shop-scope/shop-scope.service';
import { Http400, Http404, Http409 } from '../common/http-errors';
import { InventoryService } from '../inventory/inventory.service';
import { nextStock, planBulkPrice } from './pricing';
import {
  AdjustStockDto, BulkPriceDto, CreateProductDto, ListProductsQueryDto, UpdateProductDto,
} from './dto';

/**
 * Shared SELECT list — list / get / after-write responses use one shape so the
 * WebView client never has to reshape data.
 */
const PRODUCT_COLUMNS = `
  p.id::text                        AS id,
  p.name                            AS name,
  p.unit                            AS unit,
  COALESCE(pc.name, '')             AS cat,
  COALESCE(p.category_id::text, '') AS "categoryId",
  p.price::float8                   AS price,
  p.mrp::float8                     AS mrp,
  p.stock                           AS stock,
  p.low_at                          AS low,
  p.brand                           AS brand,
  p.fresh_note                      AS fresh,
  p.life_note                       AS life,
  p.shelf_life_h                    AS "shelfLifeH",
  p.photo_url                       AS "photoUrl",
  p.is_active                       AS active,
  p.created_at                      AS "createdAt",
  p.updated_at                      AS "updatedAt"`;

/**
 * PART 3 — product catalogue + inventory.
 *
 * Every statement is scoped by `shop_id` (tenant isolation) and writes go
 * through `ShopScopeService` for role checks (OWNER/MANAGER may edit the
 * catalogue, STAFF may only adjust stock).
 */
@Injectable()
export class ProductsService {
  constructor(private db: DbService, private scope: ShopScopeService, private logs: InventoryService) {}

  /* -------------------------------- read ---------------------------------- */

  async list(userId: string, q?: ListProductsQueryDto) {
    const query = q || ({} as ListProductsQueryDto);
    const shopId = await this.scope.requireShopId(userId);

    const where: string[] = ['p.shop_id = $1'];
    const vals: any[] = [shopId];

    if (!this.truthy(query.includeInactive)) where.push('p.is_active');

    if (query.categoryId) {
      vals.push(query.categoryId);
      where.push(`p.category_id = $${vals.length}`);
    } else if (query.category) {
      vals.push(query.category);
      where.push(`pc.name = $${vals.length}`);
    }

    if (query.stock === 'low') where.push('p.stock <= p.low_at AND p.stock > 0');
    else if (query.stock === 'out') where.push('p.stock <= 0');

    const term = (query.q || '').trim();
    if (term) {
      vals.push('%' + term + '%');
      where.push(
        `(p.name ILIKE $${vals.length} OR p.unit ILIKE $${vals.length}` +
          ` OR COALESCE(p.brand, '') ILIKE $${vals.length})`,
      );
    }

    const items = await this.db.query(
      `SELECT ${PRODUCT_COLUMNS}
         FROM products p
         LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.name ASC`,
      vals,
    );
    return { items, count: items.length };
  }

  async getById(userId: string, id: number) {
    const shopId = await this.scope.requireShopId(userId);
    return this.findOne(shopId, id);
  }

  /* ------------------------------- create ---------------------------------- */

  async create(userId: string, dto: CreateProductDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const name = (dto.name || '').trim();
    await this.assertNameFree(shopId, name);

    const categoryId = await this.resolveCategoryId(shopId, dto.categoryId, dto.category);
    const row = await this.db.one(
      `INSERT INTO products
         (shop_id, category_id, name, unit, price, mrp, stock, low_at, brand, fresh_note, life_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id::text AS id`,
      [
        shopId,
        categoryId,
        name,
        (dto.unit || '').trim(),
        dto.price,
        dto.mrp && dto.mrp > 0 ? dto.mrp : null,
        dto.stock === undefined ? 0 : nextStock(0, undefined, dto.stock),
        dto.lowAt === undefined ? 5 : dto.lowAt,
        dto.brand || null,
        dto.fresh || null,
        dto.life || null,
      ],
    );
    return this.findOne(shopId, Number(row.id));
  }

  /* ------------------------------- update ---------------------------------- */

  async update(userId: string, id: number, dto: UpdateProductDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const current = await this.db.one(
      'SELECT id FROM products WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
    if (!current) throw Http404('प्रोडक्ट नहीं मिला');

    const sets: string[] = [];
    const vals: any[] = [];
    const add = (col: string, v: any) => {
      sets.push(`${col} = $${vals.length + 1}`);
      vals.push(v);
    };

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameFree(shopId, name, id);
      add('name', name);
    }
    if (dto.unit !== undefined) add('unit', dto.unit.trim());
    if (dto.price !== undefined) add('price', dto.price);
    if (dto.mrp !== undefined) add('mrp', dto.mrp && dto.mrp > 0 ? dto.mrp : null);
    if (dto.stock !== undefined) add('stock', nextStock(0, undefined, dto.stock));
    if (dto.lowAt !== undefined) add('low_at', dto.lowAt);
    if (dto.brand !== undefined) add('brand', dto.brand || null);
    if (dto.fresh !== undefined) add('fresh_note', dto.fresh || null);
    if (dto.life !== undefined) add('life_note', dto.life || null);
    if (dto.categoryId !== undefined || dto.category !== undefined) {
      add('category_id', await this.resolveCategoryId(shopId, dto.categoryId, dto.category));
    }
    if (dto.active !== undefined) add('is_active', dto.active);

    if (!sets.length) return this.findOne(shopId, id);

    add('updated_at', new Date());
    vals.push(id, shopId);
    await this.db.query(
      `UPDATE products SET ${sets.join(', ')}
        WHERE id = $${vals.length - 1} AND shop_id = $${vals.length}`,
      vals,
    );
    return this.findOne(shopId, id);
  }

  /* ------------------------------- delete ---------------------------------- */

  /** Soft delete — the row is kept for order history but leaves the catalogue. */
  async remove(userId: string, id: number) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const row = await this.db.one(
      'SELECT id FROM products WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
    if (!row) throw Http404('प्रोडक्ट नहीं मिला');

    await this.db.query(
      'UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
    return { ok: true, id: String(id), deleted: true, active: false };
  }

  /* -------------------------------- stock ---------------------------------- */

  /**
   * Single-product stock change. The UPDATE and the audit row are written in
   * one transaction (`inventory_movements` via InventoryService), so the
   * history can never miss a change that actually happened. Route + response
   * shape unchanged from the first Part 3 cut.
   */
  async adjustStock(userId: string, id: number, dto: AdjustStockDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireOperate(userId, shopId);

    const row = await this.db.one<{ stock: number; low_at: number }>(
      'SELECT stock, low_at FROM products WHERE id = $1 AND shop_id = $2 AND is_active',
      [id, shopId],
    );
    if (!row) throw Http404('प्रोडक्ट नहीं मिला');
    if (dto.delta === undefined && dto.stock === undefined && dto.lowAt === undefined) {
      throw Http400('स्टॉक बदलने के लिए delta या stock भेजें');
    }

    // Absolute value wins over delta (same rule as before); null = lowAt only.
    const next =
      dto.stock !== undefined
        ? nextStock(row.stock, undefined, dto.stock)
        : dto.delta !== undefined
          ? nextStock(row.stock, dto.delta)
          : null;
    const kind =
      dto.stock !== undefined ? 'SET' : (dto.delta !== undefined && dto.delta > 0 ? 'RESTOCK' : 'ADJUST');

    await this.db.tx(async (q) => {
      if (next === null) {
        await q(
          'UPDATE products SET low_at = $1, updated_at = now() WHERE id = $2 AND shop_id = $3',
          [dto.lowAt, id, shopId],
        );
        return;
      }
      if (dto.lowAt === undefined) {
        await q(
          'UPDATE products SET stock = $1, updated_at = now() WHERE id = $2 AND shop_id = $3',
          [next, id, shopId],
        );
      } else {
        await q(
          `UPDATE products SET stock = $1, low_at = $2, updated_at = now()
            WHERE id = $3 AND shop_id = $4`,
          [next, dto.lowAt, id, shopId],
        );
      }
      if (next !== row.stock) {
        await this.logs.log(q, {
          shopId,
          productId: id,
          kind,
          delta: next - row.stock,
          before: row.stock,
          after: next,
          actorId: userId,
        });
      }
    });
    return this.findOne(shopId, id);
  }

  /* ----------------------------- bulk price -------------------------------- */

  /**
   * Preview (preview=true) or atomically apply a percentage change.
   * The apply path locks the affected rows (FOR UPDATE) inside a single
   * transaction, so a concurrent sale cannot slip between preview and write.
   */
  async bulkPrice(userId: string, dto: BulkPriceDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const where: string[] = ['p.shop_id = $1', 'p.is_active'];
    const vals: any[] = [shopId];
    if (dto.categoryId) {
      vals.push(dto.categoryId);
      where.push(`p.category_id = $${vals.length}`);
    } else if (dto.category) {
      vals.push(dto.category);
      where.push(`pc.name = $${vals.length}`);
    }
    const minPrice = dto.minPrice === undefined ? 1 : dto.minPrice;

    const selectRows = (lock: boolean) => `
      SELECT p.id, p.name, p.price::float8 AS price
        FROM products p
        LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.name${lock ? ' FOR UPDATE OF p' : ''}`;

    if (dto.preview) {
      const rows = await this.db.query(selectRows(false), vals);
      const changes = planBulkPrice(rows, dto.percent, minPrice);
      return { preview: true, applied: false, percent: dto.percent, count: changes.length, changes };
    }

    const changes = await this.db.tx(async (q) => {
      const locked = await q(selectRows(true), vals);
      const plan = planBulkPrice(locked as any, dto.percent, minPrice);
      for (const ch of plan) {
        await q(
          'UPDATE products SET price = $1, updated_at = now() WHERE id = $2 AND shop_id = $3',
          [ch.newPrice, ch.id, shopId],
        );
      }
      return plan;
    });

    return { preview: false, applied: true, percent: dto.percent, count: changes.length, changes };
  }

  /* ------------------------------- helpers --------------------------------- */

  private async findOne(shopId: string, id: number) {
    const row = await this.db.one(
      `SELECT ${PRODUCT_COLUMNS}
         FROM products p
         LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE p.id = $1 AND p.shop_id = $2`,
      [id, shopId],
    );
    if (!row) throw Http404('प्रोडक्ट नहीं मिला');
    return row;
  }

  private async assertNameFree(shopId: string, name: string, exceptId?: number) {
    const dup = await this.db.one(
      `SELECT id FROM products
        WHERE shop_id = $1 AND lower(name) = lower($2) AND is_active
          ${exceptId ? 'AND id <> $3' : ''}
        LIMIT 1`,
      exceptId ? [shopId, name, exceptId] : [shopId, name],
    );
    if (dup) throw Http409('इसी नाम का प्रोडक्ट पहले से है', { name });
  }

  /**
   * Resolve the target category id.
   *   - id given   -> must belong to this shop
   *   - name given -> existing category, otherwise created on the fly
   *                   (PART 1 parity: the app auto-creates a new chip)
   */
  private async resolveCategoryId(
    shopId: string,
    categoryId?: number,
    categoryName?: string,
  ): Promise<number | null> {
    if (categoryId !== undefined && categoryId !== null) {
      const row = await this.db.one<{ id: number }>(
        'SELECT id FROM product_categories WHERE id = $1 AND shop_id = $2',
        [categoryId, shopId],
      );
      if (!row) throw Http400('यह कैटेगरी इस दुकान की नहीं है');
      return row.id;
    }

    const name = (categoryName || '').trim();
    if (!name) return null;

    const found = await this.db.one<{ id: number }>(
      'SELECT id FROM product_categories WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1',
      [shopId, name],
    );
    if (found) return found.id;

    const created = await this.db.one<{ id: number }>(
      `INSERT INTO product_categories (shop_id, name, emoji, sort_order)
       VALUES ($1, $2, '🧺',
               (SELECT COALESCE(MAX(sort_order), 0) + 1
                  FROM product_categories WHERE shop_id = $1))
       ON CONFLICT (shop_id, name) DO NOTHING
       RETURNING id`,
      [shopId, name],
    );
    if (created) return created.id;

    const again = await this.db.one<{ id: number }>(
      'SELECT id FROM product_categories WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1',
      [shopId, name],
    );
    return again ? again.id : null;
  }

  private truthy(v: unknown): boolean {
    return v === true || v === 'true' || v === '1' || v === 1;
  }
}
