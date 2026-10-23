# PART 2 — सेटअप और चैक करने के तरीके (Hindi guide)

> SOS Local Dukaan — Part 2: रजिस्ट्रेशन (OTP), दुकान प्रोफ़ाइल, यूनीक लिंक (slug),
> WhatsApp शेयर और शॉप अप्रूवल। पुराना Part 1 UI वैसे-वैसे चलता है।

---

## 1. Android app (Termux)

```bash
cd ~/storage/shared/MyProjects/POS
gradle :app:assembleDebug
# APK → app/build/outputs/apk/debug/app-debug.apk
```

काम के नए स्क्रीन:

| Screen | Route | क्या करती है |
|---|---|---|
| लॉगिन | `#/login` | मोबाइल → OTP (DEV में कोड वहीं दिखता है) |
| OTP | `#/otp` | 6 अंक, resend + 5-min TTL |
| रजिस्ट्रेशन | `#/register` | नाम + मोबाइल → कैटेगरी |
| दुकान कैटेगरी | `#/register-cats` | 10 व्यवसाय (सर्वर से) + लाइसेंस ज़रूरत का हिंट |
| दुकान का ऑनलाइन पता | `#/shop-setup` | slug + उपलब्धता, URL प्रीव्यू, व्हाट्सऐप/फ़ोन, पता+लोकेशन, समय, पिकअप/डिलीवरी, logo/cover, ड्राफ़्ट सेव |
| दुकान प्रोफ़ाइल | `#/shop` | स्टेटस कार्ड + अगला कदम + लिंक + अप्रूवल भेजें |
| प्रोफ़ाइल बदलें | `#/shop` → बदलें | पूरा फ़ॉर्म दोबारा (edit + save) |
| वेब दुकान शेयर | `#/share` | कॉन्फ़िगर डोमेन का URL, slug बदलें, OG प्रीव्यू (गारंटी नोट), WhatsApp शेयर |

**DEV ऑफ़लाइन मोड** (बिना backend): डेटा सिर्फ़ फ़ोन में, mock OTP यहीं दिखता है —
हर संबंधित स्क्रीन पर साफ़ "DEV ओफ़लाइन" बैनर। यह मोड सिर्फ़ डेवलपमेंट के लिए है।
Settings → **कनेक्शन और डोमेन** से API URL भरते ही ऐप SERVER मोड में जाता है
(ख़ाली छोड़ने पर वापस DEV)।

## 2. Backend (NestJS + PostgreSQL)

```bash
cd POS/backend
cp .env.example .env            # DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, PUBLIC_SHOP_ORIGIN
npm install
npm test                        # unit: slug + phone (DB नहीं चाहिए)
DATABASE_URL=... JWT_SECRET=... ADMIN_PASSWORD=x npm run test:e2e   # DB + env चाहिए
npm run start:dev               # boot पर SQL migrations ख़ुद लगती हैं
```

### Android/Termux पर npm install चेतावनी (असली अनुभव)

`/storage/emulated/0` (फ़ोन की shared storage) पर npm के `.bin` सिम्लिंक नहीं बनते —
असली रिज़ल्ट: `npm error The operation was rejected by your operating system` (build:link चरण)।
दो तरीके:

1. **वहीं PE चलाना है तो:** `npm install --no-audit --no-fund --bin-links=false` — सिम्लिंक छोड़ता है;
   उसके बाद `.bin` नहीं बनता, इसलिए टूल सीधे चलाओ:
   `node node_modules/typescript/bin/tsc --noEmit`,
   `node node_modules/jest/bin/jest.js --config jest.config.json`
2. **या** backend की कॉपी Termux की घर की (internal) डायरेक्टरी में रखकर सामान्य `npm install`।

सोर्स कोड `POS/backend` में जहाँ है वहीं रहता है — यह सिर्फ़ node_modules का चलाने का तरीका है।

प्रोडक्शन: HTTPS प्रॉक्सी (Caddy/Nginx), `SMS_PROVIDER=http`, rate-limiter को Redis में
शिफ़्ट (backend/README → production notes), कोई सीक्रेट .env.example में नहीं।

## 3. curl आज़माइश (API examples)

```bash
BASE=http://localhost:4000

# कैटेगरी
curl $BASE/shop-categories

# रजिस्ट्रेशन (dev में devCode रिस्पॉन्स में; production में SMS जाता है)
curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"राजेश शर्मा","phone":"9876543210"}'
RES=$(curl -s -X POST $BASE/auth/otp/request -H 'Content-Type: application/json' \
  -d '{"phone":"9876543210"}'); echo "$RES"
CODE=$(echo "$RES" | sed -E 's/.*"devCode":"([0-9]+)".*/\1/')
AUTH=$(curl -s -X POST $BASE/auth/otp/verify -H 'Content-Type: application/json' \
  -d "{\"phone\":\"9876543210\",\"code\":\"$CODE\"}")
TOKEN=$(echo "$AUTH" | sed -E 's/.*"token":"([^"]+)".*/\1/')

# दुकान बनाना (यूनीक slug, स्टेटस DRAFT)
curl -s -X POST $BASE/shops -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"राजेश किराना","slug":"rajesh-kirana","categoryIds":["grocery"],
       "whatsapp":"+919876543210","address":"मुख्य बाज़ार","pin":"232101"}'

# slug उपलब्धता
curl "$BASE/shops/check-slug?slug=rajesh-kirana"

# अप्रूवल भेजना; पब्लिक व्यू (सिर्फ़ ADMIN अप्रूव के बाद 200, वरना 404)
SHOP_ID=$(curl -s $BASE/shops/my -H "Authorization: Bearer $TOKEN" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -X POST $BASE/shops/$SHOP_ID/submit-for-approval -H "Authorization: Bearer $TOKEN"
curl $BASE/shops/rajesh-kirana/public
```

- **दूसरे की दुकान PATCH → 403** (`shop_members` के role से सर्वर-side कंट्रोल)।
- **वही slug दोबारा → 409** और साथ में `suggestions: ["rajesh-kirana-2", …]`।

## 4. WhatsApp व लिंक

- पब्लिक URL = `पब्लिक बेस URL + / <slug>`; ऐप Settings → कनेक्शन से डोमेन बदलें।
- `#/share`: WhatsApp (wa.me), कॉपी, system-share; slug बदलें (availability जांच)।
- **ईमानदार नोट**: WhatsApp हर मैसेज में लिंक-प्रीव्यू/कस्टम आइकन दिखने की गारंटी
  नहीं देता — इसलिए शेयर मैसेज में दुकान का नाम साफ़ रहता है। OG metadata
  `GET /shops/:slug/public` के `og` फ़ील्ड में तैयार रहता है (customer web-store side)।

## 5. माइग्रेशन व सुरक्षा सारांश

- `database/migrations/002_part2_users_shops.sql`: `users`, `shop_members`,
  `shop_categories` (10 seed), `shop_media`, `shop_business_hours`, hashed
  `otp_codes`; `shops` ALTER (+whatsapp/phone/license/geo/hours/prefs/approval
  `approval_status`), FK + unique蜒 slug + इंडेक्स; पुराने shops का backfill।
- OTP plaintext में कभी नहीं (sha256 + pepper, TTL 5 मिनट, 5 गलत → लॉक), लॉग में नहीं।
- `approval_status/published` सिर्फ़ `PATCH /admin/shops/:id/status` से बदलते हैं —
  merchant client की अनुमति नहीं (400 देता है)। `admin.html` Part-1 डेमो है;
  असली अप्रूवल admin API से होता है।
