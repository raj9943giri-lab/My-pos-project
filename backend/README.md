# POS API — NestJS backend (PART 2)

`Auth (OTP) + Shop profile + Slug/URL + Media + Approval` — endpoints जो merchant ऐप
(`assets/pos-api.js`) सर्वर मोड में कॉल करता है। Frontend offline DEV मोड में बिना backend
भी चलता है (on-screen mock OTP) — पूरी कहानी `docs/PART2_SETUP.md` में।

## Endpoints (Part 2)

| Method | Route | Auth | Note |
|---|---|---|---|
| POST | `/auth/register` | – | {name, phone} → profile pre-save |
| POST | `/auth/otp/request` | – | rate-limit 5/30min; dev में `devCode` रिस्पॉन्स में (console provider), लॉग में कभी नहीं |
| POST | `/auth/otp/verify` | – | hash compare (timing-safe, 5 attempts) → JWT + shop |
| GET | `/shop-categories` | – | 10 seed categories (+license flags) |
| POST | `/shops` | JWT | status DRAFT बनता है; client approval_status सेट नहीं कर सकता |
| GET | `/shops/my` | JWT | owner की दुकान |
| GET | `/shops/:id` | JWT | कोई member देख सकता है, बाहर के 403 |
| PATCH | `/shops/:id` | JWT OWNER | approval_status/published भेजने पर 400 |
| POST | `/shops/:id/media` | JWT OWNER | multipart `file`+`kind=LOGO/COVER`; jpg/png/webp ≤3MB; magic-byte check |
| GET | `/shops/check-slug?slug=…` | – | 60/min per IP; `available` + suggestions |
| GET | `/shops/:slug/public` | – | **सिर्फ़** APPROVED+published; `og` metadata फ़ील्ड साथ (लिंक preview हमेशा नहीं दिखता) |
| POST | `/shops/:id/submit-for-approval` | JWT OWNER | प्रोफ़ाइल पूरा होना ज़रूरी; status→PENDING_APPROVAL |
| PATCH | `/admin/shops/:id/status` | ADMIN | APPROVED (+auto-publish) / REJECTED(reason) / SUSPENDED |
| GET | `/admin/shops` | ADMIN | review queue |
| PATCH | `/admin/shop-categories/:id` | ADMIN | categories admin-managed |

## सेटअप (Termux या किसी भी Node 18+ मशीन)

```bash
# 1) PostgreSQL (docker या local)
docker run -d --name posdb -e POSTGRES_PASSWORD=pos -e POSTGRES_USER=pos -e POSTGRES_DB=posdb -p 5432:5432 postgres:16

# 2) Backend
cd backend
cp .env.example .env        # DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD बदलें (production में SMS_PROVIDER=http)
npm install

# 3) Tests (unit) + e2e (DB ज़रूरी हो तभी चलेगा, वरना auto-skip)
npm test                    # slug + phone validation के टेस्ट
DATABASE_URL=... JWT_SECRET=... npm run test:e2e

# 4) Run
npm run start:dev           # migrations boot पर ख़ुद चलती हैं (schema_migrations log)
curl localhost:4000/shop-categories | head
```

Production checklist: `NODE_ENV=production` (console SMS अगला लॉक), HTTPS (reverse-proxy Caddy/Nginx),
Redis-backed rate-limiter, S3 media upload अगर चाहें (`media.service` सिर्फ़ local-disk लिखता है)।

## Made-to-fit बातें

- **OTP plaintext नहीं**: `otp_codes.code_hash` (sha256 `phone:code:PEPPER`), 5 बार गलत → लॉक, पुराना कोड ऑटो-invalidate.
- **Ownership server-side**: हर private route `AuthGuard` + `shop_members` role check; कोई दूसरे की दुकान PATCH/देख नहीं सकता।
- **Duplicates**: एक ही नाम की दो दुकानें — slug unique constraint + `-2..-5` suggestions (Part-1 नियम बरक़रार)।
- **डोमेन**: `PUBLIC_SHOP_ORIGIN` backend का OG url बनाता है; और ऐप-साइड `Settings → कनेक्शन` से भी configurable।
- **WhatsApp**: ` Shops.whatsapp_number` हमेशा नॉर्मलाइज़्ड E.164 (`+9198…`), साझा करने वाला लिंक `https://wa.me/91…`।
