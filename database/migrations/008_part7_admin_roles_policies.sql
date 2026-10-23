-- ============================================================================
-- POS — Migration 008 (PART 7: admin roles, shop workflow, complaints, policy)
-- Target: PostgreSQL 13+   ·   Assumes database/schema.sql + 002…007 applied.
-- Idempotent (IF NOT EXISTS / DO-blocks), safe to re-run.
-- Run (Termux/server):
--   psql "$DATABASE_URL" -f database/migrations/008_part7_admin_roles_policies.sql
--
-- Kyaa karega:
--   users.role                 platform role (MERCHANT default) + CHECK
--   admin_users (ALTER)        role normalize (SUPER→SUPER_ADMIN), is_active,
--                              last_login_at, timestamps, role CHECK
--   shops (ALTER)              approval_status normalize → Part-7 enum:
--                              PENDING_APPROVAL→PENDING, PUBLISHED→APPROVED,
--                              suspended_at, status CHECK + history table
--   shop_status_history        हर approve/reject/suspend का ऑडिट
--   complaints (ALTER)         enum status + category/priority/source,
--                              assignment, SLA timestamps, order link
--   complaint_status_history   Open→InProgress→Resolved→Closed ऑडिट
--   complaint_notes            internal/external टिप्पणी धागा
--   platform_policies          admin-editable नियम (seed defaults)
--   audit_log (safety CREATE)  schema.sql से आता है; न होने पर बना लेते हैं
-- ============================================================================

BEGIN;

-- ---------------------------- users.role -----------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'MERCHANT';
UPDATE users SET role = 'MERCHANT' WHERE role IS NULL OR role = '' OR role = 'USER';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'MERCHANT'));
  END IF;
END $$;

-- ---------------------------- admin_users (Part 7) -------------------------
-- schema.sql: id, email, name, pwd_hash, role ('ADMIN' default, legacy 'SUPER')
UPDATE admin_users SET role = 'SUPER_ADMIN' WHERE role IN ('SUPER', 'ROOT', 'OWNER');
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_role_check') THEN
    ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
      CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SUPPORT'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role, is_active);

-- ---------------------------- shops: enum normalize + audit ----------------
-- Legacy Part-2 वैल्यू → Part-7 ShopStatus enum.
UPDATE shops SET approval_status = 'PENDING'  WHERE approval_status = 'PENDING_APPROVAL';
UPDATE shops SET approval_status = 'APPROVED' WHERE approval_status = 'PUBLISHED';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_approval_status_check') THEN
    ALTER TABLE shops ADD CONSTRAINT shops_approval_status_check
      CHECK (approval_status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_shops_approval_status ON shops(approval_status, submitted_at NULLS LAST);

CREATE TABLE IF NOT EXISTS shop_status_history (
  id             BIGSERIAL PRIMARY KEY,
  shop_id        UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  from_status    VARCHAR(20),
  to_status      VARCHAR(20) NOT NULL,
  action         VARCHAR(20) NOT NULL,          -- SUBMIT | APPROVE | REJECT | SUSPEND | UNSUSPEND
  reason         TEXT,
  actor_admin_id UUID REFERENCES admin_users(id),
  actor_user_id  UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_status_history_shop  ON shop_status_history(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_status_history_admin ON shop_status_history(actor_admin_id, created_at DESC);

-- ---------------------------- complaints (Part 7) ---------------------------
-- schema.sql की बुनियादी तालिका थी (order_ref, body, status OPEN|RESOLVED);
-- अब पूरा जीवन-चक्र + assignment + audit.
UPDATE complaints SET status = 'OPEN' WHERE status IS NULL OR status = '';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS category          VARCHAR(20) NOT NULL DEFAULT 'OTHER';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS priority          VARCHAR(10) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS source            VARCHAR(12) NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS order_id          BIGINT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS customer_name     TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS customer_phone    VARCHAR(15);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS assigned_to       UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolution_note   TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_status_check') THEN
    ALTER TABLE complaints ADD CONSTRAINT complaints_status_check
      CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_category_check') THEN
    ALTER TABLE complaints ADD CONSTRAINT complaints_category_check
      CHECK (category IN ('ORDER', 'SHOP', 'PRODUCT', 'DELIVERY', 'PAYMENT', 'OTHER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_priority_check') THEN
    ALTER TABLE complaints ADD CONSTRAINT complaints_priority_check
      CHECK (priority IN ('LOW', 'NORMAL', 'HIGH'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_source_check') THEN
    ALTER TABLE complaints ADD CONSTRAINT complaints_source_check
      CHECK (source IN ('CUSTOMER', 'MERCHANT'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_complaints_status    ON complaints(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_shop      ON complaints(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned  ON complaints(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_complaints_order     ON complaints(order_id);

CREATE TABLE IF NOT EXISTS complaint_status_history (
  id              BIGSERIAL PRIMARY KEY,
  complaint_id    BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  from_status     VARCHAR(15),
  to_status       VARCHAR(15) NOT NULL,
  action          VARCHAR(20) NOT NULL,       -- START | RESOLVE | CLOSE | REOPEN
  note            TEXT,
  actor_admin_id  UUID REFERENCES admin_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csh_complaint ON complaint_status_history(complaint_id, created_at);

CREATE TABLE IF NOT EXISTS complaint_notes (
  id              BIGSERIAL PRIMARY KEY,
  complaint_id    BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  author_admin_id UUID REFERENCES admin_users(id),
  author_name     TEXT,
  body            TEXT NOT NULL,
  is_internal     BOOLEAN NOT NULL DEFAULT TRUE,   -- internal = ग्राहक/दुकान को नहीं दिखता
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaint_notes ON complaint_notes(complaint_id, created_at);

-- ---------------------------- platform_policies ----------------------------
CREATE TABLE IF NOT EXISTS platform_policies (
  key         VARCHAR(60) PRIMARY KEY,      -- stable key: commission_default…
  value       JSONB NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES admin_users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_policies (key, value, label, description) VALUES
  ('commission_default_pct', '{"value": 5}',   'डिफ़ॉल्ट कमीशन (%)',
   'नई दुकान पर लगने वाला प्लेटफ़ॉर्म कमीशन — प्रति कैटेगरी ओवरराइड अलग है.'),
  ('cod_max_order',          '{"value": 5000}','COD अधिकतम ऑर्डर राशि (₹)',
   'इससे बड़े COD ऑर्डर checkout पर रिजेक्ट होंगे.'),
  ('shop_approval_sla_hrs',  '{"value": 24}',  'दुकान अप्रूवल SLA (घंटे)',
   'PENDING दुकान को इतने घंटों में जाँचने का प्लेटफ़ॉर्म वादा.'),
  ('complaint_sla_hrs',      '{"value": 48}',  'शिकायत जवाब SLA (घंटे)',
   'खुली शिकायत का पहला जवाब इतने घंटों में होना चाहिए.'),
  ('refund_window_days',     '{"value": 7}',   'रिफ़ंड विंडो (दिन)',
   'डिलीवरी के इतने दिनों के भीतर शिकायत-आधारित रिफ़ंड विचारा जाता है.'),
  ('auto_publish_on_approve','{"value": true}','अप्रूवल पर अपने-आप पब्लिश',
   'बंद करें तो approve पर दुकान पब्लिक नहीं होती — admin मैन्युअल publish.'),
  ('max_categories_per_shop','{"value": 3}',   'दुकान की अधिकतम कैटेगरी',
   'रजिस्ट्रेशन में चुन सकने वाली व्यवसाय-कैटेगरी सीमा.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------- audit_log (safety) ----------------------------
-- schema.sql में पहले से है; यहाँ फिर से (IF NOT EXISTS) — सिर्फ़ बीमा.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   UUID REFERENCES admin_users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

COMMIT;

-- ============================================================================
-- Rollback (development):
--   DROP TABLE IF EXISTS complaint_notes, complaint_status_history,
--        shop_status_history, platform_policies;
--   ALTER TABLE complaints DROP the added columns (manual, dev only);
--   UPDATE shops SET approval_status='PENDING_APPROVAL' WHERE approval_status='PENDING';
--   (CHECK constraints: ALTER TABLE … DROP CONSTRAINT …)
-- ============================================================================
