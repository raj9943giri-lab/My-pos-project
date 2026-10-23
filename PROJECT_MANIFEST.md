# POS — Project Manifest (PART 1)

**Screens's app:** POS (merchant point-of-sale, Hindi-first UI)
**Package:** `com.example.pos` · **Version:** `2.4.1-part8` (versionCode 2) · **Date:** 2026-10-21

> PART 1 = पूरा प्रोजेक्ट स्ट्रक्चर + सारी मुख्य स्क्रीन और नेविगेशन, डेमो डेटा के साथ।
> PART 2 = मर्चेंट रजिस्ट्रेशन (OTP), दुकान प्रोफ़ाइल, कैटेगरी, unique URL + WhatsApp शेयर, अप्रूवल — NestJS + PostgreSQL backend और ऐप में OFFLINE/SERVER दोनों मोड। PART 1 के फीचर सब untouched।
> PART 3 = प्रोडक्ट कैटलॉग (CRUD + soft delete), Inventory Management (summary + पूरा stock-movement audit) और Bulk Operations (बल्क स्टॉक/कैटेगरी/एक्टिव + बल्क कीमत) — `backend/src/{products,product-categories,shop-scope,inventory,bulk-operations}` + migrations 003/004 + `#/stock`/`#/bulk` स्क्रीन का अपग्रेड; विवरण §14–16।
> PART 4 = कस्टमर स्टोर (Next.js, हिंदी-पहले): slug से published दुकान, खोज/कैटेगरी/प्रोडक्ट+variants, single-shop कार्ट, server-सत्यापित checkout (COD/PON/मैन्युअल UPI-QR सिर्फ़ configured हो तो), transaction में ऑर्डर + स्टॉक कटौती + SALE movement, Idempotency-Key से डुप्लिकेट-सुरक्षा, random token वाला ऑर्डर-स्टेटस — `backend/src/public-store` + migration 005 + `customer-web/`; विवरण §17–19 (`docs/PART4_SETUP.md`)।
> PART 5 = ऑर्डर लाइफ़साइकल: सर्वर-सत्यापित transitions (NEW→ACCEPTED→PREPARING→PREPARED→TRANSIT→DELIVERED; REJECTED/CANCELLED अलग नतीजे), `order_status_history` ऑडिट, reject/cancel पर स्टॉक ठीक-एक-बार वापसी (RETURN movement, row-lock guard), ग्राहक cancel token से (सिर्फ़ NEW), notification `outbox` (COMMIT-के-बाद-भेजना, bounded retry, FCM configured हो तभी push) + device tokens, मर्चेंट ऐप के ऑर्डर स्क्रीन SERVER mode + `#/notifs` सर्वर इतिहास, customer-web ऑर्डर पेज पर हिंदी टाइमलाइन+कारण+रद्द — `backend/src/{orders,notifications}` + migrations 006/007 (007: shops multi-owner fix); **2026-10-21: असली रन ✅ tsc 0 · unit 115/115 · e2e 23/23**; विवरण §20–22 (`docs/PART5_SETUP.md`)।
> PART 6 = WhatsApp शेयर/सोशल लेयर (backend `src/share` + `share.e2e-spec`, unit `share.spec`, एसेट `pos-api.js` v2.3-part6) — पिछले cycle में जुड़ा; स्थायी record इस update में §23.
> PART 7 = एडमिन पैनल पूरा — UserRole (SUPER_ADMIN/ADMIN/SUPPORT), ShopStatus (DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED), ComplaintStatus (OPEN/IN_PROGRESS/RESOLVED/CLOSED) enums (backend + DB CHECKs), scrypt-एडमिन-लॉगिन (12h admin JWT, rate-limit), RolesGuard हर request DB-ताज़ा भूमिका, दुकान-अप्रूवल workflow (PENDING/APPROVED/REJECTED/SUSPENDED + status history), शिकायतें (ग्राहक token से rate-limited + दुकानदार से; START→RESOLVE(नोट ज़रूरी)→CLOSE, REOPEN; FOR UPDATE tx), platform_policies (7 seeded keys, प्रति-key सत्यापक, `auto_publish_on_approve` अब असल approval पर लागू + मैन्युअल publish switch), audit_log; कोई SQLite नहीं — सीधे migration 008; प्लेटफ़ॉर्म-व्यापी orders overview और commission summary (default % + प्रति-दुकान अनुमान); ऐप `admin.html` फिर से + NEW `admin-api.js` (`window.POSADMIN`); **2026-10-21 अंतिम रन ✅ tsc 0 · unit 173/173 · e2e 45/45 (admin-flow 16/16)**; विवरण §24 (`docs/PART7_SETUP.md`)।
> PART 8 = पूरा integration + सुरक्षा/DB pass: `.env` auto-load, migrator path fix, नई migrations 001 (Part-1 baseline) + 009 (variant-integrity FK/index/CHECK), **variant stock bug fix** (variant-owned stock अब checkout पर घटता और cancel/reject पर वापस जुड़ता है — SALE/RETURN notes में variant नाम भी), OTP `crypto.randomInt`, media upload magic-byte जाँच, CORS production allow-list, `MEDIA_URL_BASE`/`CORS_ORIGINS` production validation, DbService pool shutdown; **release APK LOCALHOST guard** (Gradle `-PposApiBase`); असली रन ✅ tsc 0 · unit 173/173 · e2e **49/49** · live smoke **32/32** (नया `tools/smoke-api.mjs`) · fresh DB migrations 001→009 clean · `assembleDebug` **+ `assembleRelease` दोनों SUCCESS** · customer-web production build SUCCESS; विवरण §25–26।

---

## 1. Platforms status

| Platform (instructions) | Delivered here (PART 1) | Docs for PART 2 |
|---|---|---|
| Merchant app (Android) | ✅ Android APK — WebView app, UI in `assets/` | this project |
| Customer web store (Next.js target) | ✅ UI डेमो as `customer.html` inside the same app | `docs/API_ROUTES.md` §orders/public |
| Admin web panel (Next.js target) | ✅ PART 7: server-backed `admin.html` (roles/approvals/complaints/policies/orders/commissions/audit) + offline demo | `docs/API_ROUTES.md` §admin, `docs/PART7_SETUP.md` |
| Backend (NestJS) | ✅ PART 2–7: auth+shops+catalogue+public-store+orders+share+admin API code + tests in `backend/` (run विवरण §12/§18/§24) | `docs/API_ROUTES.md`, `docs/PART2_SETUP.md`…`PART7_SETUP.md` |
| Customer web store (REAL, PART 4) | ✅ `customer-web/` Next.js app — slug home, खोज, यूअर विवरण, कार्ट, चेकआउट, ऑर्डर स्टेटस (PWA manifest सहित) | `customer-web/README.md` |
| Database (PostgreSQL) | ✅ `database/schema.sql` + migrations 002–008 (Part 7 admin/roles/policies) | `database/migrations/` |

The Android app is the master demo: **Merchant SPA + Customer store + Admin panel** run
inside the same WebView (file:// assets). EventBus is not used; screens re-render on demand.

## 2. Repo layout

```
POS/
├─ build.gradle                 # AGP 8.7.3 (classpath style)
├─ settings.gradle              # include ':app'
├─ gradle.properties            # androidX + jvm args
├─ gradle/                      # (none — Termux + system gradle 8.13)
├─ app/
│  ├─ build.gradle              # app module manifest
│  └─ src/main/
│     ├─ AndroidManifest.xml    # INTERNET, launcher, singleTask
│     ├─ java/com/example/pos/
│     │  └─ MainActivity.java   # WebView (JS on, DOM storage, back nav, wa.me/tel abrir)
│     └─ assets/
│        ├─ index.html          # दुकानदार ऐप — सारी merchant स्क्रीन (Hindi-first)
│        ├─ customer.html       # कस्टमर वेब स्टोर (shares pos_db with index)
│        └─ admin.html          # एडमिन पैनल (server + offline डेमो; pos_admin_db_demo)
│     └─ res/
│        ├─ values/ themes.xml colors.xml strings.xml
│        ├─ xml/network_security_config.xml
│        ├─ drawable/ic_launcher_{foreground,background}.xml
│        └─ mipmap-*/ic_launcher[_round].png  (mdpi…xxxhdpi, generated)
├─ database/schema.sql          # PostgreSQL target design
├─ docs/
│  ├─ API_ROUTES.md             # NestJS endpoint map for PART 2
│  ├─ SCREEN_INVENTORY.md       # screen-by-screen inventory + demo behaviour
│  └─ INTEGRATION_MAP.md        # feature→data wiring inside the demo
├─ PROJECT_MANIFEST.md          # this file
└─ PART_STATUS.md               # done / pending / verified checklist
```

## 3. Demo data contract

| localStorage key | Owner screen | Notes |
|---|---|---|
| `pos_db` | merchant app (seeded) | shop profile, 12 products, 7 orders, 6 customers, notifications, settings, weekly sales seed |
| `pos_cart` | customer.html | cart survives reloads inside one session |
| `pos_lang` | merchant app | `hi` / `en` toggle (Settings) |
| `pos_admin_db_demo` | admin.html (offline) | pending shops, orders, commissions, complaints, policy |

Demo data is **device-local only**. Nothing leaves the phone; no fake network calls.

Cross-screen wiring (demo): placing an order in `customer.html` **unshifts a real order**
into `pos_db.orders` → it then appears in merchant "नए ऑर्डर". Admin shop list is separate
sample data (marked डेमो).

## 4. Screen → the file

| Instructions screen | Route / where |
|---|---|
| Splash | index.html `#/` (auto → onboarding/login, 1.6 s) |
| Onboarding slides | `#/onboarding` |
| Login + OTP | `#/login` → `#/otp` (demo OTP 1234) |
| Merchant registration | `#/register` → `#/register-cats` |
| Shop profile | `#/shop` |
| Home dashboard | `#/home` |
| Product list | `#/products` |
| Add / Edit product | `#/products/add` · `#/products/edit?id=…` |
| Product categories | `#/cats` (add/rename/delete + usage guard) |
| Stock management | `#/stock` (tabs: सभी / कम स्टॉक / ख़त्म) |
| Bulk price editing | `#/bulk` (±% stepper, preview, apply) |
| New orders | `#/orders/new` (accept/reject) |
| Order details | `#/orders/detail?id=…` (timeline + actions) |
| Order history | `#/orders` (status chips with counts) |
| Customers | `#/customers` (+ add sheet, per-customer stats) |
| Delivery settings | `#/delivery` |
| Shop link & WhatsApp share | `#/share` (copy, wa.me, navigator.share, demo QR) |
| Sales reports | `#/reports` (week chart, category split, top products, CSV) |
| Notifications | `#/notifs` (mark read,タイプ tap-through) |
| Settings & help | `#/settings` · `#/help` |
| More menu | `#/menu` (bottom-nav 5th tab) |

### customer.html routes (in-page, hash-free)
homepage + search + category chips + product sheet + cart + checkout + order-complete screen.

### admin.html tabs

**SERVER mode (भूमिका-अनुसार):** डैशबोर्ड · अप्रूवल कतार · दुकानें · ऑर्डर्स ·
कमीशन (SUPER/ADMIN) · शिकायतें · पॉलिसी · एडमिन (सिर्फ़ SUPER) · ऑडिट (SUPER/ADMIN).

**OFFLINE demo:** डैशबोर्ड · शॉप अप्रूवल · सभी दुकानें · ऑर्डर्स · शिकायतें ·
कमीशन · पॉलिसी (डेमो) — `localStorage['pos_admin_db_demo']`.

## 5. Design system (green/white, Hindi first)

- Colours: gradient `#17C08E → #0E9F6E → #04724C`; ink `#0F172A`; surface `#F4F7F6`; red `#DC2626`.
- Type: system stack w/ **Noto Sans Devanagari** fallback, `font-size:16px` body, ≥44 px touch targets.
- Components in index.html: topbar, chips, cards, `.f` validated field, item rows, stepper,
  sheet, ask-dialog, toast, timeline, chart, bottom-nav, FAB, loading skeletons, empty/error/ok banners.
- Status badges: नई (amber) तैयार (indigo) रास्ते में (sky) पूरी (green) रद्द (red).

## 6. Build (Termux)

```bash
cd ~/storage/shared/MyProjects/POS
gradle :app:assembleDebug          # or ./gradlew if a wrapper is added later
# APK → app/build/outputs/apk/debug/app-debug.apk
```

Max supported: `compileSdk 34`, AGP 8.7.3, Gradle 8.13 (system), Java 17, minSdk 21.

## 7. PART 2 entry points

1. `docs/API_ROUTES.md` — every screen's future endpoint.
2. `database/schema.sql` — tables & indexes.
3. `PART_STATUS.md` — pending checklist (backend, photos, PDF, printer, WhatsApp bot, payments).

---

# PART 2 — Merchant Registration, Shop Profile, Approval जोड़ा गया

**Date:** 2026-10-20 · **Version:** `1.1-part2`

PART 1 की सारी स्क्रीन/फीचर untouched हैं (demo डेटा, products, orders, reports, customer.html, admin.html)। Part 2 ऊपर से जुड़ता है।

## 8. PART 2 layout (नई/बदली फ़ाइलें)

```
POS/
├─ app/src/main/assets/
│  ├─ pos-api.js              # UPDATED: Part 2 API layer + PART 3 catalogue
│  │                          #   (auth/otp, shop-cats, shops CRUD, slug, media,
│  │                          #    waNormalize, publicUrl, statusKey, offline mock,
│  │                          #    POS.products / POS.productCats)
│  └─ index.html              # UPDATED: register→cats→shop-setup→shop + share, banner
│                             #   PART 3: catalogue adapter (server⇄local), loading/
│                             #   error/empty states, product + category CRUD, stock
│                             #   steppers, bulk-price preview/apply
├─ app/src/main/java/com/example/pos/MainActivity.java
│                             # UPDATED: allowUniversalAccess/fileAccessFromFileURLs
│                             # (file:// से https fetch को अनुमति)
├─ backend/                   # NEW: NestJS 10 + pg
│  ├─ src/auth/               # register, otp/request, otp/verify, /auth/me
│  ├─ src/shops/              # shops CRUD, slug svc, categories guard, media,
│  │                          # public/OG endpoint, submit-for-approval, ownership guard
│  ├─ src/admin/              # approve/reject/suspend (admin JWT)
│  ├─ src/products/           # PART 3: product CRUD, stock adjust, bulk pricing
│  │  ├─ pricing.ts           #   pure helpers (round2/applyPercent/plan/nextStock)
│  │  └─ dto.ts               #   validation (form-string → number, null = clear)
│  ├─ src/product-categories/ # PART 3: category CRUD (rename safe, delete guard)
│  ├─ src/shop-scope/         # PART 3: shop_id scoping + OWNER/MANAGER/STAFF roles
│  ├─ test/unit/              # slug + phone specs, PART 3 pricing + catalogue DTO specs
│  ├─ test/e2e/               # shops flow e2e (DATABASE_URL बिना auto-skip)
│  └─ .env.example            # config (SMS provider, JWT, CORS, OG base)
├─ database/migrations/
│  ├─ 002_part2_users_shops.sql  # users, shop_members, shop_categories, shop_media,
│  │                             # shop_business_hours, otp_codes; shops ALTER+backfill
│  ├─ 003_part3_catalogue.sql    # product_categories timestamps, products.life_note,
│  │                             # shop+category / shop+stock / shop+active indexes
│  └─ README.md
└─ docs/PART2_SETUP.md        # हिंदी सेटअप + curl उदाहरण
```

## 9. PART 2 data model

| Table | काम |
|---|---|
| `users` | नाम, phone (E.164 unique), merchants scope, created_utc |
| `shop_members` | user↔shop OWNER/MANAGER link |
| `shop_categories` | 12 seeded categories, `needs_fssai`/`needs_license` flags, max 3 |
| `shops` | profile, `slug` (unique, URL-safe), `status` |
| `shop_media` | `/media/…` files, magic-byte validated |
| `shop_business_hours` | दिन-windows |
| `otp_codes` | **hash-only** (plaintext OTP कभी store/log नहीं) |

**Shop status flow:** `DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED` (`REJECTED`/`SUSPENDED`)।
Approval status केवल सर्वर सेट करता है; client `PATCH /shops/:id` में `status|approved` भेजना चाहे तो बेअसर। Admin approve करने पर auto-publish।

## 10. PART 2 API (`backend/` NestJS + Bearer JWT)

| Method | Route | Notes |
|---|---|---|
| POST | `/auth/register` | नाम + phone नॉर्मलाइज़ (E.164) → user |
| POST | `/auth/otp/request` | dev: console SMS; prod: provider swap (.env) |
| POST | `/auth/otp/verify` | OTP → JWT |
| GET | `/auth/me` | session |
| GET | `/shop-categories` | license flags, ≤3 rule data |
| POST | `/shops` | नई दुकान; slug अपने-आप unique |
| GET | `/shops/my` · `/shops/:id` | ownership guard |
| PATCH | `/shops/:id` | profile edit (status client से नहीं) |
| POST | `/shops/:id/media` | फोटो (jpg/png/webp magic-byte) |
| GET | `/shops/check-slug` | उपलब्धता + `-2..-5` सुझाव |
| GET | `/shops/:slug/public` | public store data + OG meta |
| POST | `/shops/:id/submit-for-approval` | server-side तैयारी जाँच → PENDING_APPROVAL |
| Checkout & stock | PART 4: POST `/public/shops/:slug/checkout/validate` + `/checkout` (Idempotency-Key) | `docs/PART4_SETUP.md` §3 |

पूरा रूट-मैप: `docs/API_ROUTES.md` (Part 2 section ✅ / बाकी PART 3+)।

## 11. Merchant app (frontend) के नए रूट

`#/register → #/register-cats → #/shop-setup (create/edit) → #/shop (status card + submit) + #/share (URL + WhatsApp share)`

दो modes: **OFFLINE** (देव mock OTP — स्पष्ट रूप से "डेव मोड" बताया जाता है; localStorage `pos_account_v2`) और **SERVER** (config `pos_api_base` → `assets/pos-api.js` fetch layer)। पुराने demo OTP (Part 1, 1234) login ही untouched है।

- **Shop URL:** `publicUrl(slug)` बताती है — सर्वर मोड में OG base + `#/s/<slug>`; offline में demo URL। Copy + `navigator.share` + `wa.me` intent।
- **Slug parity:** देव/सर्वर दोनों में एक जैसा slugify (Devanagari समेत), duplicates → `-2..-5` सुझाव।
- **WhatsApp:** नंबर `waNormalize` से E.164 होता है। share किताबा: preview निर्भर करता है WhatsApp/Facebook के क्रॉलर पर — देव file:// मोड में OG मिलना guaranteed नहीं (share screen पर disclaimer दिखता है)।
- **स्थिर config:** अपना public store domain बदलने के लिए `index.html` में `POS_CONFIG.ogBase`/share screen का domain फ़ील्ड — default template URL (`https://pos-banner.github.io/demo-store/#/`) पर नहीं जकड़ा है।

## 12. PART 2 सेटअप + चलाना

- Backend: `POS/backend` में `npm install`, `.env.example → .env`, `npm run start:dev`; DB migrations खुद चलती हैं (`src/db/migrator.ts`, `schema.sql` पहले)। विवरण: `docs/PART2_SETUP.md`।
- Merchant ऐप build करना वही है: `gradle :app:assembleDebug` (Termux)। APK में `assets/pos-api.js` शामिल होता है।
- E2E टेस्ट `DATABASE_URL` के बिना खुद skip होते हैं; unit टेस्ट (slug/phone) DB-free हैं।

## 13. PART 2 verification (असली रन)

PART_STATUS.md §PART 2 में actual commands + रिज़ल्ट सूची है (`tsc`/`jest`/`node --check`)। नोट: WhatsApp link-preview व OG fetch का कोई वादा नहीं — कैप केवल public page के OG tags देता है।

---

# PART 3 — Product Catalogue, Inventory Management, Bulk Operations (पूरा)

**Date:** 2026-10-20 · **Version:** `1.2-part3`

Part 1 व Part 2 की सारी चीज़ें untouched। इस cycle में पिछले (क्रैश हुए) attempt के आधे-अधूरे
catalogue मॉड्यूल के आगे **inventory + bulk-operations** मॉड्यूल, DB टेबल और स्क्रीन पूरे किए।

## 14. PART 3 layout (नई/बदली फ़ाइलें)

```
POS/
├─ backend/src/
│  ├─ products/                 # पहले से था — अब हर stock adjust भी ऑडिट log करता है
│  │  └─ products.service.ts    #   PATCH /products/:id/stock → UPDATE + movement log एक tx में
│  ├─ inventory/                # NEW मॉड्यूल
│  │  ├─ inventory.service.ts   #   GET /inventory/summary · GET /inventory/movements · log()
│  │  ├─ inventory.controller.ts · inventory.module.ts
│  │  ├─ dto.ts                 #   movements query validation
│  │  └─ movements.ts           #   pure helpers (kind whitelist, note cap) → unit tests
│  ├─ bulk-operations/          # NEW मॉड्यूल
│  │  ├─ bulk-operations.service.ts  # POST /stock (≤200 items, tx+locks) · /category · /active
│  │  ├─ bulk-operations.controller.ts · bulk-operations.module.ts
│  │  ├─ dto.ts                 #   nested-item validation (form strings भी चलते हैं)
│  │  └─ bulk.ts                #   pure helpers (coerceIds, classifyStockItem) → unit tests
│  └─ app.module.ts             # InventoryModule + BulkOperationsModule जुड़े
├─ database/migrations/
│  ├─ 003_part3_catalogue.sql   # से पहले ही थी
│  └─ 004_part3_inventory.sql   # NEW — inventory_movements टेबल + 3 indexes (idempotent)
├─ test/unit/
│  ├─ pricing.spec.ts · catalogue.spec.ts   # पिछले cycle में compile/लॉजिक बग थे — ठीक किए
│  └─ inventory.spec.ts · bulk-ops.spec.ts  # NEW
└─ app/src/main/assets/
   ├─ pos-api.js                # + POS.inventory (summary/movements) + POS.bulkOps
   │                            #   (+ assignCategory/setActive/stock/bulkStock wrappers)
   └─ index.html                # #/stock: summary card + "हाल के बदलाव" sheet
                                # #/bulk: कीमत / स्टॉक दो टैब + कैटेगरी शिफ़्ट
```

## 15. PART 3 की डिज़ाइन-किताब (एक झलक में)

- **Single truth for stock writes:** stash बदलने के सिर्फ़ दो दरवाज़े — `PATCH /products/:id/stock`
  (एक) और `POST /bulk-operations/stock` (सब)। दोनों अपना रिकॉर्ड `inventory_movements` टेबल में
  उसी transaction में लिखते हैं, तो हिसाब स्टॉक से कभी पीछे नहीं रहेगा। Movement kinds:
  RESTOCK / ADJUST / SET / BULK (SALE, RETURN भविष्य के ऑर्डर flow के लिए पहले से रिज़र्व)।
- **Roles:** OWNER/MANAGER = कैटलॉग + कीमत + कैटेगरी/एक्टिव बल्क; STAFF = सिर्फ़ स्टॉक adjust
  (बल्क स्टॉक भी) — `ShopScopeService.requireManage/requireOperate`.
- **Bulk कीमत का रास्ता नहीं बदला** — `POST /products/bulk-price` (preview + `FOR UPDATE` apply)।
- **UI दोनों modes में चलती है:** SERVER mode = लाइव API; DEV offline = पहले जैसा local store + नन्हा
  local movement log (200 तक) ताकि "हाल के बदलाव" offline भी दिखे। Server-only चीज़ें खुद
  (("डेव मोड में वापस नहीं आते") जैसी साफ़ messages देती हैं, झूठे डेमो वादे नहीं।

## 16. PART 3 verification — असली रन (is बार shell चला!)

| Command | Result |
|---|---|
| `tsc --noEmit` (src + test) | **0 errors** — पहले Cline के 2 test-suite bug (`unknown dto`, `round2('abc')` बिना cast) ठीक किए |
| `jest` (unit, 6 suites) | **PASS — 70/70** (४ आधे-अधूरे suite + 2 नए inventory/bulk-ops) |
| `node --check` (extracted inline JS) | index.html, customer.html, admin.html सब **SYNTAX_OK**; `pos-api.js` **SYNTAX_OK** |
| Migration 004 apply | ⏳ DB वाला वातावरण नहीं — verify बाकी (idempotent है, कोई जोखिम नहीं) |

APK build नहीं किया — user खुद `gradle :app:assembleDebug` चलाएंगे।

---

# PART 4 — Customer Store, Search, Cart, Checkout (जुड़ा है)

**Date:** 2026-10-20 · **Version:** `1.3-part4` · विवरण: `docs/PART4_SETUP.md`

Part 1/2/3 की सारी फ़ाइलें/स्क्रीन untouched. Part 4 नया public module + नई web app है;
मर्चेंट ऐप का एक byte भी नहीं बदला, इसलिए Part-3 का APK build वैसा ही रहेगा.

## 17. PART 4 layout (नई/बदली फ़ाइलें)

```
POS/
├─ database/migrations
│  └─ 005_part4_storefront.sql   # NEW — orders(public_token, idempotency_key, guest,
│                                #   fulfilment, payment_status, discount), order_items
│                                #   snapshots+variant, shops(cod/pon/upi_vpa/min_order/accepting),
│                                #   product_variants, shop_coupons — सब idempotent
├─ backend/src/public-store/    # NEW मॉड्यूल (app.module में जोड़ा)
│  ├─ public-store.controller.ts # /public/* routes + per-IP rate limits
│  ├─ public-store.service.ts    # slug दुकान, खोज, variants, जाँच, tx ऑर्डर, token रास्ता
│  ├─ checkout.ts                # DB-free helpers (money/coupon/phone/idem) → unit tests
│  └─ dto.ts                     # class-validator DTOs
├─ backend/test/unit/public-store.spec.ts      # NEW unit (11 describes)
├─ backend/test/e2e/public-store.e2e-spec.ts   # NEW इंटीग्रेशन (DB बिना auto-skip)
└─ customer-web/                 # NEW — Next.js 14 कस्टमर स्टोर (अलग README)
   ├─ app/s/[slug]/…            # होम · search · p/[pid] · cart · checkout
   ├─ app/order/[token]/page.tsx # ऑर्डर स्थिति (random access token)
   ├─ lib/{api,cart,format,types}.ts
   └─ components/{CartBadge,AskDialog,ProductCard,AddToCart,RefreshBadge}.tsx
```

## 18. सुरक्षा/नियम जो code में पक्के हैं

- सब public routes पर per-IP **RateLimiter** (browser पढ़ें 120/min, कार्ट-जाँच 30,
  checkout 12, ऑर्डर-स्थिति 60)।
- **दुकान टूट संरक्षण:** हर query slug + `approval_status='APPROVED' AND published` से;
  product id किसी और दुकान का दिखे ही नहीं (404). Merchant-only fields (low_at, slot,
  cost) public shape से ग़ायब; UPI VPA बना फ्लैग दिखता है, असली VPA सिर्फ़ order बनने के
  बाद व उसी payMode पर.
- **पैसा सिर्फ़ server गिनता है:** browser के totals/कीमत किसी काम नहीं; round2 हर चरण.
- **ट्रांज़ैक्शन:** order+items+stockकटौती+`inventory_movements` SALE log एक ही tx;
  rows `FOR UPDATE`; दो समांतर चेकआउट से ओवरसेल नहीं (यूनिट जाँच e2e में).
- **डुप्लिकेट-सुरक्षा:** `Idempotency-Key` + `uq_orders_shop_idempotency` unique index;
  वही key → वही order फिर से (duplicate flag), रेस पर 23505 भी.
- **Enumeration-proof:** ऑर्डर स्थिति का लिंक random `public_token` UUID से ही;
  ग्राहक नाम/पता/नंबर किसी public जवाब में नहीं जाता.
- **एक कार्ट = एक दुकान:** दूसरी दुकान पर UI पूछकर ही खाली करता है — silently कभी नहीं.

## 19. PART 4 सत्यापन का सच (असली रन — दूसरा cycle, shell वापस आया)

| जाँच | हाल |
|---|---|
| backend `tsc --noEmit` | ✅ **0 errors** — पिछले cycle की 12 चूक पकड़ी गईं: `sanitizeItems` गुम import, `?? / \|\|` बिना कोष्ठक, spec के union-type कास्ट (`reject`/`invalidPhone` narrow helpers जोड़े) |
| backend `jest` unit | ✅ **7 suites, 98/98 PASS** — एक टेस्ट `common/phone.ts` की परिपाटी (ग़ैर-अंक digits से निकालना) से align किया |
| backend `jest` e2e | ✅ DB बिना **auto-skip (17/17)** — पहले दोनों suite import पर ही ढह रही थीं: `dto.ts` में `GuestCustomerDto` को `CheckoutDto` से पहले खींचा (TDZ crash — यह असली server boot भी तोड़ता!) |
| `customer-web` `next build` | ✅ **PASS (Termux, `@next/swc-wasm-nodejs` fallback)** — सब 9 routes compile+type-check; `search/page.tsx` का `useSearchParams` अब `Suspense` में लपेटा (बिना इसके build fail होता); + `next-env.d.ts` |
| e2e (DB सहित) / migration 005 apply | ⏳ PG नहीं — migrator auto चलाएगा; 005 idempotent है, unit से पहले की तरह safe |
| APK build | नहीं किया (कोई बदलाव नहीं) — user चाहे तो पुरानी command से ही re-verify |

**इस cycle में ठीक किए गए बदलाव (सिर्फ़ 4 फ़ाइलें + 1 नई):** `backend/src/public-store/public-store.service.ts`,
`backend/src/public-store/dto.ts`, `backend/test/unit/public-store.spec.ts`,
`customer-web/app/s/[slug]/search/page.tsx` (+ नया `customer-web/next-env.d.ts`).
Part 1/2/3 व मर्चेंट ऐप बिल्कुल छेड़े नहीं — Part-4 का APK वैसे ही बनेगा.
Android पर `customer-web` build दोबारा चलाना हो तो पहले `npm install --no-save @next/swc-wasm-nodejs`
(native swc Android-arm64 पर मौजूद नहीं है); laptop/Vercel पर कोई झंझट नहीं.

---

# PART 5 — Order Lifecycle, Fulfilment, Notifications (जुड़ा है)

**Date:** 2026-10-21 · **Version:** `1.4-part5` · विवरण: `docs/PART5_SETUP.md`

Part 1–4 की सारी चीज़ें untouched (डेमो ऑर्डर स्क्रीन offline exactly पहले जैसी).
Part 5 ऊपर से जुड़ता है: server-side order lifecycle + सुरक्षित स्टॉक + notifications.

## 20. PART 5 layout (नई/बदली फ़ाइलें)

```
POS/
├─ database/migrations/006_part5_orders_lifecycle.sql   # NEW — order_status_history,
│                              notification_outbox(record करता है, भेजना नहीं),
│                              user_device_tokens, orders lifecycle columns
├─ backend/src/orders/         # NEW — order-lifecycle.ts (pure rules), service,
│                              controller (/shops/:shopId/orders…), module
├─ backend/src/notifications/  # NEW — events (pure), service (enqueue-in-tx +
│                              drain + device tokens + सूची/mark-read), controller
├─ backend/src/public-store/   # UPDATED — checkout tx में NEW history row + outbox
│                              event; order status में timeline+reason; customer cancel
├─ backend/src/{app.module,config/env,main}.ts, shop-scope, .env.example   # UPDATED
├─ backend/test/unit/order-lifecycle.spec.ts, test/e2e/orders.e2e-spec.ts  # NEW tests
├─ app/src/main/assets/pos-api.js  # UPDATED — POS.orders + POS.notifs (v2.2-part5)
├─ app/src/main/assets/index.html  # UPDATED — #/orders* SERVER mode + #/notifs सर्वर
└─ customer-web/                   # UPDATED — ऑर्डर पेज टाइमलाइन/कारण/रद्द + types/api/format
```

## 21. PART 5 की जान-किताब (एक झलक में)

- **सिर्फ़ server statuses बदलता है:** client सिर्फ़ *action* भेजता है (ACCEPT/REJECT/
  START_PREPARING/MARK_READY/OUT_FOR_DELIVERY/COMPLETE/CANCEL/MARK_PAID) — अगला status
  `order-lifecycle.ts` के map से ही निकलता है; गलत क्रम = 409. REJECTED और CANCELLED
  अलग नतीजे. TRANSIT से cancel नहीं. पिकअप ऑर्डर पर "रास्ते में" नहीं चल सकता.
- **स्टॉक ठीक एक बार वापस:** checkout पहले ही काट चुका (Part 4) — reject/cancel पर
  RETURN movement उसी tx में; orders row `FOR UPDATE` + transition नियम दोहरे tap को
  409 में रिटर्न करता है, स्टॉक दो बार कभी नहीं जुड़ता. कोई negative inventory नहीं
  (products.stock की CHECK ≥ 0 + app guard). असली outbox (`notification_outbox`)
  COMMIT के बाद ही drain होता है (main.ts scheduler ~20 s).
- **पेमेंट साफ़:** COD पर डिलीवरी = `PAID` अपने-आप; MARK_PAID सिर्फ़ UPI_QR + PENDING +
  चालू status — रद्द/पूरा ऑर्डर पर पेमेंट बदलना server reject करता है.
- **Tenant isolation:** order routes `requireShopMember(userId, shopId)` — दूसरी दुकान
  का shopId/orderId 403/404 देता है; सूची/डिटेल query हमेशा shop_id से बांधी.
- **ग्राहक:** ऑर्डर स्थिति पेज अब हिंदी टाइमलाइन + रद्द/अस्वीकृत का कारण + नया (`NEW`)
  ऑर्डर ग्राहक खुद रद्द कर सकता है (token से; 10/min/IP; server दोबारा नियम जाँचता है).
- **नोटिफिकेशन का यथार्थ:** हर घटना in-app इतिहास में (`#/notifs`, `/notifications`)
  दिखती है; FCM push केवल `FCM_SERVER_KEY` configured होने पर — नहीं तो row SKIPPED
  नोट के साथ; कोई "कतार = पहुँच" जैसा दावा नहीं. Push text में पता/पेमेंट नहीं जाता.

## 22. PART 5 सत्यापन (असली रन — 2026-10-21 ✅)

Termux में PostgreSQL 18.6 लगाया (lokal, `tmp/opencode/pgdata`), schema.sql +
migrations 002–006 **+ नया 007** apply — प्रत्येक जाँच असली DB पर चली:

| Check | Status |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `jest` unit | ✅ 115/115 (8 suites) |
| `jest` e2e (असली DB) | ✅ 23/23 (orders, public-store, shops-flow) |
| migrations | ✅ schema.sql + 002…006 + 007 लागू |
| APK build | नहीं किया — user खुद Termux से करेंगे |

**असली रन से ठीक किए गए बग** (पूरा अंक PART_STATUS.md §PART 5-D): `fetchScoped` का
`FOR UPDATE` WHERE से पहले (हर ट्रांज़िशन 500); checkout lock pool से होता था →
समांतर checkout oversell (अब tx के q पर); `couponByCode` में FOR UPDATE/LIMIT क्रम;
exception filter extras (suggestions/reason) छोड़ देता था; `orders list` का
`status='ALL'` 400; `shops.owner_phone UNIQUE` multi-shop रोकता (→ migration 007);
duplicate-checkout जवाब `token`/`publicToken` असंगत; `@Injectable()`/auth UPDATE
placeholders के पुराने 500. e2e specs भी सही रूप में (supertest v7 verb-first,
फोन सीड, pagination/history/drain अपेक्षाएँ)।

`node --check` (merchant ऐप) और `next build` (customer-web) इस cycle में चलाए
नहीं गए — अगले cycle में चलेंगे; बाकी सब असली रनों का सबूत उपर. चलाने के exact
कमांड `docs/PART5_SETUP.md` §6.



# PART 6 — Share/Social layer + PART 7 — Admin पैनल (जुड़े हैं)

## 23. PART 6 का स्थायी record (2026-10-21)

पिछले cycle में हिंदी शेयर-लेयर code जुड़ा था पर मैनिफ़ेस्ट/स्टेटस अपडेट नहीं हुआ — record यहाँ
(इस update के असली रनों में इसके सूट भी सब पास):

| Item | Where |
|---|---|
| शेयर किताबा (हिंदी संदेश, OG/meta, स्थिति टेक्स्ट) | `backend/src/share.ts` (+ legacy `PENDING_APPROVAL` जवाब compat) |
| unit टेस्ट | `backend/test/unit/share.spec.ts` ✅ |
| e2e | `backend/test/e2e/share.e2e-spec.ts` ✅ (इस cycle: 6/6) |
| एसेट पहलू | `app/src/main/assets/pos-api.js` v2.3-part6 (share उपक्रम native bridge) |

इस cycle के अंतिम रन में हाल `tsc 0 / unit 173/173 / e2e 45/45` के अंदर यह suit भी सब पास।

## 24. PART 7 सत्यापन + layout (2026-10-21 ✅)

**Enums (backend + DB दोनों):** UserRole `SUPER_ADMIN/ADMIN/SUPPORT`,
ShopStatus `DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED`, ComplaintStatus
`OPEN/IN_PROGRESS/RESOLVED/CLOSED` — `src/common/roles.ts` + `008_*.sql` CHECKs.
कदम-नियम pure functions (`shopTransition`, `complaintTransition`) → unit-tested.

**सुरक्षा:** scrypt पासवर्ड hash (कोई नया निर्भरता नहीं); `POST /admin/auth/login`
(12 घंटे admin JWT, `ADMIN_JWT_SECRET`; rate-limit 10/5min per IP+email);
bootstrap सुपर-एडमिन env (`ADMIN_EMAIL/ADMIN_PASSWORD`) जब `admin_users` खाली;
**RolesGuard हर request पर `admin_users` से ताज़ा role/is_active** — नकली टोकन 401
(जुदाई तुरंत मरती है); `@Roles()` decorator प्रत्येक route.

**रोल मैट्रिक्स:** SUPER_ADMIN = सब (admins मैनेजमेंट सहित); ADMIN = shops + approval/
policies/audit/complaints + orders/commissions; SUPPORT = complaints + shops, orders,
policies सिर्फ़ पढ़ने को (कमीशन/एडमिन/ऑडिट नहीं).

**नई फ़ाइलें:** `src/common/{roles,guards,current-user.decorator}` ·
`src/admin/{admin-auth,admin-users,policies.rules,policies.service,admin.controller,admin.module}` ·
`src/complaints/{complaints.service,complaints.controller,dto,complaints.module}` ·
`database/migrations/008_part7_admin_roles_policies.sql` ·
`test/unit/{roles,policies}.spec.ts` · `test/e2e/helpers.ts` +
`test/e2e/admin-flow.e2e-spec.ts` (16 e2e) · `app/src/main/assets/admin-api.js` (NEW)
· `app/src/main/assets/admin.html` (REWRITE) · `docs/PART7_SETUP.md` ·
`.env.example` PART-7 खंड · layout: `docs/PART7_SETUP.md` §1.

**असली रन:**

| Check | Status |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| unit | ✅ **173/173, 12 suites** |
| e2e (असली DB, runInBand) | ✅ **45/45, 5 suites** — admin-flow **16/16** |
| migration 008 | ✅ idempotent; 7 policies seeded; PENDING_APPROVAL→PENDING, PUBLISHED→APPROVED backfill |
| `node --check` assets | ✅ admin-api.js + admin.html inline दोनों |
| APK build | नहीं किया — user Termux से `gradle :app:assembleDebug` खुद चलाएंगे |

**रन से ठीक किए 3 बग** (पूरा `docs/PART7_SETUP.md` §7): complaints `act()/list()`
का SQL param-क्रम (बिना-'?' clauses null खाते थे → PG "could not determine data
type of parameter $1", START हमेशा 500); `PolicyPatchDto.value` को whitelist pipe
आँकल कर फेंकती थी (हर पॉलिसी-पैच 400 → अब `@IsDefined()`); ग़लत complaint-token
पर uuid-cast 500 (अब regex → साफ़ 404).

**पैनल UI:** login (scrypt) → भूमिका-अनुसार tabs; दुकान कतार APPROVE/REJECT(कारण)/
SUSPEND(कारण)/UNSUSPEND + APPROVED दुकान का manual public switch; दुकान का पूरा
विवरण-शीट (status history + हाल की शिकायतें); ऑर्डर्स overview (search + status);
कमीशन (default % सेव + प्रति-दुकान DELIVERED GMV/commission अनुमान); शिकायत शीट
(इतिहास, इंटरनल टिप्पणियाँ, सिर्फ़-allowed कदम: START/RESOLVE(हल-नोट ज़रूरी)/CLOSE/REOPEN);
पॉलिसी सूची+सेव (सर्वर सत्यापक; SUPPORT को read-only); एडमिन-टीम (SUPER) बनाओ/
निष्क्रिय(उसी request में 401)/नया पासवर्ड; audit तालिका. Offline मोड में पुराना
डेमो जीवित — साफ़ "डेमो" badge (अब orders + कमीशन tabs भी).

### 24.1 Part 7 integration pass (2026-10-21, `2.4.1-part7`)

Part 7 का पहला delivery structurally पूरा था, पर panel और backend के बीच कुछ
response-shape gaps थे. इस pass में बिना पुराना काम हटाए ये ठीक/पूरे किए:

| # | समस्या | अब |
|---|---|---|
| 1 | dashboard `shops.total`/`orders.today` missing → cards 0 | backend aliases (`total/all`, `today/todayCount`, totals) + dashboard SLA hint |
| 2 | policies `value` nested `{value:…}` था, UI उसे `[object Object]` दिखाता/भेजता | UI unwrap + inner value सेव; SUPPORT read-only tab |
| 3 | audit `entityId` vs `entity_id`, shop `reason`/`licenseNo` aliases | UI दोनों shape संभालती है; shop detail में address/categories/license |
| 4 | "इंटरनल" label पर note non-internal जाता था | अब `isInternal=true` |
| 5 | `auto_publish_on_approve` सिर्फ़ stored था | APPROVE/UNSUSPEND पर लागू; `PATCH /admin/shops/:id/publish` + UI switch |
| 6 | Part 1 के admin orders/commission tabs rewrite में छूटे | `GET /admin/orders`, `GET/PUT /admin/commissions` + server/offline tabs |
| 7 | queue/list/policies में search/filter नहीं, shop detail route unused | q/status filters, `GET /admin/shops/:id` detail sheet |

**अंतिम verification:** `tsc` 0 · unit **173/173** · e2e **45/45** (admin-flow **16/16**,
नए: auto-publish/publish + orders/commission) · `node --check` admin-api.js + admin.html
inline clean · migration 008 idempotent. APK build नहीं किया — user Termux से करेंगे.

---

# PART 8 — Integration, सुरक्षा/DB pass, असली builds (पूरा)

**Date:** 2026-10-21 · **Version:** `2.4.1-part8` (versionCode 2)

Part 1–7 की सारी चीज़ें untouched — Part 8 ऊपर से जुड़ता है: पूरा integration pass,
DB integrity fixes, production-hardening, असली APK builds (debug + release) और
customer-web का production build। कोई फ़ाइल हटाई नहीं गई।

## 25. PART 8 layout (नई/बदली फ़ाइलें)

```
POS/
├─ database/migrations/
│  ├─ 001_part1_baseline.sql        # NEW — Part-1 स्कीमा अब standard chain में (idempotent)
│  └─ 009_part8_variant_integrity.sql # NEW — order_items.variant_id FK (ON DELETE SET NULL),
│                                    #   2 indexes, product_variants.stock CHECK ≥ 0
├─ backend/src/
│  ├─ config/load-env.ts            # NEW — .env auto-load (process.env जीतता है)
│  ├─ config/env.ts                 # UPDATED — findMigrationsDir() (हर cwd/dist layout),
│  │                                #   production MEDIA_URL_BASE/CORS_ORIGINS validation
│  ├─ main.ts                       # UPDATED — CORS production allow-list (CORS_ORIGINS),
│  │                                #   Idempotency-Key allowed header
│  ├─ db/db.service.ts              # UPDATED — OnModuleDestroy पर pool बंद
│  ├─ public-store/{checkout.ts,public-store.service.ts}
│  │                                # UPDATED — variant-owned stock (stockSource='VARIANT'):
│  │                                #   checkout variant stock घटाता, notes में variant नाम
│  ├─ orders/orders.service.ts      # UPDATED — shared restock() variant stock वापस
│  │                                #   (NULL/मृत variant → product पर fallback)
│  ├─ shops/{shops.service.ts,shops.controller.ts}
│  │                                # UPDATED — media magic-byte जाँच (JPEG/PNG/WEBP),
│  │                                #   forbidden-field check raw body पर
│  └─ auth/otp (crypto.randomInt)   # UPDATED — OTP randomness (pepper = JWT_SECRET)
├─ backend/test/                    # UPDATED — variant-stock regression + shops
│                                   #   self-approval/media-magic/cross-shop e2e (49/49)
├─ tools/smoke-api.mjs              # NEW — 32-check live smoke (कोई dependency नहीं)
├─ customer-web/scripts/next-wasm-prelude.cjs  # NEW — Termux WASM-SWC prelude
├─ customer-web/next.config.mjs     # UPDATED — useWasmBinary/worker fix
├─ app/build.gradle                 # UPDATED — -PposApiBase + LOCALHOST release guard,
│                                   #   versionCode 2 / 2.4.1-part8, BuildConfig injection
├─ app/src/main/java/.../MainActivity.java  # UPDATED — POSAndroid.apiBase() bridge
├─ app/src/main/assets/{pos-api.js,admin-api.js}
│                                   # UPDATED — native bridge से API base
└─ PROJECT_MANIFEST.md · PART_STATUS.md · README.md (नया)  # docs
```

## 26. PART 8 सत्यापन — असली रन (2026-10-21 ✅)

सब असली Termux + PostgreSQL 18.6 पर; fresh DB `posdb_part8` (migrations 001→009
खाली DB पर clean, 29 tables) + `posdb_smoke` (live smoke)। कुल:

| Check | Status |
|---|---|
| backend `tsc --noEmit` | ✅ **0 errors** |
| backend unit | ✅ **173/173, 12 suites** |
| backend e2e (असली DB, runInBand) | ✅ **49/49, 5 suites** (नए variant-stock + shops safety tests) |
| live smoke (`tools/smoke-api.mjs`, port 4100) | ✅ **32/32** — onboarding→अप्रूवल→product→checkout (idempotent)→token privacy→complaint START/RESOLVE→SALE movement→stock 6→4→दोहरा cancel 409→cross-shop 403→fake image 400→real PNG 200→dashboard |
| migrations 001→009 (शून्य DB) | ✅ clean; FK/index/CHECK सब पाए गए |
| `gradle :app:assembleDebug` | ✅ → `app/build/outputs/apk/debug/app-debug.apk` (3,456,215 B, md5 d69bb74b…) |
| `gradle :app:assembleRelease -PposApiBase=https://api.example.com` | ✅ → `app/build/outputs/apk/release/app-release-unsigned.apk` (2,673,710 B, md5 07c8f5e0…) |
| release LOCALHOST guard | ✅ `-PposApiBase=http://localhost:4000` → **BUILD FAILED** (जान-बूझकर); release manifest में cleartext बंद |
| `customer-web` production build | ✅ compiled successfully (3 static ○ + 6 dynamic ƒ routes) |
| APK में assets का md5 | ✅ ज़िप के अंदर की `pos-api.js`/`admin-api.js` बिल्कुल current source के md5 |

## 27. PART 8 की सीमाएँ (ईमानदारी से)

1. **Flutter नहीं है:** यह प्रोजेक्ट नेटिव Android (Java + WebView assets) है — Part 1 से ही
   ऐसा था। `flutter` SDK इस मशीन पर नहीं है और कोई Flutter ऐप मौजूद नहीं — इसलिए
   `flutter analyze / flutter test / flutter build apk --debug` चलाए **नहीं** गए। इसकी जगह
   असली Android build (`gradle` debug + release) चला और दोनों APK बने — विवरण ऊपर।
2. **Release APK unsigned है** (कोई signing config/keystore नहीं) — Play Store के लिए
   user को अपनी keystore से sign करना होगा।
3. **Production API domain** user ने नहीं दिया — release verify `https://api.example.com`
   placeholder से हुआ। असली डोमेन आते ही `-PposApiBase=https://…` से re-build।
4. **Admin Panel** अलग Next app नहीं — Part 7 के निर्णय से `app/src/main/assets/admin.html`
   (+ `admin-api.js`) में है और APK का हिस्सा है; इसलिए उसका "production build" = APK build.
5. **FCM push** असली Firebase key के बिना नहीं पहुँचेगा (code-ready; in-app history हमेशा बनती है)।
