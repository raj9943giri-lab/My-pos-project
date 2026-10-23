/* PART 5 — order lifecycle integration (accept → prepare → ready → transit →
 * delivered; reject/cancel की स्टॉक-वापसी ठीक एक बार; tenant isolation;
 * ग्राहक cancel via token).
 * NOTE (honesty): ye DB पर चलते हैं — बिना DATABASE_URL ke auto-SKIP, इसलिए
 * हर वातावरण में `npm test` (unit) पास हो. Local: postgres + .env, phir
 * `npm run test:e2e`. */
const run = !!process.env.DATABASE_URL && !!process.env.JWT_SECRET;

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { seedE2EAdmin, e2eAdminToken } from './helpers';

(process.env.DATABASE_URL ? describe : describe.skip)('orders API (integration)', () => {
  let app: INestApplication;
  let merchantToken = '';
  let adminToken = '';
  let shopId = '';
  let slug = 'order-shop-' + Math.floor(Math.random() * 100000);
  let orderId = '';
  let orderToken = '';

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(90000);
    const modRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // merchant + shop + admin approve (Part-2 flow reuse)
    const phone = '8111' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    await api().post('/auth/register').send({ name: 'ऑर्डर मालिक', phone }).expect(201);
    const req = await api().post('/auth/otp/request').send({ phone }).expect(201);
    const ver = await api().post('/auth/otp/verify').send({ phone, code: req.body.devCode }).expect(201);
    merchantToken = ver.body.token;
    /** supertest v7 — .set() verb चुनने के बाद ही मिलता है; Proxy हर call को verb-first बनाता है. */
    const auth = (): any => new Proxy({} as any, {
      get(_: unknown, verb: string) {
        return (url?: string) => {
          const req = (api() as any)[verb as string](url);
          return req.set('Authorization', 'Bearer ' + merchantToken);
        };
      },
    });

    const shopRes = await auth().post('/shops')
      .send({ name: 'ऑर्डर किराना', slug, categoryIds: ['grocery'], whatsapp: '+919876543210', address: 'बाज़ार रोड', pin: '232101' }).expect(201);
    shopId = shopRes.body.id;
    await auth().post(`/shops/${shopId}/submit-for-approval`).send({}).expect(201);
    // PART 7: RolesGuard admin_users से ताज़ा भूमिका पढ़ता है — पहले seeded row.
    await seedE2EAdmin(app.get(DbService));
    adminToken = e2eAdminToken(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
    await api().patch(`/admin/shops/${shopId}/status`)
      .set('Authorization', 'Bearer ' + adminToken).send({ status: 'APPROVED' }).expect((r) => [200, 201].includes(r.status));

    const prod = await auth().post('/products')
      .send({ name: 'चावल 1 किलो', unit: '1 किलो', price: 60, stock: 10 }).expect(201);
    const productA = prod.body.id;

    // दूसरी दुकान (isolation checking के लिए)
    const phone2 = '8222' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    await api().post('/auth/register').send({ name: 'अन्य दुकान', phone: phone2 }).expect(201);
    const req2 = await api().post('/auth/otp/request').send({ phone: phone2 }).expect(201);
    const ver2 = await api().post('/auth/otp/verify').send({ phone: phone2, code: req2.body.devCode }).expect(201);
    otherToken = ver2.body.token;
    const shop2 = await api().post('/shops').set('Authorization', 'Bearer ' + otherToken)
      .send({ name: 'दूसरी दुकान', slug: slug + 'b', categoryIds: ['grocery'], whatsapp: '+919876543211', address: 'अलग गली', pin: '232101' }).expect(201);
    otherShopId = shop2.body.id;

    // असली checkout (Part 4) — COD ऑर्डर, 2 × चावल
    const order = await api().post('/public/shops/' + slug + '/checkout')
      .send({
        items: [{ productId: productA, qty: 2 }],
        customer: { name: 'राम कुमार', phone: '9876543210' },
        address: 'गाँव का पता 123',
        fulfilment: 'DELIVERY',
        paymentMode: 'COD',
      })
      .set('Idempotency-Key', 'e2e-order-key-1').expect(201);
    orderId = String(order.body.order.id);
    orderToken = order.body.order.publicToken;
  });

  let otherToken = '';   // beforeAll में set होता; module-level let fine
  let otherShopId = '';

  afterAll(async () => { await app.close(); });

  const authM = (): any => new Proxy({} as any, {
    get(_: unknown, verb: string) {
      return (url?: string) => {
        const req = (api() as any)[verb as string](url);
        return req.set('Authorization', 'Bearer ' + merchantToken);
      };
    },
  });

  it('merchant सूची दिखती है; दूसरी दुकान अपने shopId से नहीं देख सकती', async () => {
    const res = await authM().get(`/shops/${shopId}/orders`).expect(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].number).toMatch(/^S-\d{6}$/);

    await api().get(`/shops/${otherShopId}/orders`)
      .set('Authorization', 'Bearer ' + otherToken).expect(200);

    // दूसरी दुकान का member पहली दुकान के ऑर्डर पर 404 (जो है ही नहीं उसके scope में)
    await api().get(`/shops/${otherShopId}/orders/${orderId}`)
      .set('Authorization', 'Bearer ' + otherToken).expect(404);
  });

  it('बिना token / बिना सदस्यता → 401/403', async () => {
    await api().get(`/shops/${shopId}/orders`).expect(401);
    await api().get(`/shops/${shopId}/orders`)
      .set('Authorization', 'Bearer ' + otherToken).expect(403);
  });

  it('accept → preparing → ready → out → delivered (placed OTP-free flow)', async () => {
    await authM().post(`/shops/${shopId}/orders/${orderId}/status`)
      .send({ action: 'START_PREPARING' }).expect(409);   // NEW से नहीं
    await authM().post(`/shops/${shopId}/orders/${orderId}/accept`).send({}).expect(201);
    await authM().post(`/shops/${shopId}/orders/${orderId}/status`)
      .send({ action: 'START_PREPARING' }).expect(201);
    await authM().post(`/shops/${shopId}/orders/${orderId}/status`)
      .send({ action: 'MARK_READY' }).expect(201);
    await authM().post(`/shops/${shopId}/orders/${orderId}/status`)
      .send({ action: 'OUT_FOR_DELIVERY' }).expect(201);
    const done = await authM().post(`/shops/${shopId}/orders/${orderId}/status`)
      .send({ action: 'COMPLETE' }).expect(201);
    expect(done.body.order.status).toBe('DELIVERED');
    expect(done.body.order.paymentStatus).toBe('PAID');   // COD नकद मिल गया

    // दोबारा complete → 409; स्टॉक दूबारा कम नहीं होता
    await authM().post(`/shops/${shopId}/orders/${orderId}/status`)
      .send({ action: 'COMPLETE' }).expect(409);

    const detail = await authM().get(`/shops/${shopId}/orders/${orderId}`).expect(200);
    // पहला row checkout का ही है (previous_status NULL = पहला, 'NEW') — migration 006 नियम
    expect(detail.body.history.map((h: any) => h.newStatus)).toEqual(
      ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'TRANSIT', 'DELIVERED']);
  });

  it('reject/cancel पर स्टॉक ठीक एक बार वापस आता है', async () => {
    // नया ऑर्डर (3 × चावल), फिर cancel — stock 10-2(delivered)+? => पहले 10 → sale 2 → 8; cancel 3 → 11 → दोबारा cancel 409 (8+3+4=14 नहीं होगा)
    const prod = await api().post('/products')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({ name: 'मसाला पैक', unit: '1 पैकेट', price: 30, stock: 7 }).expect(201);
    const order = await api().post('/public/shops/' + slug + '/checkout')
      .send({
        items: [{ productId: prod.body.id, qty: 3 }],
        customer: { name: 'श्याम', phone: '9812345678' },
        address: 'गली नंबर 2',
        fulfilment: 'DELIVERY',
        paymentMode: 'COD',
      }).expect(201);
    const oid = String(order.body.order.id);

    const cancelled = await authM().post(`/shops/${shopId}/orders/${oid}/cancel`)
      .send({ reason: 'सामान उपलब्ध नहीं है' }).expect(201);
    expect(cancelled.body.transition.previous).toBe('NEW');
    expect(cancelled.body.transition.next).toBe('CANCELLED');

    // दोबारा cancel → 409 और स्टॉक फिर नहीं जुड़ता (7 ही रहेगा)
    await authM().post(`/shops/${shopId}/orders/${oid}/cancel`)
      .send({ reason: 'फिर कोशिश' }).expect(409);
    const inv = await authM().get('/inventory/movements?productId=' + prod.body.id).expect(200);
    const returns = inv.body.items.filter((m: any) => m.kind === 'RETURN');
    expect(returns.length).toBe(1);
    expect(returns[0].after).toBe(7); // 7 - 3 (sale) + 3 (return) — ठीक एक बार

    const detail = await authM().get(`/shops/${shopId}/orders/${oid}`).expect(200);
    expect(detail.body.order.cancellationReason).toContain('उपलब्ध');
  });

  it('ग्राहक token से सूची/स्थिति देखता है, नया ऑर्डर रद्द कर सकता है (एक बार)', async () => {
    const prod = await api().post('/products')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({ name: 'चीनी 1 किलो', unit: '1 किलो', price: 44, stock: 5 }).expect(201);
    const order = await api().post('/public/shops/' + slug + '/checkout')
      .send({
        items: [{ productId: prod.body.id, qty: 1 }],
        customer: { name: 'गीता', phone: '9700000001' },
        address: 'पुराना बाज़ार',
        fulfilment: 'PICKUP',
        paymentMode: 'PON',
      }).expect(201);
    const tok = order.body.order.publicToken;

    const view = await api().get('/public/orders/' + tok).expect(200);
    expect(view.body.order.canCancel).toBe(true);
    expect(view.body.history.map((h: any) => h.status)).toEqual(['NEW']);

    // merchant accept → अब ग्राहक रद्द नहीं कर सकता
    await authM().post(`/shops/${shopId}/orders/${String(order.body.order.id)}/accept`).send({}).expect(201);
    await api().get('/public/orders/' + tok).expect(200)
      .then((res) => { expect(res.body.order.canCancel).toBe(false); });
    await api().post('/public/orders/' + tok + '/cancel').send({ reason: 'बदले मन' }).expect(409);

    // नया नया ऑर्डर → NEW ग्राहक रद्द करे — ठीक एक बार
    const order2 = await api().post('/public/shops/' + slug + '/checkout')
      .send({
        items: [{ productId: prod.body.id, qty: 2 }],
        customer: { name: 'गीता', phone: '9700000001' },
        address: 'पुराना बाज़ार',
        fulfilment: 'DELIVERY',
        paymentMode: 'COD',
      }).expect(201);
    const tok2 = order2.body.order.publicToken;
    await api().post('/public/orders/' + tok2 + '/cancel').send({ reason: 'शिपिंग मोल-भाव न हुआ' }).expect((r) => [200, 201].includes(r.status));
    await api().post('/public/orders/' + tok2 + '/cancel').send({}).expect(409);
    await api().get('/public/orders/' + tok2).expect(200)
      .then((res) => {
        expect(res.body.order.status).toBe('CANCELLED');
        expect(res.body.order.cancellationReason).toContain('शिपिंग');
        expect(res.body.history.some((h: any) => h.status === 'CANCELLED')).toBe(true);
      });
  });

  it('notifications ऐप (in-app इतिहास) merchant के लिए बनता है पर दूसरी दुकान के नहीं', async () => {
    // outbox drain production में main.ts का 20s scheduler चलाता है;
    // e2e app में scheduler नहीं होता, तो उसी drain() को वैसे ही manually बुलाते हैं.
    const { NotificationsService } = require('../../src/notifications/notifications.service');
    await app.get(NotificationsService).drain(20);
    const res = await authM().get('/notifications').expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toHaveProperty('body');
    const other = await api().get('/notifications').set('Authorization', 'Bearer ' + otherToken).expect(200);
    // दूसरी दुकान को पहली दुकान के ऑर्डर नंबर का कोई नोटिफिकेशन नहीं (आइसोलेशन)
    expect(other.body.items.some((n: any) => String(n.ref_id) === orderId)).toBe(false);
  });
});
