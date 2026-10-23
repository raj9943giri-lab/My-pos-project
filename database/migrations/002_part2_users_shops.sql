-- ============================================================================
-- POS — Migration 002 (PART 2: registration, shop profile, public shop)
-- Target: PostgreSQL 13+   ·   Assumes database/schema.sql (Part 1) applied.
-- Idempotent-friendly (IF NOT EXISTS), safe to re-run.
-- Run (Termux/server):
--   psql "$DATABASE_URL" -f database/migrations/002_part2_users_shops.sql
--
-- Kyaa karega:
--   users                     merchant account (OTP login, phone normalized)
--   shop_members              ownership/role (backend access control)
--   shop_categories           admin-managed business categories (+ license rule)
--   shop_media                logo/cover (secure upload URLs)
--   shop_business_hours       per-day opening/closing hours
--   otp_codes                 hashed OTP storage (NO plaintext, short TTL)
--   shops (ALTER)             P2 columns: whatsapp/phone, hours, geo, prefs,
--                             approval workflow (approval_status + published)
--   Backfill: existing shops.owner_* → users + OWNER shop_members.
--   Seed: 10 Part-2 business categories.
-- ============================================================================

BEGIN;

-- ---------------------------- users ----------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       VARCHAR(15) NOT NULL UNIQUE,           -- normalized E.164 digits: 919876543210
  locale      VARCHAR(8)  NOT NULL DEFAULT 'hi',
  verified_at TIMESTAMPTZ,                           -- OTP verify ke baad set
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- hashed OTPs (sha-256 of "phone:code" + salt), never plaintext; TTL in app layer
CREATE TABLE IF NOT EXISTS otp_codes (
  id          BIGSERIAL PRIMARY KEY,
  phone       VARCHAR(15) NOT NULL,
  code_hash   TEXT        NOT NULL,                  -- hex digest only
  purpose     VARCHAR(20) NOT NULL DEFAULT 'LOGIN',  -- LOGIN | REGISTER
  attempts    INT         NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, created_at DESC);

-- ---------------------------- shop_members ---------------------------------
CREATE TABLE IF NOT EXISTS shop_members (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id)      ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'OWNER',   -- OWNER | MANAGER | STAFF
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON shop_members(user_id);

-- ---------------------------- shop_categories ------------------------------
CREATE TABLE IF NOT EXISTS shop_categories (
  id               VARCHAR(40) PRIMARY KEY,          -- stable slug id: pharmacy…
  name             TEXT NOT NULL UNIQUE,
  name_en          TEXT,
  emoji            TEXT DEFAULT '🏪',
  license_required BOOLEAN NOT NULL DEFAULT FALSE,  -- category-specific field rule
  license_label    TEXT,
  sort_order       INT NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,   -- admin can hide/manage
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------- shop_media -----------------------------------
CREATE TABLE IF NOT EXISTS shop_media (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     UUID NOT NULL REFERENCES shops(id)      ON DELETE CASCADE,
  kind        VARCHAR(12) NOT NULL,                   -- LOGO | COVER
  url         TEXT        NOT NULL,                   -- https URL (or S3 key)
  mime        VARCHAR(40) NOT NULL DEFAULT 'image/jpeg',
  bytes       INT         NOT NULL DEFAULT 0,
  width       INT,
  height      INT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_media_shop ON shop_media(shop_id, kind);

-- ---------------------------- shop_business_hours --------------------------
CREATE TABLE IF NOT EXISTS shop_business_hours (
  shop_id     UUID NOT NULL REFERENCES shops(id)      ON DELETE CASCADE,
  dow         INT  NOT NULL CHECK (dow BETWEEN 0 AND 6),   -- 0=Sun
  open_time   TIME NOT NULL DEFAULT '07:00',
  close_time  TIME NOT NULL DEFAULT '22:00',
  is_closed   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (shop_id, dow)
);

-- ---------------------------- shops: Part 2 columns ------------------------
ALTER TABLE shops ADD COLUMN IF NOT EXISTS whatsapp_number  VARCHAR(16);  -- '+919876543210'
ALTER TABLE shops ADD COLUMN IF NOT EXISTS business_phone   VARCHAR(16);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS license_no       TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS lat              NUMERIC(10,6);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS lng              NUMERIC(10,6);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS pickup_enabled   BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS logo_url         TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS cover_url        TEXT;
-- Approval workflow: sahi status sirf server (admin) set kare; client PATCH me allow nahi.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
    -- DRAFT | PENDING_APPROVAL | APPROVED | PUBLISHED | REJECTED | SUSPENDED
    -- (legacy shops.status PENDING|ACTIVE|REJECTED backfilled below)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS published        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS approved_by      UUID REFERENCES admin_users(id);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS approved_user_id UUID REFERENCES users(id); -- owner after backfill

-- Public visibility rule note: WHERE approval_status='APPROVED' AND published.

-- ---------------------------- backfill users + members ---------------------
INSERT INTO users (name, phone)
SELECT o.owner_name, regexp_replace(o.owner_phone, '\D', '', 'g') AS phone
FROM shops o
WHERE o.owner_phone IS NOT NULL AND o.owner_phone <> ''
ON CONFLICT (phone) DO NOTHING;

-- one OWNER membership per existing shop
INSERT INTO shop_members (shop_id, user_id, role)
SELECT o.id, u.id, 'OWNER'
FROM shops o
JOIN users u ON u.phone = regexp_replace(o.owner_phone, '\D', '', 'g')
WHERE o.owner_phone IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM shop_members m WHERE m.shop_id = o.id AND m.role = 'OWNER')
ON CONFLICT (shop_id, user_id) DO NOTHING;

UPDATE shops s SET approved_user_id = u.id
FROM shop_members m JOIN users u ON u.id = m.user_id
WHERE m.shop_id = s.id AND m.role = 'OWNER' AND s.approved_user_id IS NULL;

-- legacy status → Part-2 approval workflow mapping (visibility preserved)
UPDATE shops SET approval_status = 'APPROVED', published = TRUE       WHERE status = 'ACTIVE';
UPDATE shops SET approval_status = 'PENDING_APPROVAL'                WHERE status = 'PENDING';
UPDATE shops SET approval_status = 'REJECTED'                        WHERE status = 'REJECTED';

-- ---------------------------- seed: 10 categories --------------------------
INSERT INTO shop_categories (id, name, name_en, emoji, license_required, license_label, sort_order) VALUES
  ('grocery',            'किराना और ग्रॉसरी', 'Grocery & Kirana',    '🧺', FALSE, NULL,                     1),
  ('pharmacy',           'फार्मेसी',          'Pharmacy',            '💊', TRUE,  'औषधि लाइसेंस (DL) नंबर', 2),
  ('clothing',           'कपड़े और सिलाई',    'Clothing',            '🧵', FALSE, NULL,                     3),
  ('cafe-restaurant',    'कैफ़े और रेस्टोरेंट', 'Cafe & Restaurant',   '☕', TRUE,  'FSSAI लाइसेंस नंबर',      4),
  ('sweets-snacks',      'मिठाई और स्नैक्स',   'Sweets & Snacks',     '🍮', TRUE,  'FSSAI लाइसेंस नंबर',      5),
  ('fruits-vegetables',  'फल और सब्ज़ी',       'Fruits & Vegetables', '🍅', FALSE, NULL,                     6),
  ('bakery-dairy',       'बेकरी और डेयरी',    'Bakery & Dairy',      '🥛', TRUE,  'FSSAI लाइसेंस नंबर',      7),
  ('stationery',         'स्टेशनरी',          'Stationery',          '📚', FALSE, NULL,                     8),
  ('mobile-accessories', 'मोबाइल एक्सेसरीज़',   'Mobile Accessories',  '📱', FALSE, NULL,                     9),
  ('other',              'अन्य',              'Other',               '🏪', FALSE, NULL,                     10)
ON CONFLICT (id) DO NOTHING;

-- Check that shops+category mapping for legacy TEXT[] remains; new shops store ids in approval flow.
COMMIT;

-- ============================================================================
-- Rollback (development): 
--   DROP TABLE IF EXISTS shop_business_hours, shop_media, shop_categories,
--                        shop_members, otp_codes, users;
--   ALTER shops drop the ADD COLUMN list above (manual, dev only).
-- ============================================================================
