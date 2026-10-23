# PART 4 सेटअप + जाँच — कस्टमर स्टोर, कार्ट, चेकआउट

**Date:** 2026-10-20 · अपेक्षित: Part 1/2/3 वैसे ही चालू (`PROJECT_MANIFEST.md` §8 लेआउट के आगे)

इस पूरे भाग में कीमत/स्टॉक/कूपन **सिर्फ़ server** गिनता है, ऑर्डर **transaction में**
बनता है और दोहराए टैप/retry से **Idempotency-Key** बचाती है. Payment gateway
(तीसरी सेवा) इस भाग में शामिल **नहीं** है — इसलिए दुकान के चालू तरीके ही UI दिखाता है.

---

## 1. क्या-क्या जुड़ा (फ़ाइलें)

```
POS/
├─ database/migrations/005_part4_storefront.sql   # NEW — orders (public_token,
│    #   idempotency_key, guest fields, fulfilment, payment_status, discount),
│    #   order_items snapshots, shops (cod/pon/upi_vpa/min_order/accepting),
│    #   product_variants, shop_coupons — सब idempotent
├─ backend/src/public-store/
│  ├─ public-store.module.ts · public-store.controller.ts
│  ├─ public-store.service.ts    # shop/products/validate/checkout/order-status
│  ├─ checkout.ts                # DB-free pure helpers (money, coupon, phone…) → unit tests
│  └─ dto.ts                     # class-validator DTOs
├─ backend/test/unit/public-store.spec.ts        # NEW (pure helpers)
├─ backend/test/e2e/public-store.e2e-spec.ts     # NEW (DATABASE_URL न हो तो auto-skip)
├─ customer-web/                  # NEW — Next.js 14 कस्टमर स्टोर (विवरण README.md)
└─ docs/PART4_SETUP.md            # यह फ़ाइल
```

`app.module.ts` में `PublicStoreModule` जुड़ा; merchant ऐप की Part-1/2/3 स्क्रीन को **हाथ नहीं लगा**.

## 2. चलाने की सीढ़ी

```bash
# (1) DB migration — migrator खुद चलाता है, या हाथ से:
psql "$DATABASE_URL" -f database/migrations/005_part4_storefront.sql

# (2) Backend
cd POS/backend && npm install      # Termux पर: npm install --bin-links=false
cp .env.example .env               # DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, PUBLIC_SHOP_ORIGIN
npm run start:dev                  # port 4000

# (3) कस्टमर स्टोर (VPS/लैपटॉप पर; Termux में भी चलता है, 3000 पोर्ट)
cd POS/customer-web
npm install; cp .env.example .env.local     # NEXT_PUBLIC_API_BASE=http://<backend-host>:4000
npm run dev

# (4) दुकान publish: Part-2 flow — merchant submit → admin approve (auto-publish)
```

Android WebView वाला पुराना `customer.html` डेमो वैसा ही चालू रहता है (Part-1) —
real ऑर्डर अब web store से भी आते हैं, और Part-3 का merchant ऐप उन्हें `#/orders/new`
में देखेगा (उसी `orders` टेबल से अगली साइकिल में वायरिंग होगी; आज UI डेमो-स्थानीय है).

## 3. Public API (rate-limited, कोई auth नहीं)

| Method | Route | उदाहरण / जवाब |
|---|---|---|
| GET | `/public/shops/:slug` | published दुकान + `og` meta. Unpublished → **404** |
| GET | `/public/shops/:slug/categories` | सिर्फ़ available सामान वाली कैटेगरी |
| GET | `/public/shops/:slug/products?q=आटा&categoryId=&sort=price_asc&inStock=true&page=1&limit=24` | `{ items, page, limit, total, hasMore }` |
| GET | `/public/shops/:slug/products/:id` | product + `variants[]` (विकल्प, ₹/स्टॉक सहित) |
| POST | `/public/shops/:slug/checkout/validate` | कार्ट जाँच: `lines[]` (status OK/OUT/LOW/MISSING, `unitPrice` server से), `coupon`, `totals{subTotal,discount,deliveryFee,total}`, `minOrder`, `acceptOrders` |
| POST | `/public/shops/:slug/checkout` | `customer{name,phone}`, `fulfilment` DELIVERY\|PICKUP, `address/landmark/instructions`, `couponCode`, `paymentMode` COD\|PON\|UPI_QR + headers `Idempotency-Key` → `{ duplicate, order{ publicToken, number, totals, paymentStatus:'PENDING', … } }` |
| GET | `/public/orders/:token` | status देखने का लिंक (ग्राहक पता/नंबर कभी नहीं आता) |

curl उदाहरण:

```bash
# कार्ट जाँच
curl -s localhost:4000/public/shops/rajesh-kirana/checkout/validate \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":1,"qty":2}],"fulfilment":"DELIVERY"}'

# COD ऑर्डर (दोहराए requests में वही key भेजें)
curl -s localhost:4000/public/shops/rajesh-kirana/checkout \
  -H 'content-type: application/json' -H 'Idempotency-Key: sess-<random>' \
  -d '{"items":[{"productId":1,"qty":2}],
       "customer":{"name":"सुनीता","phone":"9876543210"},
       "fulfilment":"DELIVERY","address":"पोखरी रोड मकान 12","paymentMode":"COD"}'

# स्थिति
curl -s localhost:4000/public/orders/<publicToken>
```

## 4. सत्यापन जाँच (इस cycle में असली रनों का हाल)

| जाँच | हाल |
|---|---|
| `node --check` / `tsc --noEmit` / `jest` backend | ⏳ यह cycle shell चला ही नहीं (tool-आउटेज) — **बताए असली रन नीचे §6** |
| migration 005 लागू होना | ⏳ DB वाला वातावरण नहीं — idempotent, दोबारा भी चलेगी |
| `customer-web` `next build` | ⏳ shell नहीं चला — बिल्ड termux/laptop पर ही होगा |
| e2e (DB सहित) | ⏳ पहले जैसा — `npm run test:e2e` (PG लगाकर) |

## 5. साफ़-साफ़ क्या **नहीं** बना

- **Payment gateway नहीं है.** `UPI_QR` = सिर्फ़ दुकान का VPA देखकर मैन्युअल भुगतान —
  जब तक VPA (`shops.upi_vpa`) मर्चेंट ने नहीं डाला, वह विकल्प दिखेगा ही नहीं. PAID स्थिति
  कोई browser-जवाब से नहीं बनती; उसे Part-5 का merchant flow बदलता है.
- **Distance/radius आधारित डिलीवरी गणना नहीं** — सिर्फ़ दुकान की निर्धारित फीस (free-above सहित).
- **फुफिलमेंट स्लॉट** Part 5 (आज delivery_settings.note = ETA टेक्स्ट ही).
- **merchant app में variants manage करने की स्क्रीन नहीं** — `product_variants` तालिका बनी,
  public store दिखाता है; भरने की UI अगली साइकिल.
- **SMS/Maps/प्रिंटर आदि** पुराने pending जैसे ही.

## 6. Termux/VPS पर खुद सत्यापित करें (क्रम)

```bash
# बैक टाइप-जाँच + यूनिट
cd ~/storage/shared/MyProjects/POS/backend
npm run test                      # unit: 7 suites (पुराने 6 + public-store)
npx tsc --noEmit                  # सारे src+test

# इंटीग्रेशन (PG हो तो)
npm run test:e2e

# स्टोर बिल्ड
cd ~/storage/shared/MyProjects/POS/customer-web
npm install && npm run build

# APK (merchant ऐप) कोई बदलाव नहीं — Part-3 वाला ही तरीका
gradle :app:assembleDebug
```

नतीजे `PART_STATUS.md` में PART-4 तालिका में घटा-घटा लिखें.
