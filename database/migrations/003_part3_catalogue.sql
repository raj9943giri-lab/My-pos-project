-- ============================================================================
-- POS — Migration 003 (PART 3: product catalogue, inventory, bulk price edit)
-- Target: PostgreSQL 13+   ·   Requires database/schema.sql (PART 1) applied.
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run.
--
-- Run (server / Termux):
--   psql "$DATABASE_URL" -f database/migrations/003_part3_catalogue.sql
--
-- Kya karta hai:
--   product_categories  + created_at / updated_at  (audit + rename tracking)
--   products            + life_note               (shelf-life text, e.g. "24 घंटे")
--   indexes             shop+category, shop+stock, shop+active, category order
--   Note: `products.is_active`, `products.low_at`, `products.created_at`,
--         `products.updated_at` already exist in schema.sql — not touched here.
-- ============================================================================

BEGIN;

-- --------------------------- product_categories ---------------------------
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- -------------------------------- products ----------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS life_note TEXT;

-- --------------------------------- indexes ---------------------------------
CREATE INDEX IF NOT EXISTS idx_products_shop_category ON products (shop_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_stock    ON products (shop_id, stock);
CREATE INDEX IF NOT EXISTS idx_products_shop_active   ON products (shop_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_categories_shop ON product_categories (shop_id, sort_order);

COMMIT;

-- Sanity check (optional):
--   SELECT count(*) FROM product_categories WHERE created_at IS NULL;
--   SELECT count(*) FROM products WHERE life_note IS NULL;
