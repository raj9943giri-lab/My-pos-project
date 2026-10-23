# POS — Screen Inventory & Integration Map (PART 1)

## 1. Merchant app (`assets/index.html`) — hash routes

| Route | Screen | Key widgets | State touched |
|---|---|---|---|
| `#/` | Splash | brand card, skip | → onboarding or home |
| `#/onboarding` | 4 slides | dots, next/back | session |
| `#/login` | Phone login | +91 field + validation | `session.phone` |
| `#/otp` | 4-box OTP | autofocus advance, resend | auth gate |
| `#/register` | Shop details | 4 fields, validation | `session.*`, `profile` |
| `#/register-cats` | Shop categories | 10-tile multi-select | `session.cats` |
| `#/home` | Dashboard | hero stats, 6 quick tiles, recents | reads `orders`, `products` |
| `#/shop` | Shop profile | open/closed switch, edit sheet | `profile` |
| `#/products` | Product list | category chips, live search, FAB | reads `products` |
| `#/products/add` `/edit?id=` | Product form | category-specific fields | `products` |
| `#/cats` | Category CRUD | rename/delete guards | `productCats` |
| `#/stock` | Stock mgmt | tabs, ± steppers, save-all | `products.stock` |
| `#/bulk` | Bulk price | ±% stepper, preview table | `products.price` |
| `#/orders/new` | New orders | accept/reject cards | `orders.status` |
| `#/orders/detail?id=` | Order detail | timeline, bill, call/wa.me | `orders.status` |
| `#/orders` | History | status chips + counts | reads |
| `#/customers` | Customers | add sheet, stats modal | `customers` |
| `#/delivery` | Delivery | switches, inputs, radius ± | `settings.delivery` |
| `#/share` | Share | copy, wa.me, share, QR stub, preview | clipboard/system share |
| `#/reports` | Reports | weekly bars, category split, top, CSV export | blob download |
| `#/notifs` | Notifications | unread badges, mark-all | `notifs` |
| `#/settings` | Settings | hi/en tabs, rows | `pos_lang` |
| `#/help` | Help | FAQ accordion, support links | — |
| `#/menu` | More | 11 rows + 2 platform links | — |

## 2. Customer store (`customer.html`)

Homepage (header w/ shop info + हमारा पता) → search → category chips
→ product cards → product sheet (कार्ट में डालें / WhatsApp पूछें)
→ cart sheet (aggregation + delivery fee from `pos_db.settings.delivery`)
→ checkout (address, phone, COD/UPI) → order-complete receipt.

## 3. Admin panel (`admin.html`)

Tabs (SERVER mode, भूमिका-अनुसार): डैशबोर्ड | अप्रूवल कतार | दुकानें | ऑर्डर्स |
कमीशन (SUPER/ADMIN) | शिकायतें | पॉलिसी | एडमिन (सिर्फ़ SUPER) | ऑडिट (SUPER/ADMIN).
Tabs (OFFLINE demo): डैशबोर्ड | शॉप अप्रूवल | सभी दुकानें | ऑर्डर्स | शिकायतें |
कमीशन | पॉलिसी (डेमो).
Demo actions: approve/reject shops, orders list, commission estimate, policy save,
resolve complaints — सब `localStorage['pos_admin_db_demo']` में; असली server mode
में login + backend.

## 4. Integration map (same-origin demo bus)

```
customer.html ──writes──▶ localStorage['pos_db'].orders ──▶ index.html #/orders/new
admin.html    ──separate──▶ localStorage['pos_admin_db_demo']  (marked as डेमो)
index.html    ──links──▶ customer.html (store preview)
index.html    ──links──▶ admin.html (panel demo)
MainActivity  ──externally──▶ wa.me / tel: / https share links
```

## 5. No dead ends — policy

- Every bottom-nav tile routes; every list row opens; every chip filters.
- Not-yet-built features (photos, PDF, rider status) are labelled अगले वर्ज़न and stay
  non-destructive; they never fake a backend call.
- `window.__posHandleBack` closes sheets first, then history — MainActivity agrees.
