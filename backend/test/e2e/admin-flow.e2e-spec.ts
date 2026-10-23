/* PART 7 — admin panel integration (roles, shop workflow, complaints, policies).
 * NOTE (honesty): DB पर चलता है — बिना DATABASE_URL/JWT_SECRET के auto-SKIP.
 * Local PostgreSQL + .env के बाद: `npm run test:e2e`.
 *
 * जाँचें:
 *   - POST /admin/auth/login (scrypt) → JWT; गलत password / अनजान email 401
 *   - role matrix: SUPPORT approve नहीं कर सकता (403), admins नहीं देख सकता,
 *     पॉलिसी पढ़ सकता पर बदल नहीं
 *   - भूत admin token (admin_users में row नहीं) → 401
 *   - shop: REJECT (कारण ज़रूरी) → REJECTED; resubmit → APPROVE → public;
 *     SUSPEND → public ग़ायब → UNSUSPEND → वापस; approve-पर-approve 409
 *   - complaints: ग्राहक token से दर्ज → OPEN → START → RESOLVE (नोट ज़रूरी)
 *     → REOPEN → CLOSE; CLOSED terminal (409) + नोट धागा
 *   - policies: seeded सूची + role-guarded patch + validator मना
 *   - audit log में सारे काम
 */
const run = !!process.env.DATABASE_URL && !!process.env.JWT_SECRET;

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { AdminAuthService } from '../../src/admin/admin-auth.service';
import { ComplaintStatus } from '../../src/common/roles';
import { seedE2EAdmin, e2eAdminToken } from './helpers';

(process.env.DATABASE_URL ? describe : describe.skip)('admin panel (integration)', () => {
  let app: INestApplication;
  let superToken = '';      // e2e helper में seeded सुपर-एडमिन का raw JWT
  let superLogin = '';      // असली login endpoint का raw JWT (password-verified)
  let supportLogin = '';
  let merchantToken = '';
  let shopId = '';
  let orderPublicToken = '';
  let complaintId = '';
  const slug = 'admin-e2e-' + Math.floor(Math.random() * 100000);
  const uid = Date.now();
  const SUPER_EMAIL = 'super' + uid + '@pos.local';
  const SUPPORT_EMAIL = 'support' + uid + '@pos.local';

  const api = () => request(app.getHttpServer());
  const as = (rawToken: string): any => new Proxy({} as any, {
    get(_: unknown, verb: string) {
      return (url?: string) => (api() as any)[verb as string](url).set('Authorization', 'Bearer ' + rawToken);
    },
  });
  const SUPER = () => as(superLogin || superToken);

  beforeAll(async () => {
    jest.setTimeout(120000);
    const modRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const db = app.get(DbService);
    await seedE2EAdmin(db);
    // login-able सुपर-एडमिन + सपोर्ट (idempotent seed — uid पर निर्भर)
    for (const [e, role, pwd, name] of [
      [SUPER_EMAIL, 'SUPER_ADMIN', 'SuperSecret123', 'सुपर E2E'],
      [SUPPORT_EMAIL, 'SUPPORT', 'SupportSecret1', 'सपोर्ट E2E'],
    ] as const) {
      const existing = await db.query('SELECT id FROM admin_users WHERE email = $1', [e]);
      if (!existing.length) {
        await db.query(
          `INSERT INTO admin_users (email, name, pwd_hash, role) VALUES ($1, $2, $3, $4)`,
          [e, name, AdminAuthService.hashPassword(pwd), role],
        );
      }
    }
    superToken = e2eAdminToken(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);

    /* merchant + दुकान + submit (Part-2 flow reuse) */
    const phone = '8555' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    await api().post('/auth/register').send({ name: 'एडमिन E2E मालिक', phone }).expect(201);
    const req = await api().post('/auth/otp/request').send({ phone }).expect(201);
    const ver = await api().post('/auth/otp/verify').send({ phone, code: req.body.devCode }).expect(201);
    merchantToken = ver.body.token;
    const shopRes = await as(merchantToken).post('/shops').send({
      name: 'एडमिन किराना', slug, categoryIds: ['grocery'],
      whatsapp: '+919876543210', address: 'एडमिन गली', pin: '232101',
    }).expect(201);
    shopId = shopRes.body.id;
    await as(merchantToken).post(`/shops/${shopId}/submit-for-approval`).send({}).expect(201);
  });

  afterAll(async () => { await app.close(); });

  /* -------------------------------- login -------------------------------- */
  it('admin login (scrypt) → token; गलत password/अनजान email → वही 401 संदेश', async () => {
    await api().post('/admin/auth/login').send({ email: SUPER_EMAIL, password: 'WrongPass1234' }).expect(401);
    const non = await api().post('/admin/auth/login').send({ email: 'kaun@unknown.example', password: 'Whatever12345' }).expect(401);
    expect(non.body.message).toContain('गलत');
    const ok = await api().post('/admin/auth/login').send({ email: SUPER_EMAIL, password: 'SuperSecret123' }).expect(201);
    expect(ok.body.token).toBeDefined();
    expect(ok.body.admin.role).toBe('SUPER_ADMIN');
    superLogin = ok.body.token;
    const sup = await api().post('/admin/auth/login').send({ email: SUPPORT_EMAIL, password: 'SupportSecret1' }).expect(201);
    expect(sup.body.admin.role).toBe('SUPPORT');
    supportLogin = sup.body.token;
  });

  it('GET /admin/me — ताज़ा भूमिका दिखती है', async () => {
    const me = await SUPER().get('/admin/me').expect(200);
    expect(me.body.admin.role).toBe('SUPER_ADMIN');
  });

  /* ----------------------------- role matrix ----------------------------- */
  it('SUPPORT: shops read ✓, approve ✗ 403, admins ✗ 403, policy patch ✗ 403 (read ✓)', async () => {
    const list = await as(supportLogin).get('/admin/shops?queue=1').expect(200);
    expect(list.body.items.some((s: any) => s.id === shopId)).toBe(true);
    await as(supportLogin).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'APPROVED' }).expect(403);
    await as(supportLogin).get('/admin/admins').expect(403);
    await as(supportLogin).get('/admin/policies').expect(200);
    await as(supportLogin).patch('/admin/policies/commission_default_pct')
      .send({ value: 9 }).expect(403);
  });

  it('बिना token → 401; भूत admin id (admin_users में नहीं) → 401', async () => {
    await api().get('/admin/dashboard').expect(401);
    const jwt = require('jsonwebtoken');
    const ghostToken = jwt.sign({ sub: '99999999-9999-4999-8999-999999999999', ad: 'ghost@x.y', rl: 'SUPER_ADMIN' },
      process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
    await as(String(ghostToken)).get('/admin/dashboard').expect(401);
  });

  /* ----------------------------- shop workflow --------------------------- */
  it('dashboard counts दिखते हैं (दुकान + शिकायत टुकड़े)', async () => {
    const d = await as(supportLogin).get('/admin/dashboard').expect(200);
    expect(d.body.shops).toHaveProperty('pending');
    expect(d.body.shops).toHaveProperty('total');
    expect(d.body.shops.total).toBeGreaterThanOrEqual(d.body.shops.pending);
    expect(d.body.complaints).toHaveProperty('open');
    expect(d.body.orders).toHaveProperty('today');
    expect(typeof d.body.orders.today).toBe('number');
  });

  it('REJECT बिना कारण 400; कारण के साथ REJECTED; दुबारा REJECT 409', async () => {
    await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'REJECTED' }).expect(400);
    const r = await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'REJECTED', reason: 'पता अधूरा है' }).expect(200);
    expect(r.body.status).toBe('REJECTED');
    expect(r.body.reason).toContain('अधूरा');
    expect(r.body.published).toBe(false);
    await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'REJECTED', reason: 'फिर' }).expect(409);
    await api().get(`/shops/${slug}/public`).expect(404);
  });

  it('merchant resubmit (REJECTED → PENDING) → approve → auto-publish → public ✓', async () => {
    await as(merchantToken).post(`/shops/${shopId}/submit-for-approval`).send({}).expect(201);
    const ok = await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'APPROVED' }).expect(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.published).toBe(true);
    await api().get(`/shops/${slug}/public`).expect(200);
  });

  it('approve-पर-approve 409; SUSPEND → public ग़ायब; UNSUSPEND → वापस', async () => {
    await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'APPROVED' }).expect(409);
    const su = await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'SUSPENDED', reason: 'कोड जाँच' }).expect(200);
    expect(su.body.status).toBe('SUSPENDED');
    await api().get(`/shops/${slug}/public`).expect(404);
    const un = await as(superLogin || superToken).patch(`/admin/shops/${shopId}/status`)
      .send({ status: 'UNSUSPENDED' }).expect(200);
    expect(un.body.status).toBe('APPROVED');
    await api().get(`/shops/${slug}/public`).expect(200);
  });

  it('auto_publish_on_approve=false पर approve/unsuspend छिपा रहता है; publish switch से public', async () => {
    const S = () => as(superLogin || superToken);
    try {
      await S().patch('/admin/policies/auto_publish_on_approve').send({ value: false }).expect(200);
      await S().patch(`/admin/shops/${shopId}/status`)
        .send({ action: 'SUSPEND', reason: 'policy-check' }).expect(200);
      const un = await S().patch(`/admin/shops/${shopId}/status`)
        .send({ action: 'UNSUSPEND' }).expect(200);
      expect(un.body.status).toBe('APPROVED');
      expect(un.body.published).toBe(false);
      await api().get(`/shops/${slug}/public`).expect(404);

      const pub = await S().patch(`/admin/shops/${shopId}/publish`).send({ published: true }).expect(200);
      expect(pub.body.published).toBe(true);
      await api().get(`/shops/${slug}/public`).expect(200);

      // दोबारा वही हाल → no-op (idempotent)
      const again = await S().patch(`/admin/shops/${shopId}/publish`).send({ published: true }).expect(200);
      expect(again.body.unchanged).toBe(true);
    } finally {
      await S().patch('/admin/policies/auto_publish_on_approve').send({ value: true }).expect(200);
      await S().patch(`/admin/shops/${shopId}/publish`).send({ published: true }).expect(200);
    }
  });

  it('shop_status_history में पूरा इतिहास (SUBMIT/REJECT/APPROVE/SUSPEND/UNSUSPEND)', async () => {
    const d = await as(superLogin || superToken).get(`/admin/shops/${shopId}`).expect(200);
    const actions = d.body.history.map((h: any) => h.action);
    for (const a of ['SUBMIT', 'REJECT', 'APPROVE', 'SUSPEND', 'UNSUSPEND']) {
      expect(actions).toContain(a);
    }
    expect(String(d.body.history[0].adminEmail || '')).toContain('@');
  });

  /* ------------------------------ complaints ------------------------------ */
  it('ग्राहक ऑर्डर token से शिकायत → OPEN; admin + SUPPORT दोनों की list में', async () => {
    const prod = await as(merchantToken).post('/products')
      .send({ name: 'चीनी 1 किलो', unit: '1 किलो', price: 50, stock: 10 }).expect(201);
    const order = await api().post('/public/shops/' + slug + '/checkout').send({
      items: [{ productId: prod.body.id, qty: 1 }],
      customer: { name: 'शिकायती ग्राहक', phone: '9876500000' },
      address: 'शिकायत वाली गली', fulfilment: 'DELIVERY', paymentMode: 'COD',
    }).set('Idempotency-Key', 'admin-e2e-cmp-1').expect(201);
    orderPublicToken = order.body.order.publicToken;

    const c = await api().post(`/public/orders/${orderPublicToken}/complaint`)
      .send({ category: 'DELIVERY', body: 'डिलीवरी लंबी खिंची, दो घंटे देर हो गई।' }).expect(201);
    expect(c.body.complaint.status).toBe('OPEN');
    complaintId = c.body.complaint.id;

    const sup = await as(supportLogin).get('/admin/complaints?status=OPEN&limit=20').expect(200);
    const row = sup.body.items.find((x: any) => x.id === complaintId);
    expect(row).toBeTruthy();
    expect(row.shopSlug).toBe(slug);
  });

  it('गलत order token पर शिकायत 404', async () => {
    await api().post('/public/orders/na-tandan-na-token/complaint')
      .send({ category: 'OTHER', body: 'यह शिकायत किसी ऑर्डर से नहीं जुड़ेगी।' }).expect(404);
  });

  it('शिकायत OPEN→IN_PROGRESS→RESOLVED(नोट ज़रूरी)→REOPEN→CLOSED; आगे 409', async () => {
    const started = await as(supportLogin).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'START' }).expect(201);
    expect(started.body.status).toBe(ComplaintStatus.IN_PROGRESS);
    expect(started.body.assignedTo).toBeTruthy(); // सपोर्ट ख़ुद को ही ले सकता है

    // RESOLVE बिना नोट → 400 (नियम ज़रूरी)
    await as(supportLogin).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'RESOLVE' }).expect(400);
    const resolved = await as(supportLogin).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'RESOLVE', note: 'ग्राहक से बात हुई, दुकान ने देरी स्वीकारी।' }).expect(201);
    expect(resolved.body.status).toBe(ComplaintStatus.RESOLVED);

    const reopened = await as(supportLogin).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'REOPEN' }).expect(201);
    expect(reopened.body.status).toBe(ComplaintStatus.IN_PROGRESS);

    await as(supportLogin).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'RESOLVE', note: 'फिर हल — रिफ़ंड विंडो का नियम बताया।' }).expect(201);
    const closed = await as(superLogin || superToken).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'CLOSE' }).expect(201);
    expect(closed.body.status).toBe(ComplaintStatus.CLOSED);

    const detail = await as(superLogin || superToken).get(`/admin/complaints/${complaintId}`).expect(200);
    expect(detail.body.history.length).toBeGreaterThanOrEqual(5);
    expect(detail.body.allowedActions.length).toBe(0); // CLOSED terminal — कुछ मान्य नहीं

    await as(superLogin || superToken).post(`/admin/complaints/${complaintId}/status`)
      .send({ action: 'REOPEN' }).expect(409);
    const note = await as(superLogin || superToken).post(`/admin/complaints/${complaintId}/note`)
      .send({ body: 'सारांश सेव किया।', isInternal: true }).expect(201);
    expect(note.body.body).toContain('सारांश');
  });

  /* ------------------------------- policies ------------------------------ */
  it('policies: seeded सूची; SUPER patch ✓; बेतुका मान 400; अज्ञात key 400', async () => {
    const before = await as(supportLogin).get('/admin/policies').expect(200);
    expect(before.body.map((p: any) => p.key)).toContain('commission_default_pct');
    await as(superLogin || superToken).patch('/admin/policies/commission_default_pct').send({ value: 12 }).expect(200);
    await as(superLogin || superToken).patch('/admin/policies/commission_default_pct').send({ value: 999 }).expect(400);
    await as(superLogin || superToken).patch('/admin/policies/not_a_key').send({ value: 1 }).expect(400);
    const after = await as(supportLogin).get('/admin/policies').expect(200);
    expect(after.body.find((p: any) => p.key === 'commission_default_pct').value.value).toBe(12);
  });

  /* ---------------------- admin orders + commissions ---------------------- */
  it('admin orders read-only overview + commission summary/save (role-guarded)', async () => {
    const S = () => as(superLogin || superToken);
    const list = await as(supportLogin).get('/admin/orders?limit=10').expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body).toHaveProperty('total');
    await as(supportLogin).get('/admin/orders?status=NOT_A_STATUS').expect(400);

    // SUPPORT ऑर्डर पढ़ सकता है, कमीशन नहीं
    await as(supportLogin).get('/admin/commissions').expect(403);
    const c = await S().get('/admin/commissions').expect(200);
    expect(typeof c.body.defaultPct).toBe('number');
    expect(Array.isArray(c.body.shops)).toBe(true);

    const put = await S().put('/admin/commissions').send({ defaultPct: 6.5 }).expect(200);
    expect(put.body.value.value).toBe(6.5);
    await S().put('/admin/commissions').send({ defaultPct: 99 }).expect(400);
    await S().put('/admin/commissions').send({ defaultPct: 12 }).expect(200);
  });

  it('audit log में आज के admin काम दिखते हैं', async () => {
    const a = await as(superLogin || superToken).get('/admin/audit?limit=50').expect(200);
    const actions = a.body.map((r: any) => r.action);
    for (const x of ['SHOP_APPROVE', 'SHOP_REJECT', 'SHOP_SUSPEND', 'POLICY_UPDATE', 'ADMIN_LOGIN']) {
      expect(actions).toContain(x);
    }
  });
});
