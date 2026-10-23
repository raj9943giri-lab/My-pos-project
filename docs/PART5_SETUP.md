# PART 5 सेटअप — Order Management, Fulfilment, Notifications

> यह गाइड हिंदी में है. पढ़ने का क्रम: `PART2_SETUP.md` → `PART4_SETUP.md` → यह फ़ाइल.
> **असली स्थिति (ईमानदार):** इस cycle में Freebuff का shell नहीं चला, इसलिए `tsc`/`jest`
> **इस cycle में नहीं रन हुए** — नीचे §6 में खुद चलाने के exact कमांड हैं. सारे बदलाव
> Part 1–4 की कोडिंग-शैली (blocks वाले नियम) के अनुसार लिखे गए हैं; पहला रन आप करेंगे.

---

## 1. क्या जुड़ा (सब फ़ाइलें)

```
database/migrations/006_part5_orders_lifecycle.sql   # NEW — order_status_history,
                                                     # notification_outbox,
                                                     # user_device_tokens, orders
                                                     # lifecycle columns (idempotent)
backend/src/orders/                                  # NEW मॉड्यूल
  ├─ order-lifecycle.ts      # pure transition rules (unit-tested)
  ├─ dto.ts                  # status-action/reason/list filters
  ├─ orders.service.ts       # list/detail/act()/history (tx + row-lock)
  ├─ orders.controller.ts    # /shops/:shopId/orders…
  └─ orders.module.ts
backend/src/notifications/                           # NEW मॉड्यूल
  ├─ notification-events.ts  # pure: हिंदी push टेक्स्ट, backoff, reason cap
  ├─ dto.ts                  # { token, platform? }
  ├─ notifications.service.ts # enqueue (tx में) + drain + device tokens + सूची
  ├─ notifications.controller.ts
  └─ notifications.module.ts
backend/src/public-store/                            # UPDATED
  ├─ public-store.service.ts # checkout tx में NEWहिस्ट्रीrow+outbox event,
  │                          #  order status में timeline+reason, customer cancel
  ├─ public-store.controller.ts # POST /public/orders/:token/cancel (10/min/IP)
  └─ dto.ts                  # OrderCancelDto
backend/src/shop-scope/shop-scope.service.ts         # UPDATED: requireShopMember()
backend/src/app.module.ts                            # Orders+Notifications modules
backend/src/config/env.ts                            # FCM_SERVER_KEY, NOTIFIER_INTERVAL_MS
backend/src/main.ts                                  # outbox drain scheduler (~20s)
backend/.env.example                                 # FCM की key का जगह
backend/test/unit/order-lifecycle.spec.ts            # NEW unit टेस्ट
backend/test/e2e/orders.e2e-spec.ts                  # NEW e2e (DB बिना auto-skip)
app/src/main/assets/pos-api.js                       # UPDATED: POS.orders / POS.notifs (v2.2-part5)
app/src/main/assets/index.html                       # UPDATED: ऑर्डर स्क्रीन SERVER mode
customer-web/lib/{api,format,types}.ts               # UPDATED: cancel + timeline + labels
customer-web/components/CancelOrderButton.tsx        # NEW (client component)
customer-web/app/order/[token]/page.tsx              # UPDATED: टाइमलाइन+reason+cancel
```

## 2. मेचर कैसे दिखाए orders (merchant ऐप, SERVER mode)

Settings → कनेक्शन में API base URL डालें — तब से:

- **`#/orders/new`** — नए ऑर्डर (केसिअम `NEW` स्टेटस), साथ में "प्रोसेसिंग" (ACCEPTED…TRANSIT)
- **`#/orders`** — पूरी सूची: स्टेटस chips (count साथ), खोज (ऑर्डर नंबर/ग्राहक/फ़ोन),
  तारीख फ़िल्टर (YYYY-MM-DD input — दुकानदार चुने), रिफ़्रेश बटन
- **`#/orders/detail?id=…`** — `S-000123` पूरा टाइमलाइन, स्नैपशॉट items (प्रोडक्ट बाद में
  archived हो जाए तो भी पुराना नाम/कीमत दिखेगा), पता/नंबर सिर्फ़ दुकान स्टाफ़ को मिलता
  है (हमेशा देखता है — स्क्रीन दुकानदार ऐप की है; पब्लिक स्टेटस पेज में ग्राहकका पता
  कभी नहीं जाता), और server नियम के अनुसार कदम बटन:
  - NEW → स्वीकार / स्वीकार न करें (कारण sheet)
  - ACCEPTED → तैयारी शुरू / सीधे तैयार / रद्द
  - PREPARING → तैयार / रद्द
  - PREPARED → डिलीवरी हो तो "रास्ते में", पिकअप हो तो "पिकअप पूरा"; रद्द
  - TRANSIT → "डिलीवर हो गया" (रद्द नहीं होता; दुकान देख-भाल करे)
  - `UPI_QR` + पेमेंट PENDING → "पेमेंट मिला — दर्ज करें" (स्वीकार के बाद सिर्फ़)
- डेव offline mode में पुरानी डेमो स्क्रीन बिल्कुल पहले जैसी (pos_db) — कोई फ़र्क़ नहीं.

## 3. स्टॉक/भुगतान के नियम (सर्वर में पक्के)

- Checkout (Part 4) स्टॉक बनते-ही उसी transaction में काटता है (`FOR UPDATE` +
  `SALE` movement). **कोई दूसरा reservation तंत्र नहीं बना** — जितना मौजूद था उतना.
- reject/cancel पर ही स्टॉक वापस — `RETURN` movement, उसी tx: orders row-lock + valid
  transition नियम → **दोबारा cancel/reject request 409**, स्टॉक ठीक एक बार जुड़ता है.
- `DELIVERED` + COD + PENDING → payment_status अपने-आप `PAID` (नकद मिल गया). `MARK_PAID`
  सिर्फ़ `UPI_QR` ऑर्डर, PENDING हालत में, ACCEPTED…TRANSIT तक — रद्द/पूरा ऑर्डर बिना
  पेमेंट बदल नहीं. COD ऑर्डर पर MARK_PAID सर्वर ही reject करता है.
- हर transition का `order_status_history` row: पहले का status, नया, actor user,
  reason, timestamp — ऑडिट पूरा.

## 4. ग्राहक पक्ष (customer-web + public API)

- `GET /public/orders/:token` अब `history` (सिर्फ़ status+समय+reason — actor नहीं),
  `cancellationReason` और `canCancel` भी देता है.
- `POST /public/orders/:token/cancel` — सिर्फ़ `NEW` ऑर्डर (10/min/IP). ग्राहक के
  स्वीकार हो चुके ऑर्डर पर 409 "दुकान ऑर्डर स्वीकार कर चुकी है".
- ऑर्डर स्थिति पेज पर हिंदी टाइमलाइन + कारण + रद्द बटन. एन्यूमरेशन अब भी मास्टर
  token से ही (order नंबर से नहीं).

## 5. API उदाहरण (merchant)

```bash
# सूची
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.example.com/shops/$SHOPID/orders?status=NEW&limit=25"

# accept
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{}' "https://api.example.com/shops/$SHOPID/orders/42/accept"

# reject (कारण)
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"सामान उपलब्ध नहीं"}' \
  "https://api.example.com/shops/$SHOPID/orders/42/reject"

# server-validated transition (सिर्फ़ action, status नहीं)
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"MARK_READY"}' \
  "https://api.example.com/shops/$SHOPID/orders/42/status"

# cancel (स्टॉक वापसी उसी tx में)
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"ग्राहक ने रद्द किया"}' \
  "https://api.example.com/shops/$SHOPID/orders/42/cancel"

# इतिहास
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.example.com/shops/$SHOPID/orders/42/history"
```

Notifications (merchant):

```bash
# अपना device token register (FCM push के लिए)
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"token":"<FCM-DEVICE-TOKEN>","platform":"ANDROID"}' \
  "https://api.example.com/notifications/device-tokens"

# अपने shops का in-app इतिहास + unread count
curl -H "Authorization: Bearer $TOKEN" "https://api.example.com/notifications"

# पढ़ा करें
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://api.example.com/notifications/9/read"
```

## 6. सत्यापन (खुद चलाएं — ईमानदार हाल **⏳ = इस cycle में नहीं चला**)

```bash
cd ~/storage/shared/MyProjects/POS/backend
npx tsc --noEmit                       # ⏳ — 0 errors चाहिए
npx jest test/unit                     # ⏳ — पुराने 98 + नए ~15 tests
npm run test:e2e                       # ⏳ — DATABASE_URL/JWT_SECRET बिना auto-skip
# PostgreSQL लगा हो तो migration खुद चलेगी (src/db/migrator.ts) — 006 इडेम्पोटेंट
```

`customer-web`: `npx next build` (Termux में पहले `npm install --no-save @next/swc-wasm-nodejs`)
— ⏳ इस cycle में shell ही नहीं चली. `node --check` stylesheet अलग है इसलिए सीधा
नहीं लेकिन merchant ऐप का जाँच:

```bash
node --check app/src/main/assets/pos-api.js          # ⏳
# index.html inline JS: फ़ाइल से <script> निकालकर (पिछलों वाला तरीक़ा) check
```

APK build नहीं किया — कोई नियम बदला नहीं, आप खुद `gradle :app:assembleDebug` चलाएंगे.

## 7. Push notifications की सच्चाई

- **हर घटना** in-app इतिहास में ज़रूर दिखेगी (`#/notifs`, `/notifications`).
- FCM push **केवल** तब, जब `.env` में `FCM_SERVER_KEY` सेट हो और device token
  register हो (`POST /notifications/device-tokens`). KEY नहीं हो तो push SKIPPED —
  row पर साफ़ note रहता है, "कतार हुई" को "पहुँच गई" कभी नहीं कहा जाता.
- Temp fail → bounded retry (1,2,4,8,16 मिनट; ≤5 कोशिश), फिर FAILED row (जाँच के लिए).
- Push टेक्स्ट में ग्राहक का पता/पेमेंट विवरण कभी नहीं भेजा जाता.
- Token duplicate पर refresh होता है (unique index + upsert); platform अपडेट होता है.

## 8. Quantum/इस Part की सीमाएँ (ईमानदार)

1. Merchant ऐप `tsc`-स्टाइल टेस्ट नहीं है (पहले ही WebView HTML-App — Flutter नहीं,
   क्योंकि प्रोजेक्ट की असली संरचना v1 से WebView है; Part 5 ने नया तरीक़ा नहीं बनाया).
2. FCM integration **code-configured** है पर असली FCM project/key आपको लगाना होगा —
   बिना की कोई push वादा नहीं. WhatsApp/Email/SMS नोटिफिकेशन इस part में नहीं
   (providers, आगे के parts).
3. Shell नहीं चली इसलिए §6 के सारे रन ⏳ — पहले रन में छोटे-मोटे fix लग सकते हैं;
   शैली पहले के parts से वही है.
4. होम dashboard के आँकड़े (आज की बिक्री वग़ैरह) अब भी डेमो DB से हैं — असली server
   आँकड़ों का डैशबोर्ड आगे के parts. ऑर्डर स्क्रीन पूरी सच हैं.
