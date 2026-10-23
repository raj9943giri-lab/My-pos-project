-- ============================================================================
-- POS — Migration 006 (PART 5: order lifecycle, fulfilment, notifications)
-- Target: PostgreSQL 13+   ·   Requires database/schema.sql + 002/003/004/005.
-- Idempotent (IF NOT EXISTS) — safe to re-run. Auto-applied by src/db/migrator.ts.
--
-- Kya karta hai:
--   order_status_history  हर status बदलाव का हिसाब (पहले का status, नया,
--                         किसने किया actor, क्यों reason) — सिर्फ़ server
--                         transition validate करके यहाँ लिखता है।
--   orders (ALTER)        lifecycle कॉलम: reject/cancel का reason,
--                         rejected_at/cancelled_at/completed_at टाइमस्टैम्प,
--                         accepted_at, preparing flag के लिए activity नहीं —
--                         सब order_status_history में ही है; orders पर सिर्फ़
--                         नतीजे (reason) दिखाने के लिए columns।
--   notification_outbox   ट्रांज़ैक्शन COMMIT के बाद ही भेजे जाने वाले
--                         notifications की कतार (at-least-once, bounded retry).
--   user_device_tokens    FCM push के लिए per-user device tokens (refresh ok).
--   notifications (ALTER) in-app हिस्ट्री को user से जोड़ना (merchant ऐप की
--                         सूची) — पहले से मौजूद notifications टेबल reuse.
--
-- नोट (स्टॉक): Part-4 checkout स्टॉक पहले ही transaction में काट देता है
--   (products FOR UPDATE + SALE movement) — इसलिए कोई अलग inventory
--   reservation टेबल नहीं बनती; reject/cancel पर सिर्फ़ RETURN movement ही
--   वापसी है और वह order row-lock + valid-transition जाँच से ठीक एक बार
--   चलता है (orders.service.ts का guard)।
-- ============================================================================

BEGIN;

-- ---------------------------- order_status_history --------------------------
CREATE TABLE IF NOT EXISTS order_status_history (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status VARCHAR(20),                        -- NULL = पहला (NEW लगना)
  new_status    VARCHAR(20) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = ग्राहक/सिस्टम
  reason        TEXT,                                 -- reject/cancel/notes (≤300)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ऑर्डर डिटेल/टाइमलाइन स्क्रीन के लिए
CREATE INDEX IF NOT EXISTS idx_os_history_order ON order_status_history (order_id, created_at DESC);
-- ऑडिट: "किस user ने कब क्या बदला"
CREATE INDEX IF NOT EXISTS idx_os_history_actor ON order_status_history (actor_user_id, created_at DESC);

-- ---------------------------- orders: lifecycle columns ---------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- (cancelled_at schema.sql में है पर legacy rows पर भरोसा नहीं — इस migration
--  के बाद सिर्फ़ server cancel लिखता है।)

-- ---------------------------- notification_outbox ---------------------------
CREATE TABLE IF NOT EXISTS notification_outbox (
  id            BIGSERIAL PRIMARY KEY,
  event_type    VARCHAR(40) NOT NULL,                 -- ORDER_NEW | ORDER_ACCEPTED | …
  aggregate_type VARCHAR(20) NOT NULL DEFAULT 'ORDER',
  aggregate_id  TEXT NOT NULL,                        -- order id (string)
  payload       JSONB NOT NULL DEFAULT '{}',          -- ग्राहक का पता/पेमेंट नहीं!
  status        VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | DONE | FAILED | SKIPPED
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);
-- ड्रेनर यहीं से उठाएगा (सस्ता index)
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON notification_outbox (status, next_attempt_at NULLS FIRST, created_at);
-- डुप्लिकेट event रोकने के लिए: एक ही event एक ही order पर एक बार
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_event
  ON notification_outbox (event_type, aggregate_type, aggregate_id);

-- ---------------------------- user_device_tokens ----------------------------
CREATE TABLE IF NOT EXISTS user_device_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,                        -- FCM registration token
  platform    VARCHAR(12) NOT NULL DEFAULT 'ANDROID',-- ANDROID | IOS | WEB
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_token)
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON user_device_tokens (user_id, is_active);

-- ---------------------------- notifications: user column --------------------
-- पहले से मौजूद (schema.sql) in-app notifications टेबल reuse हो रही है;
-- merchant user के हिसाब से पढ़ने के लिए user कॉलम (नाम notified के लिए)।
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_kind VARCHAR(12) NOT NULL DEFAULT 'ORDER';
-- पुरानी rows (user_id NULL) shop-membership join से ही दिखती रहेंगी।

COMMIT;

-- Sanity check (optional):
--   SELECT count(*) FROM orders WHERE cancelled_at IS NOT NULL AND status <> 'CANCELLED';  -- 0
--   SELECT event_type, count(*) FROM notification_outbox GROUP BY 1;
-- ============================================================================
-- Rollback (dev only):
--   DROP TABLE user_device_tokens, notification_outbox, order_status_history;
--   ALTER TABLE orders DROP COLUMN …  / notifications DROP COLUMN user_id …
-- ============================================================================
