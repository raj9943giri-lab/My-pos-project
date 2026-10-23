import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ShopScopeService } from '../shop-scope/shop-scope.service';
import { Http404, Http409 } from '../common/http-errors';
import { CreateProductCategoryDto, UpdateProductCategoryDto } from './dto';

/**
 * PostgreSQL `unique_violation` (23505) — a concurrent request won the race,
 * so the app-level duplicate check was not enough. Turn it into a 409 instead
 * of a 500.
 */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505';
}

/**
 * PART 3 — product categories (shop scoped).
 *
 * Categories belong to a shop; renaming one is safe because products point at
 * `category_id` (the UI joins the name back in). Deleting a category that still
 * has products is blocked with 409 so the merchant never loses a chip silently.
 */
@Injectable()
export class ProductCategoriesService {
  constructor(private db: DbService, private scope: ShopScopeService) {}

  async list(userId: string) {
    const shopId = await this.scope.requireShopId(userId);
    const items = await this.db.query(
      `SELECT c.id::text                      AS id,
              c.name                          AS name,
              COALESCE(c.emoji, '🧺')         AS emoji,
              COALESCE(c.sort_order, 0)       AS "sortOrder",
              c.created_at                    AS "createdAt",
              c.updated_at                    AS "updatedAt",
              (SELECT COUNT(*)::int FROM products p
                WHERE p.category_id = c.id
                  AND p.shop_id = c.shop_id
                  AND p.is_active)             AS "productCount"
         FROM product_categories c
        WHERE c.shop_id = $1
        ORDER BY c.sort_order, c.name`,
      [shopId],
    );
    return { items, count: items.length };
  }

  async create(userId: string, dto: CreateProductCategoryDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const name = (dto.name || '').trim();
    await this.assertNameFree(shopId, name);

    let row: { id: string } | null;
    try {
      row = await this.db.one<{ id: string }>(
        `INSERT INTO product_categories (shop_id, name, emoji, sort_order)
         VALUES ($1, $2, $3,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1
                    FROM product_categories WHERE shop_id = $1))
         RETURNING id::text AS id`,
        [shopId, name, dto.emoji || '🧺'],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw Http409('यह कैटेगरी पहले से है', { name });
      throw err;
    }
    return this.findOne(shopId, Number(row!.id));
  }

  async update(userId: string, id: number, dto: UpdateProductCategoryDto) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const current = await this.db.one(
      'SELECT id FROM product_categories WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
    if (!current) throw Http404('कैटेगरी नहीं मिली');

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
    if (dto.emoji !== undefined) add('emoji', dto.emoji || '🧺');

    if (!sets.length) return this.findOne(shopId, id);

    add('updated_at', new Date());
    vals.push(id, shopId);
    try {
      await this.db.query(
        `UPDATE product_categories SET ${sets.join(', ')}
          WHERE id = $${vals.length - 1} AND shop_id = $${vals.length}`,
        vals,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw Http409('यह कैटेगरी पहले से है', { name: dto.name });
      throw err;
    }
    return this.findOne(shopId, id);
  }

  async remove(userId: string, id: number) {
    const shopId = await this.scope.requireShopId(userId);
    await this.scope.requireManage(userId, shopId);

    const current = await this.db.one(
      'SELECT id FROM product_categories WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
    if (!current) throw Http404('कैटेगरी नहीं मिली');

    const used = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM products
        WHERE category_id = $1 AND shop_id = $2 AND is_active`,
      [id, shopId],
    );
    if (used && used.n > 0) {
      throw Http409('इस कैटेगरी में प्रोडक्ट हैं — पहले प्रोडक्ट हटाएं', { products: used.n });
    }

    await this.db.query(
      'DELETE FROM product_categories WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
    return { ok: true, id: String(id), deleted: true };
  }

  /* ------------------------------- helpers --------------------------------- */

  private async findOne(shopId: string, id: number) {
    const row = await this.db.one(
      `SELECT c.id::text               AS id,
              c.name                   AS name,
              COALESCE(c.emoji, '🧺')  AS emoji,
              COALESCE(c.sort_order, 0) AS "sortOrder",
              c.created_at             AS "createdAt",
              c.updated_at             AS "updatedAt",
              (SELECT COUNT(*)::int FROM products p
                WHERE p.category_id = c.id
                  AND p.shop_id = c.shop_id
                  AND p.is_active)      AS "productCount"
         FROM product_categories c
        WHERE c.id = $1 AND c.shop_id = $2`,
      [id, shopId],
    );
    if (!row) throw Http404('कैटेगरी नहीं मिली');
    return row;
  }

  private async assertNameFree(shopId: string, name: string, exceptId?: number) {
    const dup = await this.db.one(
      `SELECT id FROM product_categories
        WHERE shop_id = $1 AND lower(name) = lower($2)
          ${exceptId ? 'AND id <> $3' : ''}
        LIMIT 1`,
      exceptId ? [shopId, name, exceptId] : [shopId, name],
    );
    if (dup) throw Http409('यह कैटेगरी पहले से है', { name });
  }
}
