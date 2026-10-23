-- ============================================================================
-- POS — PostgreSQL schema scaffold (PART 1 pre-build design)
-- Merchant app (Android/WebView) ➜ NestJS API ➜ PostgreSQL (target stack).
-- PART 1 ships only this file; migrations land in PART 2 (NestJS/prisma).
-- ============================================================================

-- ---------------------------- Merchants / Shops ----------------------------
CREATE TABLE shops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name    TEXT        NOT NULL,
  owner_phone   VARCHAR(15) NOT NULL,                 -- login: OTP on this no. (ek merchant ki kai shops ho sakti hain, isliye UNIQUE NAHI)
  shop_name     TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,           -- public web-store path
  categories    TEXT[]      NOT NULL DEFAULT '{}',     -- shop categories
  emoji         TEXT        DEFAULT '🏪',
  address       TEXT,
  pincode       VARCHAR(10),
  open_time     TIME        DEFAULT '07:00',
  close_time    TIME        DEFAULT '22:00',
  is_open       BOOLEAN     NOT NULL DEFAULT TRUE,
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING|ACTIVE|REJECTED
  rating        NUMERIC(2,1) DEFAULT 0,
  about         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------- Product catalogue ----------------------------
CREATE TABLE product_categories (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  emoji       TEXT DEFAULT '🧺',
  sort_order  INT  DEFAULT 0,
  UNIQUE (shop_id, name)
);

CREATE TABLE products (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES product_categories(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  unit        TEXT        NOT NULL,             -- 1 किलो / 500 ग्राम / 1 लीटर
  price       NUMERIC(10,2) NOT NULL CHECK (price > 0),
  mrp         NUMERIC(10,2),
  stock       INT         NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_at      INT         NOT NULL DEFAULT 5,   -- low-stock alert threshold
  brand       TEXT,
  fresh_note  TEXT,                             -- फल-सब्जी ताज़गी नोट
  shelf_life_h INT,                             -- डेयरी शेल्फ लाइफ
  photo_url   TEXT,                             -- PART 2 (S3)
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_shop ON products(shop_id, is_active);

-- ---------------------------- Customers (web store) -----------------------
CREATE TABLE customers (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  phone     VARCHAR(15) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, phone)
);

-- ---------------------------- Orders --------------------------------------
CREATE TABLE orders (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id),
  customer_id UUID REFERENCES customers(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'NEW'
              -- NEW | PREPARED | TRANSIT | DELIVERED | CANCELLED
              -- (मराठी UI नक्शा: नई|तैयार|रास्ते में|पूरी|रद्द)
  ,
  sub_total   NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  pay_mode    VARCHAR(10) NOT NULL DEFAULT 'COD',  -- COD | UPI
  addr        TEXT,
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX idx_orders_shop_status ON orders(shop_id, status, placed_at DESC);

CREATE TABLE order_items (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty        INT  NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL               -- price snapshot
);

-- ---------------------------- Delivery settings ----------------------------
CREATE TABLE delivery_settings (
  shop_id     UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  delivery_on BOOLEAN NOT NULL DEFAULT TRUE,
  fee         NUMERIC(10,2) NOT NULL DEFAULT 20,
  free_above  NUMERIC(10,2) NOT NULL DEFAULT 499,
  radius_km   INT NOT NULL DEFAULT 5,
  note        TEXT DEFAULT '30-60 मिनट'
);

-- ---------------------------- Notifications -------------------------------
CREATE TABLE notifications (
  id        BIGSERIAL PRIMARY KEY,
  shop_id   UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type      VARCHAR(20) NOT NULL,                 -- ORDER | STOCK | INFO
  body      TEXT NOT NULL,
  ref_id    TEXT,
  read_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------- Admin side (Next.js) ------------------------
CREATE TABLE admin_users (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email    TEXT UNIQUE NOT NULL,
  name     TEXT,
  pwd_hash TEXT NOT NULL,
  role     VARCHAR(20) NOT NULL DEFAULT 'ADMIN'    -- ADMIN | SUPER
);

CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  admin_id  UUID REFERENCES admin_users(id),
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  meta      JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commission per shop category (mocked in PART 1 admin.html)
CREATE TABLE commissions (
  category TEXT PRIMARY KEY,
  pct      NUMERIC(5,2) NOT NULL
);

-- Complaints
CREATE TABLE complaints (
  id        BIGSERIAL PRIMARY KEY,
  order_ref TEXT,
  shop_id   UUID NOT NULL REFERENCES shops(id),
  body      TEXT NOT NULL,
  status    VARCHAR(15) NOT NULL DEFAULT 'OPEN',  -- OPEN | RESOLVED
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Seed stub (matches demo screens):
-- INSERT INTO commissions (category, pct) VALUES
--   ('किराना',5),('फल-सब्जी',3),('डेयरी',8),('फार्मेसी',4),('अन्य',6);
-- ============================================================================
