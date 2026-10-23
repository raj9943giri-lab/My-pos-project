import * as path from 'path';
import * as fs from 'fs';
import { loadDotEnv } from './load-env';

// .env सबसे पहले — process.env में पहले से मौजूद keys नहीं बदलतीं.
loadDotEnv();

/**
 * migrations फ़ोल्डर ढूँढना — cwd और __dirname दोनों से (ts-jest, nest build
 * dist/src, या सीधे `node dist/src/main.js` — हर हाल में POS/database/migrations).
 */
function findMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'database/migrations'),
    path.resolve(process.cwd(), '../database/migrations'),
    path.resolve(__dirname, '../../../database/migrations'),
    path.resolve(__dirname, '../../../../database/migrations'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[1];
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error('Missing required env: ' + name);
  return v.trim();
}

function opt(name: string): string {
  return (process.env[name] || '').trim();
}

/* NOTE: DATABASE_URL/JWT_SECRET/ADMIN_PASSWORD Import-time के REQUIRED नहीं — jest
 * e2e (बिना DATABASE_URL) module Import करते ही auto-skip चाहिए। Runtime पर
 * main.ts bootstrapIn में सख्ती से जाँच होती है (कोई रूट सेवा से पहले)। */
const DEV_JWT_FALLBACK = 'dev-only-insecure-secret-0123456789abcdef';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_DEV = !!process.env.JEST_WORKER_ID || NODE_ENV !== 'production';

export const env = {
  NODE_ENV: NODE_ENV,
  PORT: Number(process.env.PORT || 4000),

  DATABASE_URL: opt('DATABASE_URL'),

  JWT_SECRET: opt('JWT_SECRET') || DEV_JWT_FALLBACK,
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET || opt('JWT_SECRET') || DEV_JWT_FALLBACK,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@pos.local',
  ADMIN_PASSWORD: opt('ADMIN_PASSWORD') || (IS_DEV ? 'admin-dev-only' : ''),
  ADMIN_PASSWORD_MISSING: !opt('ADMIN_PASSWORD'),

  PUBLIC_SHOP_ORIGIN: process.env.PUBLIC_SHOP_ORIGIN || 'https://dukan.example.com',
  // Production CORS allow-list (comma-separated). Default: public storefront.
  CORS_ORIGINS: opt('CORS_ORIGINS'),
  MEDIA_URL_BASE: process.env.MEDIA_URL_BASE || 'http://localhost:' + (process.env.PORT || 4000) + '/media',
  UPLOAD_DIR: path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'),

  // PART 6 — sharing / OG metadata.
  // SHARE_TEXT_TEMPLATE: वैकल्पिक; {shop_name} व {shop_url} placeholders — खाली
  // छूटे तो share.ts का हिंदी default चलता है.
  SHARE_TEXT_TEMPLATE: opt('SHARE_TEXT_TEMPLATE'),
  // दुकान का लोगो/कवर न हो तो OG इमेज — default: PUBLIC_SHOP_ORIGIN/og-default.png
  // (customer-web/public/og-default.png; raster PNG ही — OG में SVG नहीं चलता).
  OG_DEFAULT_IMAGE_URL: opt('OG_DEFAULT_IMAGE_URL'),

  SMS_PROVIDER: process.env.SMS_PROVIDER || 'console',     // console | http
  SMS_API_URL: process.env.SMS_API_URL || '',
  SMS_API_KEY: process.env.SMS_API_KEY || '',
  SMS_SENDER: process.env.SMS_SENDER || 'POSDUKAN',

  // PART 5 — push notifications. OPTIONAL: खाली छूटेगी तो सिर्फ़ in-app
  // इतिहास भेजा जाएगा (outbox DONE पर साफ़ note के साथ); push का वादा केवल
  // key configured होने पर. कभी source code में key नहीं रखी जाती (.env में).
  FCM_SERVER_KEY: opt('FCM_SERVER_KEY'),
  NOTIFIER_INTERVAL_MS: Number(process.env.NOTIFIER_INTERVAL_MS || 20000),

  OTP_TTL_MINUTES: Number(process.env.OTP_TTL_MINUTES || 5),
  OTP_MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  OTP_MAX_PER_30MIN: Number(process.env.OTP_MAX_PER_30MIN || 5),

  MIGRATIONS_DIR: process.env.MIGRATIONS_DIR
    ? path.resolve(process.cwd(), process.env.MIGRATIONS_DIR)
    : findMigrationsDir(),
};

export const isDev = IS_DEV;

if (IS_DEV) {
  if (!process.env.JWT_SECRET) console.warn('[pos-api][warn] JWT_SECRET nahi mila — DEV fallback key use ho (sirf डेवलपमेंट)');
  if (!env.DATABASE_URL) console.warn('[pos-api][warn] DATABASE_URL khali hai — jest e2e auto-skip, असली सर्वर start होने से पहले .env ज़रूरी');
} else {
  if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be 32+ chars in production');
  if (env.SMS_PROVIDER === 'console') throw new Error('SMS_PROVIDER=console is DEV-ONLY');
  if (env.ADMIN_PASSWORD_MISSING) throw new Error('ADMIN_PASSWORD required in production');
}

/* PART 6 — production में public origin HTTPS ही (share.ts normalizePublicOrigin
 * भी runtime पर यही पक्का करता है; यहाँ boot fail-fast है). Dev में localhost/http चलेगा. */
if (!IS_DEV && env.PUBLIC_SHOP_ORIGIN && !/^https:\/\//i.test(env.PUBLIC_SHOP_ORIGIN.trim())) {
  throw new Error('PUBLIC_SHOP_ORIGIN must start with https:// in production (मिला: ' + env.PUBLIC_SHOP_ORIGIN + ')');
}

/* PART 8 — production upload/media URLs और CORS भी साफ़ रहें:
 * localhost/emulator host कभी release config में न जाएँ. */
function isLocalHostUrl(u: string): boolean {
  return /(^|[/:.])(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)([:/.]|$)/i.test(u);
}
if (!IS_DEV) {
  if (!/^https:\/\//i.test(env.MEDIA_URL_BASE) || isLocalHostUrl(env.MEDIA_URL_BASE)) {
    throw new Error('MEDIA_URL_BASE must be a public https:// URL in production (मिला: ' + env.MEDIA_URL_BASE + ')');
  }
  const origins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [env.PUBLIC_SHOP_ORIGIN];
  for (const o of origins) {
    if (!/^https:\/\//i.test(o) || isLocalHostUrl(o)) {
      throw new Error('CORS_ORIGINS entries must be public https:// origins (मिला: ' + o + ')');
    }
  }
}
