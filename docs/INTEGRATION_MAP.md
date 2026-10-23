# POS — Feature→Data Integration Map (PART 1)

How each feature area connects inside the shipped demo, and what it will connect to in PART 2.

| Feature area (instruction) | Demo wiring (PART 1) | Target (PART 2) |
|---|---|---|
| Login / OTP | `session.phone` in `pos_db`; OTP fixed 1234 | `/auth/otp/*` + JWT |
| Registration & shop categories | `session.cats` → `profile.emoji/name` | POST `/shops` |
| Home dashboard | computed from `orders` + `reportsSeed[6]` | GET `/reports/summary` |
| Product list/add/edit | SERVER: `POS.products` → `/products`; DEV offline: `pos_db.products` CRUD | `/products` ✅ PART 3 |
| Categories | SERVER: `POS.productCats` → `/product-categories`; DEV offline: `pos_db.productCats` CRUD | `/product-categories` ✅ PART 3 |
| Stock | SERVER: stepper → `PATCH /products/:id/stock`; DEV offline: `products[].stock` | PATCH `/products/:id/stock` ✅ PART 3 |
| Bulk price | SERVER: preview → apply (`/products/bulk-price`); DEV offline: local preview + mutate | POST `/products/bulk-price` ✅ PART 3 |
| New orders | `orders` where status == नई | GET `/orders?status=NEW` |
| Order lifecycle | detail buttons mutate status; timestamps via `fmtTime` | PATCH `/orders/:id/status` |
| Customers | `customers` + derived order stats | GET/POST `/customers` |
| Delivery settings | `settings.delivery` used by merchant + customer checkout fee | GET/PUT `/delivery-settings` |
| Share | wa.me deep-link + `navigator.share` + stub QR canvas | QR microservice + bot |
| Sales reports | 7-day seed chart + computed category mix + real CSV export | `/reports/weekly` + PDF |
| Notifications | `pos_db.notifs` w/ unread dots | `/notifications` |
| Settings & language | `pos_lang` hi/en toggle; rows reuse screens | `/shop-settings` |
| Customer store | reads `pos_db` via `loadShop()` fallback `SEED` | GET `/public/shops/:slug` |
| Customer checkout | writes new नई order into `pos_db.orders` | POST `/public/shops/:slug/orders` |
| Admin approvals | demo `pos_admin_db_demo.shops` status flow | ✅ PART 7: `PATCH /admin/shops/:id/status` + `PATCH /admin/shops/:id/publish` (auto-publish policy) |
| Commission | demo estimate from local orders | ✅ PART 7: `GET/PUT /admin/commissions` (default % policy + per-shop DELIVERED GMV) |
| Policy / complaints / orders | demo `pos_admin_db_demo` fields | ✅ PART 7: `/admin/policies`, `/admin/complaints`, `/admin/orders` (server mode) |

## Known demo boundaries (labelled in UI)

- QR code on `#/share` is a placeholder pattern, not scannable — अगला पार्ट.
- Admin shop list is separate sample data (different phone context).
- Reports chart uses `reportsSeed` + real completed-order data where dated.
- Product photos are emoji placeholders.
