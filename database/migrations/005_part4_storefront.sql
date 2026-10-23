-- ============================================================================
-- POS — Migration 005 (PART 4: customer storefront, cart, checkout, orders)
-- Target: PostgreSQL 13+   ·   Requires database/schema.sql + 002/003/004.
-- Idempotent (IF NOT EXISTS) — safe to re-run. Auto-applied by src/db/migrator.ts
--
-- Kyaa karta hai:
--   orders (ALTER)        guest-checkout ke poore hisaab ke kolum: customer
--                         name/phone, fulfilment (DELIVERY|PICKUP), payment
--                         status, landmark/instructions, discount + coupon,
--                         **public_token** (order status dekhne ka non-guessable
--                         token — order number ya id se koi uska order nahi dhundh
--                         sakta), **idempotency_key** (dobara tap/network-retry
--                         par duplicate order kabhi nahi banega).
--   order_items (ALTER)   naam/unit snapshot (merchant baad me naam badle to bhi
--                         purana order ka hisaab waisa hi dikhe) + variant.
--   shops (ALTER)         order-accept rules: COD/phone-par-peymant (PON)
--                         flags, manual UPI VPA (koi gateway nahi — sirf
--                         configured VPA milne par hi UPI dikhati hain),
--                         min order value, orders-low-light toggle.
--   product_variants      kapde ka size/rang etc. (part 4 me sirf public store
--                         dikhata hai; manage karne ki merchant UI Part 5+).
--   shop_coupons          configurable discount (active window + limits) —
--                         discount kabhi browser se nahi, server yahin se.
-- ============================================================================

BEGIN;

-- ---------------------------- orders: Part-4 columns ------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_token UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(15);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilment VARCHAR(10) NOT NULL DEFAULT 'DELIVERY';
    -- DELIVERY | PICKUP
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(15) NOT NULL DEFAULT 'PENDING';
    -- PENDING (COD/UPI await) | COD_PENDING | PAID | FAILED
    -- COD ho ya UPI — order banne par hamesha PENDING; PAID sirf merchant
    -- confirm kare/part 5 (browser ka javab kabhi peymant nahi maanega).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS landmark        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount        NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code     TEXT;
-- (order_ref, sub_total, delivery_fee, total, pay_mode, addr Pehle se hain)

-- Order status dekhne ka rasta: token, order no. ya id NAHI (enumeration nahi).
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_public_token ON orders (public_token);
-- Ek hi (shop, idempotency_key) par sirf ek order — dobara tap/network-retry
-- par duplicate order kabhi nahi banta (race bhi unique index se pakda jata hai).
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_shop_idempotency
  ON orders (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- (fulfilment slot: Part 5 — abhi delivery_settings.note hi ETA dikhata hai)

-- ---------------------------- order_items: snapshots ------------------------
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit         TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id   BIGINT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name TEXT;
-- Note: order_item->product FK `ON DELETE CASCADE`: soft-deleted products sirf
-- is_active=false; hard delete sirf product singa thaata hua (schema.sql).

-- ---------------------------- shops: order/screen rules ---------------------
ALTER TABLE shops ADD COLUMN IF NOT EXISTS cod_enabled        BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS pon_enabled        BOOLEAN NOT NULL DEFAULT TRUE; -- pay ON PICKUP
ALTER TABLE shops ADD COLUMN IF NOT EXISTS upi_vpa            TEXT;   -- manual UPI (koi gateway nahi)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS min_order          NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_accepting_orders BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------- product_variants ------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id)       ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  name        TEXT NOT NULL,                             -- 'XL', 'लाल'
  price       NUMERIC(10,2),                             -- NULL = product.product price
  stock       INT,                                       -- NULL = product.stock hi
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id, is_active);

-- ---------------------------- shop_coupons ----------------------------------
CREATE TABLE IF NOT EXISTS shop_coupons (
  id           BIGSERIAL PRIMARY KEY,
  shop_id      UUID NOT NULL REFERENCES shops(id)        ON DELETE CASCADE,
  code         TEXT NOT NULL,                              -- case-insensitive UPPER me banate hai
  kind         VARCHAR(8)  NOT NULL DEFAULT 'FLAT',        -- FLAT | PERCENT
  value        NUMERIC(10,2) NOT NULL CHECK (value > 0),
  min_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount NUMERIC(10,2),                              -- PERCENT ceiling (FLAT me NULL=ok)
  times_used   INT NOT NULL DEFAULT 0,
  max_uses     INT,                                        -- NULL = unlimited
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, code)
);

COMMIT;

-- Sanity check (optional):
--   SELECT count(*) FROM orders WHERE public_token IS NULL;        -- 0 chahiye
--   SELECT count(*) FROM order_items WHERE order_id IS NOT NULL AND product_name IS NULL; -- legacy allow करता है
-- ============================================================================
-- Rollback (dev only):
--   DROP TABLE shop_coupons, product_variants;
--   ALTER TABLE orders DROP COLUMN ...  / order_items columns (manual)
-- ============================================================================
