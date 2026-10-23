# POS — PART_STATUS

Updated: 2026-10-21 · Version `2.4.1-part8` · (PART 8 integration + सुरक्षा/DB pass + असली APK/web builds — पूरा रन-रिकॉर्ड आख़िरी §PART 8 में)
## ✅ Completed & verified (PART 1)

| # | Item | Where | Behaviour check |
|---|---|---|---|
| 1 | Android project skeleton fixed | `build.gradle`, `app/build.gradle` | resValue bug removed; AGP 8.7.3 + namespace |
| 2 | INTERNET permission + manifest | `AndroidManifest.xml` | singleTask, hardware accel, theme |
| 3 | WebView MainActivity (JS, DOM storage, external links) | `MainActivity.java` | wa.me / tel: open externally; back handled |
| 4 | Premium adaptive icon, no text | `drawable/ic_launcher_*`, `mipmap-anydpi-v26`, PNGs mdpi–xxxhdpi | gradient + storefront glyph, safe zone |
| 5 | Merchant app: 21+ screens & nav | `assets/index.html` | hash router, bottom nav, FAB, guards |
| 6 | Login/OTP flow (demo gate) | `#/login`, `#/otp` | validation, OTP 4-box, error states |
| 7 | Registration + shop categories | `#/register`, `#/register-cats` | multi-select, finish → home |
| 8 | Home dashboard | `#/home` | stats, quick tiles, low-stock banner, recents |
| 9 | Product CRUD + validation | `#/products`, add/edit | create/edit/delete with toasts |
| 10 | Product categories CRUD | `#/cats` | delete guard when in use |
| 11 | Stock mgmt | `#/stock` | ± steppers persist to `pos_db` |
| 12 | Bulk price edit | `#/bulk` | preview + apply, per/category |
| 13 | Orders: new/detail/history | `#/orders*` | accept/reject/ready/transit/delivered |
| 14 | WhatsApp deep-link to customer | order detail | wa.me text prefill |
| 15 | Customers list + add + stats | `#/customers` | validation, per-customer sheet |
| 16 | Delivery settings | `#/delivery` | fee/free/radius/estimate; fee logic shared |
| 17 | Share shop link (wa.me, copy, QR stub) | `#/share` | real wa.me URL + navigator.share |
| 18 | Sales reports (chart, mix, CSV) | `#/reports` | real CSV blob download |
| 19 | Notifications | `#/notifs` | unread dot, mark-all, tap-through |
| 20 | Settings incl. language टॉगल + logout | `#/settings` | hi/en live switch |
| 21 | Help & FAQ | `#/help` | accordion, call/WhatsApp |
| 22 | Customer web store UI | `customer.html` | search, chips, cart, checkout, order-complete |
| 23 | Customer order → merchant app | `customer.html` writes `pos_db.orders` | shows in नए ऑर्डर |
| 24 | Admin panel UI demo | `admin.html` | 7 demo tabs (approve/reject, commission, complaints…); PART 7 में server-backed rewrite — नीचे |
| 25 | PostgreSQL schema scaffold | `database/schema.sql` | shops/orders/products/admin tables |
| 26 | PROJECT_MANIFEST + PART_STATUS | root | this + manifest |
| 27 | API route map for PART 2 | `docs/API_ROUTES.md` | every screen's endpoint |
| 28 | Screen inventory | `docs/SCREEN_INVENTORY.md` | route map + demo behaviour |
| 29 | Syntax verified | tmp node --check | index/customer/admin JS clean |

## ✅ Completed & verified (PART 2) — 2026-10-20

### A. Backend code (real runs नीचे §C में)

| # | Item | Where | Notes |
|---|---|---|---|
| B1 | NestJS 10 backend + pg, raw-SQL migrator | `backend/src/`, `backend/src/db/migrator.ts` | Part 1 के `database/schema.sql` के बाद `002_part2_users_shops.sql` खुद चलता है; ALTER idempotent + legacy status backfill |
| B2 | POST /auth/register, /auth/otp/request, /auth/otp/verify, GET /auth/me | `backend/src/auth/` | OTP hash-only (`otp_codes`), TTL+attempts limits, SMS provider swap (.env), dev = console provider |
| B3 | Shops API | `backend/src/shops/` | POST /shops · GET /shops/my · GET /shops/:id · PATCH /shops/:id (ownership guard; client से approval status बनता ही नहीं) |
| B4 | Slug service | `backend/src/shops/slug.service.ts` + `GET /shops/check-slug` | unique पक्का, `-2..-5` suggestions, Devanagari slugify parity (unit-tested) |
| B5 | GET /shop-categories | seeded 12, `needs_fssai`/`needs_license` flags | ≤3 चुनाव server भी जाँचता है |
| B6 | POST /shops/:id/media | magic-byte check (jpg/png/webp), `/media` static | GET /shops/:slug/public OG meta के साथ |
| B7 | POST /shops/:id/submit-for-approval | DRAFT→PENDING_APPROVAL | सर्वर-साइड completeness guard |
| B8 | Admin approve/reject/suspend | `PATCH /admin/shops/:id/status` | approve → PUBLISHED (auto) — अलग admin JWT |
| B9 | WhatsApp/E.164 normalize | `backend/src/common/phone.ts` | digits+`+` formats, log में masked |
| B10 | e2e auto-skip + strict env at runtime | `src/config/env.ts`, `src/main.ts` | बिना DATABASE_URL jest skip; असली serve पहले .env पक्का करता है |

### B. Merchant app (frontend) — code changes verified by reading + syntax check

| # | Item | Where |
|---|---|---|
| F1 | `window.POS` API layer (auth/shops/slug/media/publicUrl/waNormalize/statusKey) | `assets/pos-api.js` (NEW, `node --check` clean) |
| F2 | register → cats → shop-setup (create+edit) → shop (status card + submit) | `assets/index.html` |
| F3 | #/share: server-configurable डोमेन, slug बदलें, OG preview + disclaimer | `assets/index.html` |
| F4 | Home status banner + settings कनेक्शन rows | `assets/index.html` |
| F5 | MainActivity fetch flags (file://→https) | `MainActivity.java` L65-66 |
| F6 | DEV offline mock OTP साफ़-साफ़ "DEV" लेबल, कोई गुप्त वादा नहीं | `pos-api.js` + screens |

### C. असली रन (honest results — जो चला वही लिखा)

| Command | Result |
|---|---|
| `npm install` (backend) | दो रन: पहला **FAILED** — Android shared storage (FUSE) पर `.bin` सिम्लिंक नहीं बनते (`npm error The operation was rejected by your operating system`, build:link चरण)। दूसरा `--bin-links=false` के साथ **पास** (654 packages) |
| `tsc --noEmit` (backend, सब src+test) | **0 errors** — आगे 4 गलतियाँ ठीक कीं: `../guards`/`../../common/slug` गलत import paths, `auth.service` null-typosafety, `@types/jest` + `@nestjs/testing` जोड़े |
| `jest` (unit) | **PASS — 2 suites, 13/13 tests** (slugify parity, phone E.164) |
| `jest` (e2e, बिना PG) | **auto-skip — 1 suite skipped, 5 tests skipped** (DATABASE_URL नहीं); import-crash `env.ts` से हटाया — जाँच अब `main.ts` start पर |
| `node --check` inline JS | `index.html`, `customer.html`, `admin.html` सब **SYNTAX_OK** |
| `node --check assets/pos-api.js` | **SYNTAX_OK** |

⚠️ **डिसक्लेमर:** e2e flows (register→shop→approval) को PostgreSQL के बिना चला नहीं — इसलिए "API चल रहा है" वादा नहीं करते; कोड + types + unit तक सत्यापित है। Termux में PG लगाकर `npm run test:e2e` चलाया जा सकता है। APK इस cycle में build नहीं किया (user खुद Termux से करेंगे)।

## ✅ Completed (PART 3) — product catalogue, inventory, bulk pricing

> **सत्यापन का हाल (2026-10-20 दूसरा cycle):** पिछली शेल बहाल (shell) चल गई — पिछली cycle के
> ⏳ "नहीं चला" सारे checks अब असली रन करके verified (नीचे §C)। इस cycle में उसी attempt के
> टूटे test-suites भी ठीक हुए और **inventory + bulk-operations** मॉड्यूल पूरे जुड़े (§D/§E)।

### A. Backend code — catalogue (पिछले cycle का, अब verified)

| # | Item | Where | Notes |
|---|---|---|---|
| C1 | Product CRUD + soft delete | `backend/src/products/` | `POST/GET/PATCH/DELETE /products`; delete → `is_active=false` (order history सुरक्षित) |
| C2 | Stock adjustment | `backend/src/products/products.service.ts` | `PATCH /products/:id/stock` — `{delta}` / `{stock}` / `{lowAt}`; stock कभी negative नहीं; अब **movement log भी** (§D) |
| C3 | Bulk pricing (preview + apply) | `backend/src/products/products.service.ts` + `pricing.ts` | `POST /products/bulk-price`; preview कुछ नहीं लिखता, apply transaction + `FOR UPDATE` + `minPrice` floor |
| C4 | Product categories CRUD | `backend/src/product-categories/` | rename सुरक्षित; delete-while-in-use → 409 |
| C5 | Shop scoping + roles | `backend/src/shop-scope/shop-scope.service.ts` | हर query `shop_id` से filtered; OWNER/MANAGER = कैटलॉग + कीमत, STAFF = सिर्फ़ stock |
| C6 | DTO validation | `backend/src/products/dto.ts` | form-string → number; `mrp: null`/`brand: null` → क्षेत्र खाली; limits |
| C7 | Pure pricing helpers | `backend/src/products/pricing.ts` | DB-free → unit tests (§C में पास) |
| C8 | Migration 003 | `database/migrations/003_part3_catalogue.sql` | timestamps, `life_note`, indexes; idempotent |
| C9 | DB transaction safety | `backend/src/db/db.service.ts` | ROLLBACK fail पर मूल error masked नहीं |
| C10 | Duplicate category → 409 | `backend/src/product-categories/product-categories.service.ts` | PG `23505` → 409 |

### D. Backend code — Inventory Management (NEW मॉड्यूल, इसी cycle में)

| # | Item | Where | Notes |
|---|---|---|---|
| D1 | `inventory_movements` टेबल | `database/migrations/004_part3_inventory.sql` | id, shop, product, kind (RESTOCK/ADJUST/SET/BULK/SALE/RETURN), delta, stock_before/after, note, actor_id (users) , created_at; 3 indexes; idempotent; migrator auto चलाता है |
| D2 | GET `/inventory/summary` | `backend/src/inventory/inventory.service.ts` | `{ products, inactive, low, out, alert, units, value }` — SQL FILTER में ही गना; हर भूमिका देख सकती है |
| D3 | GET `/inventory/movements` | वही | `?productId=&limit=` (limit 1–100, default 30); product नाम + actor नाम जुड़े |
| D4 | हर stock देवरवज़े का ऑडिट | `products.service.ts` adjustStock + `POST /bulk-operations/stock` | UPDATE और movement रो एक ही `db.tx` में — हिसाब से डेटा कभी असंगत नहीं |
| D5 | Pure helpers | `backend/src/inventory/movements.ts` | `MOVEMENT_KINDS` whitelist + `normalizeKind` (अनजान kind → 'ADJUST') + `sanitizeNote` (140 cap) — unit-tested |
| D6 | `InventoryService.log()` export | `inventory.module.ts` | products (single) व bulk-operations दोनों modules इसे आपनं tx के अंदर बुलाते हैं |

### E. Backend code — Bulk Operations (NEW मॉड्यूल)

| # | Item | Where | Notes |
|---|---|---|---|
| E1 | POST `/bulk-operations/stock` | `backend/src/bulk-operations/bulk-operations.service.ts` | ≤200 items एक कॉल में; transaction + `FOR UPDATE` row locks; हर लागू item का movement log; जवाब `{ updated, unchanged, missing, changes }`; **STAFF चला सकता है** (requireOperate) |
| E2 | POST `/bulk-operations/category` | वही | ids की सूची एक कैटेगरी में (id या नाम; अनजान नाम बन जाता है) — requireManage |
| E3 | POST `/bulk-operations/active` | वही | बल्क soft-delete (`active:false`) / restore (`true`); no-op ids गिनती से बाहर — requireManage |
| E4 | DTO (nested items) | `backend/src/bulk-operations/dto.ts` | `@ValidateNested` items; form-strings → numbers; ArrayMaxSize(200) |
| E5 | Pure helpers | `backend/src/bulk-operations/bulk.ts` | `coerceIds` (dedupe/junk-drop/cap) + `classifyStockItem` (updated/unchanged/missing) — unit-tested |
| E6 | बल्क कीमत का single पथ | (यूँ ही) `POST /products/bulk-price` | रूट हटाया/दोहराया नहीं — एक ही लिखावट रास्ता रहा |

### B. Merchant app (frontend) — catalogue, inventory & bulk screens

| # | Item | Where | Notes |
|---|---|---|---|
| F7 | `POS.products` / `POS.productCats` / `POS.inventory` / `POS.bulkOps` | `assets/pos-api.js` | सारे PART 3 endpoints के wrappers (v2.1-part3) |
| F8 | `catalogue` adapter (server ⇄ local) | `assets/index.html` | SERVER → लाइव API; DEV offline → Part-1 `pos_db` (डेमो टूटा नहीं) |
| F9 | Loading / error / empty states | `assets/index.html` | spinner, server-error + Retry, empty CTA |
| F10 | Product add/edit/delete → API | `assets/index.html` | server validation rules मिरर |
| F11 | Category add/rename/delete → API | `assets/index.html` | 409 (in use) साफ़ message |
| F12 | Stock steppers → PATCH | `assets/index.html` | हर tap ही save; गलती पर value वापस + toast; offline में local log भी |
| F13 | Bulk price → server preview + apply | `assets/index.html` | 0% guard, confirm dialog |
| F14 | Inventory summary card | `#/stock` | कुल / कम स्टॉक / ख़त्म / मूल्य — server और offline दोनों में गणा |
| F15 | "हाल के बदलाव" sheet | `#/stock` | server: `/inventory/movements`; offline: local log (200 तक) — kind icon, ±delta → नया स्टॉक, actor, समय |
| F16 | बल्क स्टॉक टैब | `#/bulk` (कीमत/स्टॉक टैब) | per-product absolute सेट inputs, "सब 0 करें", changed-count, एक रिक्वेस्ट में apply; offline भी चलता है |
| F17 | बल्क कैटेगरी शिफ़्ट | `#/bulk` → स्टॉक टैब sheet | चुनी सूची → टारगेट कैटेगरी; `POST /bulk-operations/category` (offline local) |
| F18 | Hindi/English strings | `#/stock`, `#/bulk`, help FAQ | नई चीज़ों में `t()` दोनों भाषाएँ |

### C. जाँच — अब असली रन (shell वापस आया)

| Check | Status |
|---|---|
| `node --check` style — extracted `<script>` JS | ✅ index.html / customer.html / admin.html **SYNTAX_OK** + `node --check pos-api.js` ✅ |
| `tsc --noEmit` (backend src + test) | ✅ **0 errors** — पहले 5 गलतियाँ थीं: catalogue.spec का `dto: unknown` (helper अब `e.property` भी गिनता है) + `round2('abc')` बिना cast + `ValidateNested({each})` shorthand + `delta` undefined narrowing |
| `jest` (unit) | ✅ **6 suites, 70/70 PASS** — slug/phone (पुराने) + pricing/catalogue (पिछले cycle के टूटे, अब ठीक) + inventory/bulk-ops (नए) |
| `jest` (e2e) | ⏳ PostgreSQL नहीं — auto-skip (पहले जैसी ही हाल) |
| Migration 003/004 लागू | ⏳ DB नहीं है — verify बाकी (दोनों idempotent) |
| APK build | ⏳ user खुद करेंगे (`gradle :app:assembleDebug`) |

> पिछले cycle की दिक़्क़त: `e.constraints` के keys **constraint type** थे (min/minLength/isIn) —
> failing **field** के लिए `e.property` (helper ठीक किया)। यही 11 test failures की जड़ थी।

## 🔄 Pending → PART 5 (उसके अपने चयन के लिए नीचे बाकी सूची)

## ✅ Completed (PART 4) — customer store, search, cart, checkout

### A. Backend — `backend/src/public-store/` (+ migration 005)

| # | Item | Where | Notes |
|---|---|---|---|
| P1 | Migration 005 | `database/migrations/005_part4_storefront.sql` | orders: public_token (unique), idempotency_key (shop-unique), guest fields, fulfilment, payment_status, discount/coupon; order_items snapshots+variant_id; shops: cod_enabled/pon_enabled/upi_vpa/min_order/is_accepting_orders; product_variants; shop_coupons — सब idempotent |
| P2 | GET `/public/shops/:slug` | `public-store.service.ts` | सिर्फ़ APPROVED+published; `paymentMethods[]` = सच में चालू तरीके; unpublished → 404 |
| P3 | GET `/public/shops/:slug/categories` · `/products` · `/products/:id` | वही | खोज (q), category filter, inStock, sort (name/price), page/limit pagination (≤50), hasMore; product + variants[] |
| P4 | POST `/public/shops/:slug/checkout/validate` | वही | server lines (OK/OUT/LOW/MISSING, unitPrice truth), coupon जाँच, deliveryFee (fee/free_above), minOrder, acceptOrders, totals — browser से कुछ नहीं मानता |
| P5 | POST `/public/shops/:slug/checkout` | वही | tx: products FOR UPDATE → नया हिसाब → conflict 409 (नई lines के साथ) → customer upsert → order insert → items snapshots → stock कटौती → `inventory_movements` SALE — पूरा COMMIT/ROLLBACK |
| P6 | Idempotency | वही + unique index `uq_orders_shop_idempotency` | वही key दोबारा → वही order (`duplicate:true`); रेस पर 23505 भी पकड़ा |
| P7 | GET `/public/orders/:token` | वही | random UUID token; ग्राहक नाम/पता/नंबर कभी नहीं जाता; PAID सिर्फ़ merchant/part-5 बनाएगा |
| P8 | Rate limits | `public-store.controller.ts` | पढ़ें 120/min · validate 30 · checkout 12 · order 60 — प्रति IP (Redis swap note रहा) |
| P9 | Payment honesty | checkout.ts + service | COD/PON flags दुकान के; `UPI_QR` सिर्फ़ `upi_vpa` सेट हो टब; gateway कोई नहीं — यह साफ़ लिखा है |
| P10 | Unit tests | `test/unit/public-store.spec.ts` | 11 describes: qty/cart merge/cap, stock clamp, coupon rules, delivery fee, totals, guest phone, idem key, line status, orderNumber |
| P11 | E2E | `test/e2e/public-store.e2e-spec.ts` | publish flow → search/variants → COD ऑर्डर → वही Idempotency-Key दोबारा → SALE movement → token privacy → रेस ओवरसेल — DB बिना auto-skip |

### B. Frontend — `customer-web/` (Next.js 14, हिंदी-पहले, green/white)

| # | Item | Where |
|---|---|---|
| F1 | दुकान होम `/s/[slug]` (status, contact, कैटेगरी chips, product grid) + OG metadata | `app/s/[slug]/page.tsx` |
| F2 | खोज/कैटेगरी/सॉर्ट/pagination + loading/error/empty/no-result states | `app/s/[slug]/search/page.tsx` |
| F3 | Product detail + variant चयन + availability + qty stepper | `app/s/[slug]/p/[pid]/page.tsx` + `components/AddToCart` |
| F4 | कार्ट (localStorage persist, qty/remove, server जाँच, OUT/कीमत-बदल warnings, खाली state) | `app/s/[slug]/cart/page.tsx` + `lib/cart.ts` |
| F5 | एक-कार्ट-एक-दुकान पॉलिसी: पूछकर switch (AskDialog), कभी silently नहीं | `components/{ProductCard,AddToCart}` + `lib/cart.attemptAdd` |
| F6 | Checkout: नाम/मोबाइल/पता/landmark/निर्देश, DELIVERY/PICKUP, server paymentMethods, कूपन, server-hिसाब, टर्म्स, confirm-से भेजना | `app/s/[slug]/checkout/page.tsx` |
| F7 | डुप्लिकेट-सुरक्षा UI: single Idempotency-Key प्रयास-चक्र में, double-tap disable, network fail पर डेटा+key सुरक्षित, conflict 409 → नई हाल + फिर भेजें | `checkout/page.tsx` |
| F8 | ऑर्डर स्थिति (number, payment status, fulfilment, totals, next steps, call-shop) — confirmation सिर्फ़ backend बनाए बाद | `app/order/[token]/page.tsx` + `RefreshBadge` |
| F9 | PWA manifest + icon; accessibility (44px targets, aria labels, focus states) | `app/manifest.ts`, `public/icon.svg`, `globals.css` |
| F10 | दुकानदार ऐप untouched | `app/` कुछ नहीं बदला (Part-3 APK वैसा ही) |

### C. जाँच — ✅ इस cycle shell चला (क्रैश से बचे cycle में पूरी पुष्टि, 2026-10-20 दूसरा रन)

> पिछले cycle में shell बंद था (tool outage) — जिससे 3 बड़ी चूक रही जातीं जो अब पकड़ी और ठीक कीं (नीचे)।
> यही सबूत है कि सत्यापन-रहित कोड भेजना कितना जोखिम है.

| Check | Status |
|---|---|
| `tsc --noEmit` (backend src+test) | ✅ **0 errors** — पहले 12 थीं: `sanitizeItems` गुम import, `?? / \|\|` बिना कोष्ठक, spec के 7 union-type `(.ok→.reason)` accesses (`reject`/`invalidPhone` narrow helpers जोड़े) |
| `jest` unit | ✅ **7 suites, 98/98 PASS** — एक टेस्ट खुद परिपाटी से भटका था: `normalizeGuestPhone('9876543210x')` अब `common/phone.ts` की परिपाटी (ग़ैर-अंक हटाना) से align किया |
| `jest` e2e (बिना DB) | ✅ **2 suites auto-skip, 17/17 skipped** — पहले दोनों suite **import पर ही ढह रही थीं**: `dto.ts` में `GuestCustomerDto` घोषणा को `CheckoutDto` से ऊपर खींचा (TDZ `Cannot access before initialization` — यह असली server boot भी तोड़ता!) |
| `customer-web` `tsc --noEmit` | ✅ **0 errors** (`next-env.d.ts` जोड़ा) |
| `customer-web` `next build` | ✅ **PASS** (on-device Termux, `@next/swc-wasm-nodejs` fallback से): सब 9 routes compile+type-check, ❗`useSearchParams` को `Suspense` में लपेटा (बिना इसके build fail होता) — build output हटा दिया गया, कोई project file नापाक नहीं |
| npm install (customer-web) | ✅ Android FUSE पर `--bin-links=false` की परिपाटी जैसा चला |
| migration 005 apply / असली e2e | ⏳ अब भी PG नहीं — migrator start पर खुद चलाएगा; SQL पूरी तरह idempotent |
| APK build | नहीं किया (कोई बदलाव नहीं) — user चाहे तो पुरानी command से re-verify |

**इस cycle में ठीक की गई 4 फ़ाइलें:** `backend/src/public-store/{public-store.service.ts,dto.ts}`,
`backend/test/unit/public-store.spec.ts`,
`customer-web/app/s/[slug]/search/page.tsx` (+ नया `customer-web/next-env.d.ts`).
Part 1/2/3 की कोई फ़ाइल नहीं छेड़ी.

[ ] PostgreSQL लगाकर असली e2e रन (`npm run test:e2e`) + migration 003/004/005 verify
[ ] Production DB engine confirm करें (migrations 003/004/005 PostgreSQL-specific हैं; requirements में MySQL भी लिखा है)
[ ] एक असली server के साथ COD ऑर्डर का आसिन टेस्ट (कस्टमर-दुकान end-to-end; build तो हो चुकी है)
[ ] Android पर customer-web build: दोबारा चलाएँ तो पहले `npm install --no-save @next/swc-wasm-nodejs` (native swc 404 देता है); laptop पर ज़रूरत नहीं
[ ] Variants भरने की merchant स्क्रीन (product_variants तालिका और public दिखना तैयार)
[ ] Merchant ऐप `#/orders/new` को PG के ऑर्डर से वायर (अभी डेमो-स्थानीय) — Part 5
[ ] APK build Part-3 का (user Termux से) — PART 2 जैसा रन ही चाहिए
[ ] Product photo upload (S3) + real QR generation
[x] SALE/RETURN movement kinds को ऑर्डर flow से जोड़ना — Part 5 में हो गया (SALE checkout में, RETURN cancel/reject में)
[x] Merchant ऐप `#/orders*` को PG के ऑर्डर से वायर — Part 5 में जुड़ा (SERVER mode)
[ ] Payment notes: UPI_QR manual-VPA flow अभी; असली gateway (UPI apps) Part 5+
[ ] Google Maps delivery radius + live rider status
[ ] WhatsApp bot webhooks (order intake)
[ ] UPI payment gateway (demo COD/UPI only now)
[ ] PDF reports + thermal printing (80mm)
[x] Admin audit log — PART 7 में असली values (`/admin/audit`)
[ ] Admin system-status (real health values) — अगला खंड
[ ] English mode polish (nav/CTA strings are translated; long bodies stay Hindi)
[ ] Gradle wrapper for reproducible builds

## ✅ Verified (this build)

- `node --check` on extracted `<script>` of all three HTML files → clean.
- Icon PNGs visually verified (glyph visible, gradient, round mask).
- All `data-a` actions registered in `ACTIONS` (dead-click sweep done).
- Acceptance: no dead buttons — every control navigates, mutates demo state, or
  opens a real system link; not-yet-built features explain themselves
  (e.g., "अगले वर्ज़न में") instead of pretending. Demo data clearly labelled.

## ✅ PART 5 — Order Lifecycle, Fulfilment, Notifications (कोड पूरा; असली रन 2026-10-21 भी पास)

### A. Backend — `backend/src/{orders,notifications/}` + migration 006

| # | Item | Where | Notes |
|---|---|---|---|
| O1 | Migration 006 | `database/migrations/006_part5_orders_lifecycle.sql` | order_status_history (order/actor/reason), notification_outbox (status+unique event index → डुप्लिकेट event नहीं), user_device_tokens (unique token), orders: cancellation_reason/cancelled_at/rejected_at/accepted_at/completed_at; notifications: user_id — सब idempotent |
| O2 | Server-validated transitions | `orders/order-lifecycle.ts` | सिर्फ़ **action** client से; map: NEW→ACCEPTED/REJECTED/CANCELLED, ACCEPTED→PREPARING/PREPARED, PREPARING→PREPARED, PREPARED→TRANSIT (सिर्फ़ DELIVERY)/DELIVERED(पिकअप)/CANCELLED, TRANSIT→DELIVERED ही. MARK_PAID: UPI_QR+PENDING+चालू status ही |
| O3 | Merchant order APIs | `orders/orders.controller.ts` | GET list (status/date/q/page filters, हर status गणना) · GET detail (items स्नैपशॉट + history) · POST accept/reject/cancel/status — स्नैपशॉट name/unit/price/variant → archived प्रोडक्ट भी पुराना विवरण दिखता है |
| O4 | वापसी ठीक एक बार | `orders.service.ts act()/restock()` | orders FOR UPDATE + valid-transition जाँच के अंदर ही RETURN movement; दोहरा cancel/reject 409 (स्टॉक छोए बिना रुकता है); RETURN rows = inventory audit में |
| O5 | Status history + audit | order_status_history | हर बदलाव: previous/new, actor_user_id, reason, timestamp — queries से पढ़ती है |
| O6 | Tenant isolation | `shop-scope.requireShopMember()` | URL का shopId भरोसेमंद नहीं — role जाँच + हर query shop_id की बाधा; दूसरी दुकान का orderId 404 |
| O7 | Payment सच | act() | Cod ऑर्डर complete → PAID अपने-आप (नकद); MARK_PAID सिर्फ़ UPI_QR+PENDING+चालू — रद्द/पूरा पर बदलना server reject |
| O8 | Notifications outbox | `notifications/notification-events.ts` + service | enqueue उसी tx में (COMMIT-के-बाद-भेजना); drain main.ts ~20 s; in-app history हमेशा बनती है; FCM सिर्फ़ FCM_SERVER_KEY सेट होने पर — नहीं तो row साफ़ note; bounded retry 1/2/4/8/16 मिन ×≤5 → FAILED जाँच के लिए; push टेक्स्ट बिना पता/पेमेंट विवरण |
| O9 | Device tokens | POST /notifications/device-tokens | upsert-by-token (refresh), platform ANDROID/IOS/WEB; GET /notifications (user का shop-join सूची+unread) · POST /:id/read (membership जाँच) |
| O10 | Customer cancel | `public-store.service.ts cancelByToken()` + controller | POST /public/orders/:token/cancel (10/min/IP) — सिर्फ़ NEW; स्टाफ़ ने स्वीकार किया (409) तो रद्द नहीं; वही shared restock; reason हिंदी पेज पर दिखता है |
| O11 | Checkout integration | public-store.service.ts | ऑर्डर बनने पर: पहला status-history row (NEW) + ORDER_NEW outbox event — activation उसी COMMIT से |

### B. Merchant app (WebView, Part-1 रूप में ही)

| # | Item | Where | Notes |
|---|---|---|---|
| M1 | `POS.orders` / `POS.notifs` wrappers | `assets/pos-api.js` v2.2-part5 | list/get/accept/reject/cancel/setStatus/history + notifications list/read/registerDevice — सर्वर मोड ही |
| M2 | #/orders/new SERVER | index.html | नया + प्रोसेसिंग; नंबर/समय/ग्राहक/सामान/पेमेंट/कुल; स्वीकार (confirm) / स्वीकार न करें (कारण sheet); दोहरा tap guard; loading/error/retry/empty |
| M3 | #/orders SERVER | स्वेयर | status chips गणना के साथ, खोज (server `q`), तारीख फ़िल्टर, रिफ़्रेश |
| M4 | #/orders/detail SERVER | से | असली टाइमलाइन (history से), items स्नैपशॉट, दुकानदार के लिए पता/नंबर, कदम server नियम अनुसार (preparing/ready/transit/pickup-complete/paid), reject/cancel कारण sheet, WhatsApp ग्राहक |
| M5 | #/notifs SERVER | से | POS.notifs असली इतिहास + रित read + mark-all (per-id loop); देव ऑफ़लाइन पुराना DB रहा |
| M6 | डेमो असे है बेछिन्न | तभीज-`if (ordServer())` | OFFLINE मोड Part-1 स्क्रीन बिल्कुल वैसी (pos_db) |

### C. Customer web (`customer-web/`)

| # | Item | Where |
|---|---|---|
| C1 | हिंदी टाइमलाइन (अपेक्षित status+समय+कारण; actor कभी नहीं) | `app/order/[token]/page.tsx` |
| C2 | नए status labels + छोटे labels | `lib/format.ts` (STATUS_HI अनुरोध वाले हिंदी labels) |
| C3 | रद्द बटन (केवल canCancel चालू) + कारण + confirm + पुष्टि | `components/CancelOrderButton.tsx` |
| C4 | types/api flags | `lib/types.ts` (history/reason/canCancel/pickup) + `lib/api.ts` (orderCancel) |

### D. जाँच — असली रन (2026-10-21, Termux PostgreSQL 18.6) ✅

PG लोकल लगाया (pkg install postgresql, data dir Termux tmp), schema.sql + migrations 002–006 **+ नया 007** apply हुए;
प्रत्येक सूची असली PG पर चली. प्रमाण:

| Check | Status |
|---|---|
| backend `tsc --noEmit` | ✅ **0 errors** |
| backend `jest` unit | ✅ **115/115, 8 suites** |
| backend `jest` e2e (असली DB, runInBand) | ✅ **23/23, 3 suites** (orders 6, public-store 7, shops-flow 10) |
| migration क्रम | schema.sql + 002,003,004,005,006 **+ 007 (नया, shops multi-owner)** — पूरा apply |
| merchant ऐप `node --check` | ⏳ इस cycle में नहीं चला |
| customer-web `next build` | ⏳ इस cycle में नहीं चला |
| APK build | नहीं किया (user खुद करेंगे) |

> **असली रन में पकड़ में आए नतीजे — ठीक किए (यही इन e2e की कीमत):**
> 1. `orders.service.fetchScoped()`: SQL में `FOR UPDATE` WHERE से **पहले** — PG syntax गड़बड़ → हर ट्रांज़िशन 500. अब WHERE/LIMIT **के बाद**.
> 2. `public-store buildLines()/couponByCode()`: lock=true पर भी pool से `FOR UPDATE` — lock फौरन छूट जाता → समांतर checkout **oversell**. अब tx के `q` पर चलता है (dq पैरामीटर); checkout का customers INSERT भी tx से बहरे था — अब q पर.
> 3. `couponByCode`: `FOR UPDATE` LIMIT से पहले — PG में locking clause आख़िरी होता है; पलटा.
> 4. `http-exception.filter`: extras (suggestions/reason/currentStatus) जवाब से छूट जाते थे — अब spread.
> 5. `orders list()`: default `status='ALL'` पर 400 देता था — अब बिना filter के.
> 6. `order-lifecycle.transition()`: TRANSIT पर fulfilment-delivery गुआर्ड + MARK_PAID `from:[]` — unit नियम ठीक.
> 7. `shops.owner_phone UNIQUE` (schema.sql) एक merchant की दूसरी दुकान रोकता था → `shops_owner_phone_key` छोड़ा (schema में तथा **migration 007** DROP CONSTRAINT IF EXISTS).
> 8. `public-store duplicateBy()`: dobara Idempotency-Key जवाब में `token` था, पहले जवाब `publicToken` — आकार एक किया.
> 9. `@Injectable()` छूटे (otp/shops) + auth.service के UPDATE placeholders — 500 पकड़ने वाले पुराने दोष.
> 10. e2e spec fixes (server नहीं): supertest v7 verb-first `.set()`, फोन-सीड 10-अंक, hasMore pagination, history में पहला 'NEW' row (migration 006 नियम), outbox drain e2e में manually (production में main.ts scheduler ही).

### E. जान ही जान (सीमाएँ)

- मर्चेंट ऐप WebView HTML वाला (प्रोजेक्ट का वादा Part-1 से), Flutter नहीं — "Flutter Android APK" वाला instruction इस रीपो को नहीं लिया जा (नया प्रोजेक्ट बनाना मना).
- FCM push **code-ready** पर असली Firebase key/device token आप लगाएं तो ही पहुँचेगा — बिना इसमें दावा नहीं. WhatsApp/Email/SMS नोटिफिकेशन इस part में नहीं.
- होम dashboard के सांख्यिकी अब भी डेमो DB से (server ऑर्डर स्क्रीन पूरी सच) — अगले parts में.
- Part 6 (WhatsApp शेयर/PWA) अब code-ready + verified — देखें `PROJECT_MANIFEST.md` §23 और नीचे PART 6+7.

---

# PART 6+7 — एडमिन पैनल, भूमिकाएँ, सुरक्षा, अप्रूवल, शिकायतें, पॉलिसी ✅ (2026-10-21)

> PART 6 (share/सोशल लेयर) पिछले cycle में code-ready था; इसी रनों में उसके सूट
> भी पहली बार हरे — record `PROJECT_MANIFEST.md` §23. PART 7 नीचे (§24 मैनिफ़ेस्ट,
> पूरा गाइड `docs/PART7_SETUP.md`).

## A. Enums + स्कीमा (backend + DB एक ही जगह)

| Enum | मान | जगह |
|---|---|---|
| UserRole | SUPER_ADMIN / ADMIN / SUPPORT | `src/common/roles.ts` · `admin_users.role` CHECK |
| ShopStatus | DRAFT / PENDING / APPROVED / REJECTED / SUSPENDED | `src/common/roles.ts` · `shops.status` CHECK (+ migration 008 का legacy backfill) |
| ComplaintStatus | OPEN / IN_PROGRESS / RESOLVED / CLOSED | `src/common/roles.ts` · `complaints.status` CHECK |

कदम-नियम pure: `shopTransition()` / `complaintTransition()` — दोहरा-tap रेस
row-lock (FOR UPDATE) + history एक tx में; unit कवर (`roles.spec.ts`).

## B. PART 7 delivered

| # | Item | Where |
|---|---|---|
| A1 | scrypt एडमिन-लॉगिन (कोई नया dep नहीं), 12h admin JWT, 10/5min rate-limit | `admin/admin-auth.service.ts` |
| A2 | bootstrap सुपर-एडमिन (env ADMIN_EMAIL/ADMIN_PASSWORD, admin_users खाली हो तो) | `admin-auth.service.ts` |
| A3 | RolesGuard — हर request DB से ताज़ा role/is_active (नकली टोकन 401, निष्क्रिय तुरंत मरे) | `common/guards.ts` + `@Roles()` |
| A4 | दुकान workflow: submit→PENDING; APPROVE/REJECT(कारण ज़रूरी)/SUSPEND(कारण)/UNSUSPEND + history | `admin.service.ts`, `shops.service.ts` |
| A5 | शिकायतें: ग्राहक token से (8/10min; ग़लत token → 404, न कि 500) + दुकानदार; START/RESOLVE(हल-नोट ज़रूरी)/CLOSE/REOPEN/नोट | `complaints/` मॉड्यूल |
| A6 | platform_policies: 7 seeded keys, प्रति-key value सत्यापक (pure) | `admin/policies.rules.ts` + service |
| A7 | audit_log — हर एडमिन क्रिया (कौन-कब-क्या) | `admin.service.writeAudit()` |
| A8 | schema: migration 008 idempotent; backfill PENDING_APPROVAL→PENDING, PUBLISHED→APPROVED; share.ts legacy-compat | `database/migrations/008_part7_admin_roles_policies.sql` |
| A9 | orders overview (search/status/shop filter) + commission summary (default % + per-shop DELIVERED GMV) | `admin.service.listOrders()/commissionSummary()`, `GET /admin/orders`, `GET/PUT /admin/commissions` |
| A10 | `auto_publish_on_approve` असल approval पर लागू + APPROVED दुकान का manual publish switch | `admin.service.autoPublishOnApprove()/setPublished()`, `PATCH /admin/shops/:id/publish` |
| F1 | `window.POSADMIN` API layer (token/base/http/Errors हिंदी) | `app/src/main/assets/admin-api.js` (NEW) |
| F2 | `admin.html` — login → भूमिका हिसाब-से tabs; dashboard/queue/shops/orders/commissions/complaints/policies/admins/audit; offline में डेमो जीवित | `app/src/main/assets/admin.html` (REWRITE) |
| F3 | integration pass: dashboard aliases, policy nested value, audit/shop field names, internal note, SUPPORT read-only policies, search/filter, shop detail+history | `admin.html` + `admin-api.js` |
| D1 | docs | `docs/PART7_SETUP.md` (NEW) + दोनों root docs का अपडेट |

## C. असली रन (2026-10-21, Termux PostgreSQL) ✅

| Check | Status |
|---|---|
| backend `tsc --noEmit` | ✅ **0 errors** |
| backend unit | ✅ **173/173, 12 suites** (नए: roles, policies) |
| backend e2e (असली DB, runInBand) | ✅ **45/45, 5 suites** — admin-flow **16/16** (नया + auto-publish/publish, orders/commission) |
| migration 008 | ✅ लागू + seeded |
| एडमिन assets `node --check` | ✅ admin-api.js + admin.html inline |
| APK build | नहीं किया — user खुद करेंगे |

**रन से पकड़े 3 बग — ठीक:** (1) complaints `act()/list()` SQL param-क्रम — बिना-'?'
clauses भी param खाते थे → "could not determine data type of parameter $1",
START 500; (2) `PolicyPatchDto.value` whitelist pipe से गिरता था → हर पॉलिसी पैच
400 (अब `@IsDefined()`); (3) ग़लत-आकार complaint token → PG uuid-cast 500 (अब 404).

### C2. Integration pass — panel ↔ backend shape fixes (`2.4.1-part7`)

पहला delivery पास था, पर UI कुछ fields गलत नाम/shape से पढ़ रही थी. बिना पुराना
काम हटाए ठीक किया:

1. dashboard `shops.total` / `orders.today` missing → server aliases + SLA hint.
2. policies `value` nested `{value:…}` → UI unwrap; input अब inner value भेजता है;
   SUPPORT को पॉलिसी tab read-only (server 403 के साथ संगत).
3. audit `entityId`, shop `reason`/`licenseNo` aliases → UI दोनों shape संभालती है.
4. "इंटरनल टिप्पणी" label पर note `isInternal=false` जा रहा था → अब `true`.
5. `auto_publish_on_approve` केवल stored था → APPROVE/UNSUSPEND पर लागू; जब false
   हो तो स्टेटस APPROVED रहता है पर public नहीं, और नया `PATCH /admin/shops/:id/publish`
   switch जोड़ा (audit + idempotent).
6. Part 1 के admin **orders/commission** tabs rewrite में छूट गए थे → `GET /admin/orders`
   (search/status/shop, read-only तीनों भूमिकाएँ) और `GET/PUT /admin/commissions`
   (default %, per-shop DELIVERED GMV/commission अनुमान) वापस; offline demo में भी.
7. queue/list/complaints search+status filter, `GET /admin/shops/:id` का detail sheet
   (status history + हाल की शिकायतें) और manual publish button जोड़े.

**अंतिम रन:** `tsc` 0 · unit **173/173 (12 suites)** · e2e **45/45 (5 suites)**,
admin-flow **16/16** · `node --check` (admin-api.js + admin.html inline) clean ·
migration 008 idempotent. APK नहीं बनाया — user Termux से बनाएंगे.

## D. पैनल का चल-चित्र (server mode)

1. `admin.html` खोलें → ऑडमिन login (env वाला ईमेल/पासवर्ड) → भूमिका-अनुसार tabs.
2. "अप्रूवल कतार": मर्चेंट ने सबमिट की दुकान PENDING दिखेगी → APPROVE (policy के
   हिसाब से public) या REJECT (कारण ज़रूरी; दुकान के इतिहास + merchant को दिखता है).
   APPROVED दुकान का "public करें/हटाएँ" switch अलग से चलता है.
3. "दुकानें": search + status filter; "📋 विवरण" में address/license/categories,
   status history और हाल की शिकायतें.
4. "ऑर्डर्स": order no/दुकान/ग्राहक search, status filter — तीनों भूमिकाएँ पढ़ सकती हैं.
5. "कमीशन" (SUPER/ADMIN): default % सेव (0…30) + हर दुकान की DELIVERED बिक्री पर
   अनुमान; बदलाव audit_log में.
6. "शिकायतें": ग्राहक/दुकानदार की नई शिकायत OPEN → शीट खोलें → START (ज़िम्मेदारी
   लें) → RESOLVE हल-नोट लिखकर → CLOSE; ज़रूरत हो तो REOPEN.
7. "पॉलिसी": key मान बदलें → सेव — सर्वर सत्यापक अमान्य मान (जैसे कमीशन 50%) रोकेगा;
   SUPPORT को केवल पढ़ने को.
8. "एडमिन" (सिर्फ़ सुपर): नया सपोर्ट/एडमिन बनाओ; किसी को निष्क्रिय करो — उसका
   टोकन अगली ही request पर 401.
9. "ऑडिट": ऊपर सब कर्म यहीं सूची में (entity id + समय सहित).

---

# PART 8 — Integration + सुरक्षा/DB pass + असली builds ✅ (2026-10-21)

> उद्देश्य: Part 1–7 का पूरा integration check, bugs/सुरक्षा/DB ठीक करना, सारे टेस्ट +
> live smoke चलाना, असली APK (debug + release) और customer-web production build,
> docs का update। नीचे सब **असली रन** के नतीजे — जो चला वही लिखा।

## A. ठीक किए गए bugs / सुरक्षा / DB (कोड में पक्के)

| # | क्या | कहाँ |
|---|---|---|
| V1 | **Variant stock bug:** variant-owned stock checkout पर घटता ही नहीं था | `checkout.ts` (`ServerLine.stockSource`), `public-store.service.ts` (decrement), `orders.service.ts` shared `restock()` (RETURN variant stock वापस, NULL/मृत → product fallback); SALE/RETURN note में variant नाम |
| V2 | `.env` auto-load नहीं होता था | `backend/src/config/load-env.ts` (process.env जीतता है — verified) |
| V3 | Migrator का migrations path cwd पर निर्भर था | `env.ts` `findMigrationsDir()` (cwd + दोनों dist layouts — verified असली path) |
| V4 | शून्य DB पर Part-1 स्कीमा chain में नहीं था | NEW `001_part1_baseline.sql` (idempotent) |
| V5 | `order_items.variant_id` पर FK/index/CHECK गुम | NEW `009_part8_variant_integrity.sql`: FK `ON DELETE SET NULL`, `idx_order_items_order/product`, `product_variants_stock_check` |
| V6 | OTP `Math.random` था | अब `crypto.randomInt(0,10)`; pepper = `env.JWT_SECRET` |
| V7 | Media upload सिर्फ़ extension/MIME पर | असली magic-byte जाँच: JPEG `FF D8 FF`, PNG 8-बाइट signature, WEBP `RIFF`+`WEBP@8`; detected == claimed; size==buffer |
| V8 | `shops.controller` forbidden-field check duplicate `@Body()` पर | अब raw `@Request() req.body` |
| V9 | Production CORS खुला था | `main.ts`: dev open; production allow-list `CORS_ORIGINS` (default `PUBLIC_SHOP_ORIGIN`); `Idempotency-Key` header allowed |
| V10 | Production में localhost media/CORS URL चुपचाप pass | `env.ts` validation: `MEDIA_URL_BASE` https + no localhost/127.0.0.1/0.0.0.0/10.0.2.2; `CORS_ORIGINS` entries भी (THROW/OK दोनों verified) |
| V11 | DB pool shutdown पर close नहीं | `DbService implements OnModuleDestroy` |
| V12 | Release APK में localhost API base जा सकता था | `app/build.gradle` LOCALHOST guard — `-PposApiBase=http://localhost:4000` → **BUILD FAILED** (verified) |

## B. असली रन — पूरा रिकॉर्ड (2026-10-21)

| Check | Result |
|---|---|
| backend `tsc --noEmit` | ✅ **0 errors** |
| backend unit | ✅ **173/173, 12 suites** |
| backend e2e (fresh `posdb_part8`, runInBand) | ✅ **49/49, 5 suites** (नए: variant-stock regression, shops self-approval 400 / media magic / cross-shop) |
| migrations 001→009 शून्य DB पर | ✅ clean; 29 tables; `order_items_variant_id_fkey` (SET NULL), `product_variants_stock_check`, `idx_order_items_order/product`, `uq_orders_public_token`, `uq_orders_shop_idempotency`, `customers_shop_id_phone_key`, `shop_coupons_shop_id_code_key`, `product_variants_product_id_name_key` सब मौजूद |
| live smoke `tools/smoke-api.mjs` (port 4100, `posdb_smoke`) | ✅ **32/32** (नीचे C) |
| `gradle :app:assembleDebug` | ✅ `app/build/outputs/apk/debug/app-debug.apk` · 3,456,215 B · md5 `d69bb74b4c58195d30a936e572069f21` |
| `gradle :app:assembleRelease -PposApiBase=https://api.example.com` | ✅ `app/build/outputs/apk/release/app-release-unsigned.apk` · 2,673,710 B · md5 `07c8f5e0ae99b42d2430ac5b546fab90` |
| release guard (localhost नाकाम) | ✅ जान-बूझकर BUILD FAILED + release manifest HTTPS-only |
| APK assets vs source | ✅ unzip किए `pos-api.js`/`admin-api.js` के md5 बिल्कुल source से मेल |
| `customer-web` production build | ✅ compiled successfully (3 static ○ + 6 dynamic ƒ routes; Termux WASM-SWC prelude) |

## C. Live smoke के 32 checks (सब PASS — संक्षेप में)

onboarding(register→OTP→shop DRAFT) · self-approval 400 · submit → admin login → queue → approve → publish · product create 201 · public shop/product दिखा · checkout validate ok · checkout 2xx + token · **idempotent retry = वही order** · token order पर phone leak नहीं · complaint create → admin list → START → RESOLVE · SALE movement दर्ज · **stock 6→4** · customer cancel 2xx · **दोबारा cancel 409, stock दोबारा नहीं जुड़ा** · cross-shop orders/detail 403 · fake image 400 · real PNG 2xx · दूसरे merchant का media upload 403 · admin dashboard 200।

## D. सीमाएँ (fake success नहीं)

- **Flutter नहीं:** प्रोजेक्ट Part-1 से नेटिव Android (Java+WebView) है; `flutter` मशीन पर
  नहीं + कोई Flutter project नहीं → `flutter analyze/test/build` नहीं चले (ऐसा दावा नहीं)।
  जगह पर असली `gradle` debug + release दोनों बने — ऊपर paths।
- **Release APK unsigned** — Play के लिए अपनी keystore से sign करना होगा।
- **Production domain नहीं दिया** — verify placeholder `https://api.example.com` से; असली
  domain आने पर `-PposApiBase=https://<domain>` से rebuild।
- **Admin Panel** अलग build नहीं — assets (`admin.html`+`admin-api.js`) में है, APK के साथ बनता है।
- FCM push असली Firebase key चाहता है (code-ready; in-app history हमेशा)।
