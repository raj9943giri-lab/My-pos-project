-- ============================================================================
-- POS — Migration 001 (PART 1 baseline)
-- Target: PostgreSQL 13+   ·   Fresh databases के लिए शुरुआती schema.
--
-- PART 2 से पहले schema.sql manually चलती थी; migrator सिर्फ़ 002… चलाता था,
-- इसलिए ख़ाली DB पर migrations fail होती थीं. यह file वही baseline है —
-- पूरी तरह idempotent (IF NOT EXISTS), इसलिए पुरानी DB पर दोबारा चलना सुरक्षित है.
-- ============================================================================

BEGIN;

-- ---------------------------- Merchants / Shops ----------------------------
CREATE TABLE IF NOT EXISTS shops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name    TEXT        NOT NULL,
  owner_phone   VARCHAR(15) NOT NULL,
  shop_name     TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,
  categories    TEXT[]      NOT NULL DEFAULT '{}',
  emoji         TEXT        DEFAULT '🏪',
  address       TEXT,
  pincode       VARCHAR(10),
  open_time     TIME        DEFAULT '07:00',
  close_time    TIME        DEFAULT '22:00',
  is_open       BOOLEAN     NOT NULL DEFAULT TRUE,
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  rating        NUMERIC(2,1) DEFAULT 0,
  about         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------- Product catalogue ----------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  emoji       TEXT DEFAULT '🧺',
  sort_order  INT  DEFAULT 0,
  UNIQUE (shop_id, name)
);

CREATE TABLE IF NOT EXISTS products (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES product_categories(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  unit        TEXT        NOT NULL,
  price       NUMERIC(10,2) NOT NULL CHECK (price > 0),
  mrp         NUMERIC(10,2),
  stock       INT         NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_at      INT         NOT NULL DEFAULT 5,
  brand       TEXT,
  fresh_note  TEXT,
  shelf_life_h INT,
  photo_url   TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id, is_active);

-- ---------------------------- Customers (web store) -----------------------
CREATE TABLE IF NOT EXISTS customers (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  phone     VARCHAR(15) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, phone)
);

-- ---------------------------- Orders --------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id),
  customer_id UUID REFERENCES customers(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'NEW',
  sub_total   NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  pay_mode    VARCHAR(10) NOT NULL DEFAULT 'COD',
  addr        TEXT,
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders(shop_id, status, placed_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty        INT  NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL
);

-- ---------------------------- Delivery settings ----------------------------
CREATE TABLE IF NOT EXISTS delivery_settings (
  shop_id     UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  delivery_on BOOLEAN NOT NULL DEFAULT TRUE,
  fee         NUMERIC(10,2) NOT NULL DEFAULT 20,
  free_above  NUMERIC(10,2) NOT NULL DEFAULT 499,
  radius_km   INT NOT NULL DEFAULT 5,
  note        TEXT DEFAULT '30-60 मिनट'
);

-- ---------------------------- Notifications -------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id        BIGSERIAL PRIMARY KEY,
  shop_id   UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type      VARCHAR(20) NOT NULL,
  body      TEXT NOT NULL,
  ref_id    TEXT,
  read_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------- Admin side ----------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email    TEXT UNIQUE NOT NULL,
  name     TEXT,
  pwd_hash TEXT NOT NULL,
  role     VARCHAR(20) NOT NULL DEFAULT 'ADMIN'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        BIGSERIAL PRIMARY KEY,
  admin_id  UUID REFERENCES admin_users(id),
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  meta      JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commissions (
  category TEXT PRIMARY KEY,
  pct      NUMERIC(5,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS complaints (
  id        BIGSERIAL PRIMARY KEY,
  order_ref TEXT,
  shop_id   UUID NOT NULL REFERENCES shops(id),
  body      TEXT NOT NULL,
  status    VARCHAR(15) NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
