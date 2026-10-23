# POS — API Route Map (NestJS scaffold → PART 3)

PART 1 में कोई लाइव बैकएंड नहीं था: सारा डेमो डेटा `localStorage` (`pos_db`, `pos_cart`, `pos_admin_db_demo`) में रहता है। यह दस्तावेज़ बताता है कि हर स्क्रीन कौन-सा एनडपॉइंट कॉल करेगी।

## ✅ PART 2 — लागू (NestJS `backend/` में कोड है)

Auth + shop profile + approval Part 2 में बन गए हैं (`backend/src/auth`, `backend/src/shops` + `database/migrations/002_part2_users_shops.sql`)। देव मोड में मर्चेंट ऐप बिना सर्वर भी इन्हीं flows का offline mock चलाता है (`pos-api.js`)।

### Auth
| Method | Route | Status | Notes |
|---|---|---|---|
| POST | `/auth/register` | ✅ PART 2 | नाम + WhatsApp (E.164) + FCM जैसा push token वैकल्पिक → user बनाता है / मौजूदा लौटाता है |
| POST | `/auth/otp/request` | ✅ PART 2 | OTP भेजता है; देव में console SMS provider (plaintext OTP कभी लॉग/स्टोर नहीं, hash-only) |
| POST | `/auth/otp/verify` | ✅ PART 2 | OTP जाँच → JWT (merchant scope) |
| GET | `/auth/me` | ✅ PART 2 | JWT से session bootstrap |

### Shop profile, categories, slug, approval
| Method | Route | Status | Notes |
|---|---|---|---|
| GET | `/shop-categories` | ✅ PART 2 | license-ज़रूरत flags (`needs_license`, `needs_fssai`), एक समय max 3 |
| POST | `/shops` | ✅ PART 2 | नई दुकान, slug auto/unique |
| GET | `/shops/my` | ✅ PART 2 | लॉगिन की दुकान (owner/member) |
| GET | `/shops/:id` | ✅ PART 2 | ownership guard के साथ detail |
| PATCH | `/shops/:id` | ✅ PART 2 | profile edit; `status` client से सेट नहीं हो सकता |
| POST | `/shops/:id/media` | ✅ PART 2 | फोटो, magic-byte validation, `/media` static |
| GET | `/shops/check-slug` | ✅ PART 2 | उपलब्धता + `-2..-5` सुझाव |
| GET | `/shops/:slug/public` | ✅ PART 2 | public store page + OG tags (customer.html भविष्य में) |
| POST | `/shops/:id/submit-for-approval` | ✅ PART 2/7 | DRAFT → PENDING (सर्वर-साइड गार्ड: पूरा data, ≤3 cats, न्यूनतम 1 मीडिया नियम config) |
| PATCH | `/admin/shops/:id/status` | ✅ PART 7 | APPROVE/REJECT/SUSPEND/UNSUSPEND + कारण; `auto_publish_on_approve` लागू |

### ✅ PART 3 — लागू (product catalogue, inventory, bulk pricing)

Product catalogue Part 3 में बन गया है (`backend/src/products`, `backend/src/product-categories`
+ `database/migrations/003_part3_catalogue.sql`). सारे routes JWT लेंगे और **shop scoped** हैं —
`shop_id` client नहीं भेजता, सर्वर उसके shop membership से तय करता है.

| Method | Route | Status | Body / query | Notes |
|---|---|---|---|---|
| GET | `/products` | ✅ PART 3 | `?q=&categoryId=&category=&stock=all\|low\|out&includeInactive=` | `{ items, count }`; soft-deleted rows छिपे हैं |
| GET | `/products/:id` | ✅ PART 3 | — | एक row (404 अगर दूसरी दुकान का हो) |
| POST | `/products` | ✅ PART 3 | `{ name, unit, price, mrp?, stock?, lowAt?, brand?, fresh?, life?, categoryId?, category? }` | `category` नाम से भी चलता है (नई कैटेगरी बन जाती है) |
| PATCH | `/products/:id` | ✅ PART 3 | वही fields (partial) | `mrp: null` / `brand: null` → वह क्षेत्र खाली करता है |
| DELETE | `/products/:id` | ✅ PART 3 | — | **soft delete** (`is_active = false`); order history सुरक्षित |
| PATCH | `/products/:id/stock` | ✅ PART 3 | `{ delta }` \| `{ stock }` \| `{ lowAt }` | stock कभी negative नहीं होता |
| POST | `/products/bulk-price` | ✅ PART 3 | `{ percent, categoryId?, category?, preview?, minPrice? }` | `preview:true` → सिर्फ़ preview; apply एक transaction में (`FOR UPDATE`) |
| GET | `/product-categories` | ✅ PART 3 | — | `{ items, count }` + हर कैटेगरी पर `productCount` |
| POST | `/product-categories` | ✅ PART 3 | `{ name, emoji? }` | duplicate नाम → 409 |
| PATCH | `/product-categories/:id` | ✅ PART 3 | `{ name?, emoji? }` | नाम बदलने पर products अपने आप जुड़े रहते हैं (`category_id`) |
| DELETE | `/product-categories/:id` | ✅ PART 3 | — | products अभी भी use करते हैं → 409 |

#### PART 3 (हिस्सा 2) — Inventory Management (`backend/src/inventory`) + Bulk Operations (`backend/src/bulk-operations`)

स्टॉक का हर बदलाव अब `inventory_movements` टेबल में दर्ज होता है (migration `004_part3_inventory.sql`) —
कौन (actor), कब, कितना (delta), पहले/बाद का स्टॉक, नोट। स्टॉक देखने के लिए दो सरफ़ासें:

| Method | Route | Status | Body / query | Notes |
|---|---|---|---|---|
| GET | `/inventory/summary` | ✅ PART 3 | — | `{ products, inactive, low, out, alert, units, value }` — स्टॉक स्क्रीन का header card; STAFF भी देख सकता है |
| GET | `/inventory/movements` | ✅ PART 3 | `?productId=&limit=` (limit max 100, default 30) | हाल के स्टॉक बदलाव — RESTOCK / ADJUST / SET / BULK / SALE / RETURN; actor का नाम साथ |
| POST | `/bulk-operations/stock` | ✅ PART 3 | `{ items: [{ id, delta? \| stock? }], note? }` | एक कॉल में ≤200 प्रोडक्ट का स्टॉक; transaction + `FOR UPDATE` locks, हर item के लिए movement log; STAFF चला सकता है। जवाब: `{ updated, unchanged, missing, changes: [{ id, name, delta, before, after }] }` |
| POST | `/bulk-operations/category` | ✅ PART 3 | `{ ids: [...], categoryId? \| category? }` | सूची के सब active प्रोडक्ट एक कैटेगरी में; अनजान नाम भी बन जाता है (product form जैसा नियम); OWNER/MANAGER |
| POST | `/bulk-operations/active` | ✅ PART 3 | `{ ids: [...], active: false\|true }` | बल्क soft-delete / वापस-लाएं (`is_active`); OWNER/MANAGER |

**लिखने की single-truth:** स्टॉक बदलने के दो ही ## दरवाज़े हैं — `PATCH /products/:id/stock` (एक प्रोडक्ट)
और `POST /bulk-operations/stock` (सब एक साथ)। दोनों लिखावट `inventory_movements` में एक ही transaction
में दर्ज होती है, इसलिए हिसाब कभी स्टॉक column से नहीं पिछड़ेगा। बल्क **कीमत** edit का रूट
पहले से `POST /products/bulk-price` पर ही है (एक ही लिखावट रास्ता)।

**क्लाइंट:** `pos-api.js` में `POS.inventory` (summary, movements) + `POS.bulkOps` (stock,
assignCategory, setActive); `index.html` में `#/stock` पर summary card + "हाल के बदलाव" sheet और
`#/bulk` में कीमत/स्टॉक दो टैब (स्टॉक टैब = per-product सेट + एक साथ लागू + कैटेगरी शिफ़्ट)।

**भूमिकाएँ:** `OWNER` / `MANAGER` — कैटलॉग + कीमत बदल सकते हैं; `STAFF` — सिर्फ़ stock adjust कर सकता है.

**क्लाइंट:** `app/src/main/assets/pos-api.js` में `POS.products` / `POS.productCats`;
`index.html` में `catalogue` adapter — SERVER mode में लाइव API, DEV offline mode में Part-1 local store.

### अभी बचे (PART 4+)
Orders, customers, delivery, reports, notifications, webhooks — नीचे वाली पुरानी तालिका इन्हीं की योजना है।

---

## भविष्य (PART 4+ योजना)

## Orders (business + customer)
| Method | Route | Used by |
|---|---|---|
| GET | `/orders?status=` | नए ऑर्डर / हिस्ट्री tabs |
| GET | `/orders/:id` | order detail timeline |
| PATCH | `/orders/:id/status` | स्वीकार→तैयार→रास्ते में→पूरी / रद्द |
| POST | `/public/shops/:slug/orders` | customer.html checkout (creates NEW order) |

## Customers, settings, reporting
| Method | Route | Used by |
|---|---|---|
| GET/POST | `/customers` (shop-scoped) | ग्राहक list/add |
| GET/PUT | `/delivery-settings` | डिलीवरी सेटिंग |
| GET/PUT | `/shop-settings` (low-stock threshold) | स्टॉक टैब हिंट |
| GET | `/reports/weekly`, `/reports/monthly` | सेल्स रिपोर्ट charts |
| GET/PUT | `/notifications`, `/notifications/read-all` | बेल icon + सूची |
| POST | `/webhooks/whatsapp` (PART 3+) | वेबस्टोर/शेयर डीप-लिंक |

## Admin (SPA `admin.html`; PART 7 में लागू ✅)

| Method | Route | Used by |
|---|---|---|
| POST | `/admin/auth/login` | scrypt login → 12h admin JWT |
| GET | `/admin/me` | ताज़ा role/is_active |
| GET | `/admin/dashboard` | counts + `shops.total`/`orders.today` + oldest pending |
| GET | `/admin/shops?queue=1&status=&q=&page=&limit=` | अप्रूवल कतार / सभी दुकानें (search/filter) |
| GET | `/admin/shops/:id` | shop detail + status history + हाल की शिकायतें |
| PATCH | `/admin/shops/:id/status` | `{action: APPROVE\|REJECT\|SUSPEND\|UNSUSPEND, reason?}` |
| PATCH | `/admin/shops/:id/publish` | `{published:true\|false}` — APPROVED का manual public switch (auto-publish policy) |
| GET | `/admin/orders?status=&q=&shopId=&page=&limit=` | platform-wide orders overview (तीनों भूमिकाएँ read) |
| GET | `/admin/commissions` | default % + per-shop DELIVERED GMV/commission अनुमान (SUPER/ADMIN) |
| PUT | `/admin/commissions` | `{defaultPct:0…30}` → `commission_default_pct` + audit |
| GET | `/admin/complaints?status=&priority=&shopId=&assigned=&q=&page=&limit=` | complaints list |
| GET | `/admin/complaints/:id` | detail + history + notes + allowedActions |
| POST | `/admin/complaints/:id/status` | `{action: START\|RESOLVE\|CLOSE\|REOPEN, note?, assignTo?}` |
| POST | `/admin/complaints/:id/notes` | `{body, isInternal?}` (default internal) |
| GET | `/admin/policies` | 7 seeded policies (SUPPORT read) |
| PATCH | `/admin/policies/:key` | `{value:…}` + per-key validator + audit (SUPER/ADMIN) |
| GET/POST/PATCH | `/admin/admins` | admin team (सिर्फ़ SUPER_ADMIN) |
| GET | `/admin/audit?limit=` | audit screen (SUPER/ADMIN) |
| GET | `/admin/system-status` | ⏳ अगला खंड (real health values) |

### Public / merchant complaints (PART 7 ✅)

| Method | Route | Used by |
|---|---|---|
| POST | `/public/orders/:token/complaint` | ग्राहक, बिना login (8/10min rate-limit; ग़लत token 404) |
| POST | `/shops/:shopId/complaints` | दुकानदार (member JWT) |

## System status targets (audit screen)
`api` `db` `otp-sms` `whatsapp-bot` `payments`
