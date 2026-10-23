-- ============================================================================
-- POS — Migration 009 (PART 8: variant integrity + order item indexes)
-- Target: PostgreSQL 13+   ·   Requires 001…008.
--
-- क्यों:
--   - order_items.variant_id बिना FK था — hard-deleted variant का orphan id
--     बच सकता था. अब product_variants(id) पर FK, DELETE पर SET NULL.
--   - order_items(order_id) पर index नहीं था; हर order detail/history query
--     पूरी table scan करती थी.
--   - product_variants.stock पर CHECK (NULL या >= 0) — ऋणात्मक स्टॉक कभी नहीं.
-- Idempotent (IF NOT EXISTS / DO-blocks), safe to re-run.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_fkey'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_variant_id_fkey
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_stock_check'
  ) THEN
    ALTER TABLE product_variants
      ADD CONSTRAINT product_variants_stock_check CHECK (stock IS NULL OR stock >= 0);
  END IF;
END $$;

COMMIT;
