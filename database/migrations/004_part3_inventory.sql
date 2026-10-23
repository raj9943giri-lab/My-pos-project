-- ============================================================================
-- POS — Migration 004 (PART 3: inventory management audit trail)
-- Target: PostgreSQL 13+   ·   Requires database/schema.sql + migration 002/003.
-- Idempotent (IF NOT EXISTS) — safe to re-run. Auto-applied by src/db/migrator.ts
--   (files in filename order, so `004_…` runs after `003_…`).
--
-- Kya karta hai:
--   inventory_movements   हर stock बदलाव का हिसाब (कौन, कब, कितना, क्यों)
--                         — products.stock सिर्फ़ आख़िरी value रखता है; यह
--                           तालिका पूरा इतिहास रखती है (कमाई/गुमशुदा खोजने के लिए)
--   indexes               shop समय, product समय, actor समय
--   products.stock की CHECK (stock >= 0) पहले से है — movements में delta
--   जितना भी हो, after >= 0 की ज़िम्मेदारी app-layer की है (nextStock helper)।
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id           BIGSERIAL PRIMARY KEY,
  shop_id      UUID NOT NULL REFERENCES shops(id)       ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  kind         VARCHAR(20) NOT NULL,              -- RESTOCK | ADJUST | SET | BULK | SALE | RETURN
  delta        INT NOT NULL,                      -- after - before (0 = सिर्फ़ threshold बदला? नहीं — 0 movement log नहीं होता)
  stock_before INT NOT NULL,
  stock_after  INT NOT NULL,
  note         TEXT,
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,  -- किस user ने बदला (STAFF भी लिख सकता है)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory screen: दुकान के हाल के बदलाव
CREATE INDEX IF NOT EXISTS idx_inv_moves_shop_time    ON inventory_movements (shop_id, created_at DESC);
-- Product sheet: एक प्रोडक्ट का पूरा इतिहास
CREATE INDEX IF NOT EXISTS idx_inv_moves_product_time ON inventory_movements (product_id, created_at DESC);
-- "आज STAFF ने क्या किया" (audit, PART 4 admin)
CREATE INDEX IF NOT EXISTS idx_inv_moves_actor_time   ON inventory_movements (actor_id, created_at DESC);

COMMIT;

-- Sanity check (optional):
--   SELECT count(*) FROM inventory_movements WHERE shop_id IS NULL;
--   SELECT count(*) FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE p.is_active = FALSE;
