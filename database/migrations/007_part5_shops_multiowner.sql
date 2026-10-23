-- ============================================================================
-- MIGRATION 007 — PART 5 (shops multi-owner fix)
-- Bug: schema.sql me shops.owner_phone pe UNIQUE constraint tha
--      (shops_owner_phone_key), jiski wajah se ek merchant apni dosri shop
--      nahi bana pa raha tha (POST /shops → 500 duplicate key).
-- Part 2+ design multi-shop hai (shop_members table se membership), isliye
-- owner_phone UNIQUE hona galat hai.
-- Idempotent hai — dobara chalane pe koi error nahi.
-- ============================================================================

ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_owner_phone_key;
