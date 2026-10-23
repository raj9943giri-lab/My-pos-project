# PART 7 सेटअप — Admin Panel, Roles, Security, Shop Approvals, Complaints, Platform Policies

> यह गाइड हिंदी में है. पढ़ने का क्रम: `PART5_SETUP.md` → यह फ़ाइल.
> **असली स्थिति (ईमानदार):** सारे सत्यापन इसी cycle में असली PostgreSQL पर चले —
> `tsc` 0 errors, unit **173/173 (12 suites)**, e2e **45/45 (5 suites, runInBand)**,
> admin-flow **16/16**, दोनों asset JS `node --check` clean. सटीक कमांड नीचे §6.
> APK build user खुद करेंगे. अंतिम integration pass का record §9 में.

---

## 1. क्या जुड़ा (सब फ़ाइलें)

```
database/migrations/008_part7_admin_roles_policies.sql   # NEW — admin_users,
                                                         # complaint tables,
                                                         # platform_policies (7 seeded),
                                                         # status CHECKs; idempotent
backend/src/common/                                      # UPDATED/NEW
  ├─ roles.ts            # UserRole/ShopStatus/ComplaintStatus enums,
  │                      # shopTransition(), complaintTransition() (pure → unit-tested)
  ├─ guards.ts           # AdminGuard (JWT) + RolesGuard (हर request DB से
  │                      # ताज़ा role/is_active) + @Roles() decorator
  └─ current-user.decorator.ts   # @CurrentAdmin()
backend/src/admin/                                       # कई फ़ाइल NEW/UPDATED
  ├─ admin.service.ts         # dashboard, shop workflow + publish switch,
  │                           # orders overview, commission summary, audit
  ├─ admin-auth.service.ts    # scrypt hash (कोई नया dep नहीं), JWT (12h),
  │                           # login rate-limit 10/5min, bootstrap super-admin
  ├─ admin-users.service.ts   # सूची/बनाओ/पैच (SUPER_ADMIN only)
  ├─ policies.rules.ts        # per-key value सत्यापक (pure, unit-tested)
  ├─ policies.service.ts      # platform_policies पढ़ो/बदलो + audit
  ├─ admin.controller.ts      # सारे /admin/* routes + role-मैट्रिक्स
  └─ admin.module.ts
backend/src/complaints/                                  # NEW मॉड्यूल
  ├─ complaints.service.ts    # दर्ज/सूची/विवरण/act()/नोट — सब tx + FOR UPDATE
  ├─ complaints.controller.ts # /admin/complaints + /public/orders/:token/complaint
  │                           # (rate-limited 8/10min) + /shops/:shopId/complaints
  ├─ dto.ts
  └─ complaints.module.ts
backend/src/shops/shops.service.ts   # UPDATED: submitForApproval → PENDING +
                                     # status history row (migration 008 नाम-मान्यीकरण)
backend/src/share.ts                 # पुराने 'PENDING_APPROVAL' जवाब अब भी चलते
                                     # हैं (legacy-compat) — पुराने clients न टूटें
backend/src/app.module.ts            # ComplaintsModule जुड़ा
backend/.env.example                 # PART 7 वाले env (ADMIN_JWT_SECRET, ADMIN_EMAIL,
                                     # ADMIN_PASSWORD) की हिंदी टिप्पणियाँ
backend/test/unit/{roles,policies}.spec.ts           # NEW unit टेस्ट
backend/test/e2e/admin-flow.e2e-spec.ts              # NEW e2e — 16 टेस्ट (DB बिना auto-skip)
backend/test/e2e/helpers.ts                          # NEW — seedE2EAdmin/e2eAdminToken
backend/test/e2e/{orders,public-store,share}.e2e-spec.ts  # UPDATED — असली admin row seed
app/src/main/assets/admin-api.js                     # NEW — window.POSADMIN (token/base/
                                                     # http/api); SERVER`↔OFFLINE दो मोड
app/src/main/assets/admin.html                       # REWRITTEN — login → भूमिका-अनुसार
                                                     # tabs; offline में पुराना डेमो जीवित
PROJECT_MANIFEST.md / PART_STATUS.md                 # इस update में PART 6+7 अंक
```

## 2. एडमिन कैसे बने / लॉगिन कैसे हो

1. **bootstrap सुपर-एडमिन** — server पहली बार चले और `admin_users` खाली हो, तो
   `.env` के `ADMIN_EMAIL`/`ADMIN_PASSWORD` से SUPER_ADMIN row खुद बनती है (scrypt).
   फिर पैनल की "एडमिन" tab से (सिर्फ़ SUPER_ADMIN) और बनाएं — पासवर्ड hash सर्वर पर.
2. **लॉगिन** — `POST /admin/auth/login` (पैनल की login स्क्रीन इसी को कॉल करती है).
   गलत password/अनजान email → एक ही 401 ("गलत विवरण") — user-जाँच नहीं फँसती.
   Rate-limit: 10 tries/5 min per (IP+email) → 429.
3. **सत्र** — admin JWT ~12 घंटे, `ADMIN_JWT_SECRET` से साइन (JWT_SECRET से अलग रखें).
   पैनल token `pos_admin_jwt` में रखता है; बाहर (बटन) से जाता है.

## 3. भूमिका-मैट्रिक्स ( @$_Roles() से route-level पक्का)

| Route group | SUPER_ADMIN | ADMIN | SUPPORT |
|---|---|---|---|
| dashboard, shops (list/detail/queue), orders | ✓ | ✓ | ✓ (सिर्फ़ पढ़ने को) |
| shops status कदम (approve/reject/suspend) | ✓ | ✓ | ✗ 403 |
| shops publish switch (APPROVED का public on/off) | ✓ | ✓ | ✗ 403 |
| shop-categories पैच | ✓ | ✓ | ✗ 403 |
| complaints (सूची/विवरण/कदम/नोट) | ✓ | ✓ | ✓ |
| policies (पढ़ना) | ✓ | ✓ | ✓ |
| policies (बदलना) | ✓ | ✓ | ✗ 403 |
| commissions (summary/save) | ✓ | ✓ | ✗ 403 |
| admins (सूची/बनाओ/पैच) | ✓ | ✗ | ✗ |
| audit | ✓ | ✓ | ✗ |

- **RolesGuard हर request पर `admin_users` से ताज़ा role/is_active पढ़ता है** —
  इसलिए निष्क्रिय किया admin का टोकन **तुरंत** मर जाता है (जुदाई revocation-safe).
- पैनल UI के tabs केवल सुविधा हैं; असली फ़ैसला हर route का guards करता है.

## 4. Shop approval workflow

- मर्चेंट: `POST /shops/:id/submit-for-approval` → हाल `PENDING` (+ `shop_status_history`).
- पैनल "अप्रूवल कतार": APPROVE / REJECT (कारण ज़रूरी, दुकानदार देखता है).
  - `platform_policies.auto_publish_on_approve=true` (default) → APPROVE/UNSUSPEND पर
    दुकान `published=TRUE` (public).
  - `false` → status APPROVED रहता है पर दुकान छिपी रहती है; SUPER/ADMIN
    `PATCH /admin/shops/:id/publish` (`{published:true|false}`) से खोल/बंद करता है
    (idempotent, audit_log में).
- SUSPEND (कारण ज़रूरी) → public से हटती है; UNSUSPEND → policy के हिसाब से वापस.
- approve-पर-approve जैसे अघले कदम `shopTransition()` से 409; दोहरा tap रेस भी
  row-lock (FOR UPDATE) से 409 — इतिहास दो बार नहीं लिखता.
- migration 008 ने पुराने DB की `PENDING_APPROVAL`→`PENDING`, `PUBLISHED`→`APPROVED`
  backfill की; `share.ts` पुराने नामों के जवाब अब भी देता है (compat).

## 5. शिकायतें — दरवाज़े और जीवन-चक्र

- **दरवाज़े:** ग्राहक `POST /public/orders/:token/complaint` (बिना login; token
  UUID होना ज़रूरी — ग़लत आकार 404, ऊपर rate-limit 8/10min) या दुकानदार
  `POST /shops/:shopId/complaints` (member JWT).
- **जीवन-चक्र:** `OPEN →(START)→ IN_PROGRESS →(RESOLVE, हल-नोट ज़रूरी)→ RESOLVED
  →(CLOSE)→ CLOSED`; `RESOLVED →(REOPEN)→ IN_PROGRESS`. सारे कदम एक ही दरवाज़े
  (`act()`) से — row-lock + `complaintTransition()` नियम + history + audit एक tx.
- SUPPORT शिकायत सिर्फ़ ख़ुद को लेता है; SUPER/ADMIN किसी को भी सौंप सकते हैं
  (`assignTo`). टिप्पणी धागा बंद होने पर भी चलता रहता है (इंटरनल default).

## 6. सत्यापन (इस cycle के असली रन, Termux PostgreSQL)

```bash
# PG (Termux)
pg_ctl -D /data/data/com.termux/files/usr/tmp/opencode/pgdata start -o "-p 5432"

# 0) स्कीमा + migration (पहली बार)
psql -U pos -d posdb -f database/schema.sql
psql -U pos -d posdb -f database/migrations/008_part7_admin_roles_policies.sql

cd backend && export DATABASE_URL="postgres://pos@localhost:5432/posdb" \
  JWT_SECRET="e2e-local-secret-0123456789abcdef0123456789abcdef" \
  ADMIN_JWT_SECRET="e2e-local-admin-secret-0123456789abcdef0123456789"

# 1) types + unit
node node_modules/typescript/bin/tsc --noEmit
node node_modules/jest/bin/jest.js --config jest.config.json --testPathPattern test/unit

# 2) e2e (असली DB, क्रम से)
node node_modules/jest/bin/jest.js --config jest.config.json --testPathPattern test/e2e --runInBand

# 3) एडमिन assets syntax
node --check ../app/src/main/assets/admin-api.js
# admin.html का inline JS भी ऐसे ही निकालकर जाँचा गया (दोनों OK)

# आख़िर में PG बंद:
pg_ctl -D /data/data/com.termux/files/usr/tmp/opencode/pgdata stop
```

| Check | Status |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| unit | ✅ **173/173, 12 suites** (roles + policies नए, सब नए नियम) |
| e2e (असली DB) | ✅ **45/45, 5 suites** — admin-flow **16/16** |
| migrations | ✅ 008 idempotent; 7 policies seeded; status backfill |
| assets | ✅ `node --check` (admin-api.js + admin.html inline) |
| APK build | नहीं किया — user `gradle :app:assembleDebug` से खुद करेंगे |

## 7. असली रन में पकड़ में आए बग — ठीक किए (admin-flow e2e की कीमत)

1. **complaints `act()`/`list()` का param-क्रम** — `add()` helper बिना-'?' के
   clauses (जैसे `first_response_at = now()`, `IS NULL`) भी marker array में
   `null` धकेल रहा था और शुरुआती slot (`$1`) कभी text में रही ही नहीं → PG
   "could not determine data type of parameter $1" → START हमेशा 500. अब: सिर्फ़
   `'?'` वाले ही clause params खाते हैं, क्रम `$1…` से, WHERE सबसे आख़िरी slot.
2. **PolicyPatchDto का `value`** — global ValidationPipe `whitelist:true` ने
   decorator-रहित `value` property हटा दी थी → हर पैच 400 "body {value} भेजें".
   अब `@IsDefined()` — मान सर्वर के प्रति-key सत्यापक (0…30 आदि) से ही जाँचता है.
3. **bogus complaint-token 500** — `orders.public_token` UUID है; ग़लत-आकार
   token पर PG cast 500 देता था. अब HEX-UUID regex जाँच → साफ़ 404 (public-store
   वाला ही घरेलू पैटर्न).

## 8. पैनल UI — अंदर की बात

- `admin-api.js` (`window.POSADMIN`): base (`pos_admin_api_base`, न हो तो
  मर्चेंट ऐप का `pos_api_base`), Bearer token, timeout+errText (हिंदी), सारे
  admin endpoints की झोली (`api.auth/dashboard/shops/orders/commissions/
  complaints/policies/admins/audit`).
- `admin.html`: offline → पुराना डेमो (seed + "डेमो" badge; अब orders + कमीशन
  tabs भी); server → login स्क्रीन → भूमिका के हिसाब से tabs; shops queue/list
  के APPROVE/REJECT(कारण)/SUSPEND(कारण)/UNSUSPEND + manual publish; search/status
  filters; "📋 विवरण" शीट (address/license/categories + status history + हाल की
  शिकायतें); ऑर्डर्स overview; कमीशन (default % + per-shop अनुमान); शिकायत शीट
  में इतिहास+इंटरनल टिप्पणियाँ+सिर्फ़-allowed कदम; पॉलिसी सूची+सेव (SUPPORT
  read-only); एडमिन-टीम (SUPER) बनाओ/निष्क्रिय/पासवर्ड; ऑडिट तालिका.

## 9. Integration pass — पहले delivery के बाद ठीक किए गए gaps (`2.4.1-part7`)

Part 7 का पहला delivery पास था, पर panel कुछ जवाबों को गलत नाम/shape से पढ़ रही
थी और दो पुराने admin features rewrite में छूट गए थे. इस pass में (पुराना काम
हटाए बिना) ये ठीक किए:

| # | पकड़ा गया gap | अब |
|---|---|---|
| 1 | dashboard `shops.total` / `orders.today` नहीं थे → stat cards 0 | server aliases (`total/all`, `today/todayCount`, total complaints) + oldest-pending SLA hint |
| 2 | policies `value` = `{value:…}`; UI `[object Object]` दिखाता/भेजता | UI `policyInner()` से unwrap; save inner value; SUPPORT read-only tab |
| 3 | audit `entityId` vs `entity_id`; shop `reason`/`licenseNo` aliases | UI दोनों shape; shop card/detail में address/categories/license |
| 4 | "इंटरनल टिप्पणी" पर `isInternal=false` जाता था | अब `true` (backend default के साथ) |
| 5 | `auto_publish_on_approve` केवल stored था | APPROVE/UNSUSPEND पर लागू + `PATCH /admin/shops/:id/publish` + UI switch |
| 6 | Part 1 के admin orders/commission tabs rewrite में छूटे | `GET /admin/orders`, `GET/PUT /admin/commissions` + server/offline tabs |
| 7 | list/complaints में search/filter नहीं; shop detail route unused | q/status filters + `GET /admin/shops/:id` detail sheet |

**अंतिम रन (इसी pass के बाद):** `tsc` 0 errors · unit **173/173 (12 suites)** ·
e2e **45/45 (5 suites)**, admin-flow **16/16** (नए: auto-publish/publish और
orders/commission role tests) · `node --check` admin-api.js + admin.html inline clean ·
migration 008 idempotent. APK build नहीं किया — user Termux से करेंगे.
