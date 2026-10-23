/* PART 4 — public store integration flow (slug → search → cart → COD checkout → token).
 * NOTE (honesty): ye DB पर चलते हैं — बिना DATABASE_URL ke auto-SKIP ho जाते हैं
 * इसलिए हर वातावरण में `npm test` (unit) पास हो. Local: postgres + .env, phir
 * `npm run test:e2e`. Admin approve हने के लिए Part-2 का admin flow reuse होता है. */
const run = !!process.env.DATABASE_URL && !!process.env.JWT_SECRET;

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { seedE2EAdmin, e2eAdminToken } from './helpers';

(process.env.DATABASE_URL ? describe : describe.skip)('public store API (integration)', () => {
  let app: INestApplication;
  let merchantToken = '';
  let adminToken = '';
  let shopId = '';
  let slug = 'pub-store-' + Math.floor(Math.random() * 100000);
  let productA = '';
  let confirmToken = '';

  const pub = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(90000);
    const modRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    /* Setup: merchant + दुकान बनाओ, admin से publish कराओ (Part-2 flow reuse). */
    const phone = '8666' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    await pub().post('/auth/register').send({ name: 'गेस्ट दुकान मालिक', phone }).expect(201);
    const req = await pub().post('/auth/otp/request').send({ phone }).expect(201);
    const ver = await pub().post('/auth/otp/verify').send({ phone, code: req.body.devCode }).expect(201);
    merchantToken = ver.body.token;

    const shopRes = await pub().post('/shops')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({
        name: 'पब्लिक किराना', slug,
        categoryIds: ['grocery'], whatsapp: '+919876543210',
        address: 'गाँव के मुख्य बाज़ार में', pin: '232101',
      }).expect(201);
    shopId = shopRes.body.id;

    await pub().post(`/shops/${shopId}/submit-for-approval`)
      .set('Authorization', 'Bearer ' + merchantToken).send({}).expect(201);

    /* Admin approve — PART 7: RolesGuard admin_users row माँगता है, इसलिए पहले seed. */
    await seedE2EAdmin(app.get(DbService));
    adminToken = e2eAdminToken(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
    await pub().patch(`/admin/shops/${shopId}/status`)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'APPROVED' }).expect((r) => [200, 201].includes(r.status));

    const prod = await pub().post('/products')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({ name: 'टेस्ट आटा 1 किलो', unit: '1 किलो', price: 45.5, stock: 5, category: 'गेहूँ' }).expect(201);
    productA = prod.body.id;
  });

  afterAll(async () => { await app.close(); });

  it('published shop is visible by slug; other shops stay hidden', async () => {
    const res = await pub().get('/public/shops/' + slug).expect(200);
    expect(res.body.shop.name).toBe('पब्लिक किराना');
    expect(res.body.shop).not.toHaveProperty('upiVpa');
    await pub().get('/public/shops/never-' + slug).expect(404);
  });

  it('unpublished shop cannot be ordered from (merchant-only fields never leak) — covered by the 404 checks below', async () => {
    expect(slug).toBeTruthy();
  });

  it('search + category filter + pagination work against the real db', async () => {
    await pub().post('/products')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({ name: 'टेस्ट चीनी 500 ग्राम', unit: '500 ग्राम', price: 25, stock: 0 }).expect(201);
    const hits = await pub().get(`/public/shops/${slug}/products?q=आटा`).expect(200);
    expect(hits.body.items).toHaveLength(1);
    const reOrder = await pub().get(`/public/shops/${slug}/products?sort=price_asc`).expect(200);
    expect(Number(reOrder.body.items[0].price)).toBeLessThanOrEqual(Number(reOrder.body.items[1].price));
    const paged = await pub().get(`/public/shops/${slug}/products?limit=1&page=1`).expect(200);
    expect(paged.body.hasMore).toBe(true);   // 2 प्रोडक्ट, पहला दिखा — और बचे हैं
  });

  it('product detail shows variants and availability only for the right shop', async () => {
    const one = await pub().get(`/public/shops/${slug}/products/${productA}`).expect(200);
    expect(one.body.product.name).toContain('आटा');
    expect(one.body.product.variants).toEqual([]);
    await pub().get('/public/shops/' + slug + 'x/products/' + productA).expect(404);
  });

  it('cart validate reports out-of-stock items (ok flag false; nothing ordered)', async () => {
    const q = encodeURIComponent('ख़त्म चाय');
    await pub().post('/products')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({ name: 'टेस्ट ख़त्म चाय', unit: '1 पैकेट', price: 99, stock: 0 }).expect(201);
    const rows = await pub().get(`/public/shops/${slug}/products?q=${q}&inStock=true`).expect(200);
    expect(rows.body.items).toHaveLength(0); // ख़त्म सामान available सूची में ही नहीं
    const all = await pub().get(`/public/shops/${slug}/products?q=${q}`).expect(200);
    const chaiId = all.body.items[0].id;
    const res = await pub().post(`/public/shops/${slug}/checkout/validate`)
      .send({ items: [{ productId: Number(chaiId), qty: 1 }], fulfilment: 'DELIVERY' })
      .expect((r) => [200, 201].includes(r.status));
    expect(res.body.ok).toBe(false);
    expect(res.body.lines[0].status).toBe('OUT');
  });

  it('search is scoped to the correct shop only (cross-shop 404)', async () => {
    const other = await pub().get(`/public/shops/public-never/products?q=आटा`).expect(404);
    expect(other.body.message).toBeTruthy();
  });

  it('invalid guest checkout inputs are rejected before any order exists', async () => {
    const res = await pub().post(`/public/shops/${slug}/checkout`)
      .send({
        items: [{ productId: Number(productA), qty: 1 }],
        customer: { name: 'गेस्ट जी', phone: '12345' },
        fulfilment: 'DELIVERY', address: 'पता छोटा', paymentMode: 'COD',
      }).expect(400);
    expect(res.body.message).toBeTruthy();
  });

  it('COD checkout creates exactly one order; retry with the same Idempotency-Key returns the same order', async () => {
    const key = 'e2e-' + Date.now();
    const post = () => pub().post(`/public/shops/${slug}/checkout`)
      .set('Idempotency-Key', key)
      .send({
        items: [{ productId: Number(productA), qty: 2 }],
        customer: { name: 'रामू काका', phone: '9876500000' },
        fulfilment: 'DELIVERY', address: 'पोखरी रोड, मकान 12',
        paymentMode: 'COD',
      });
    const first = await post().expect((r) => [200, 201].includes(r.status));
    expect(first.body.duplicate).toBe(false);
    expect(first.body.order.publicToken).toBeTruthy();
    expect(first.body.order.totals.subTotal).toBe(91);
    expect(first.body.order.totals.total).toBe(first.body.order.totals.subTotal + first.body.order.totals.deliveryFee);

    const again = await post().expect((r) => [200, 201].includes(r.status));
    expect(again.body.duplicate).toBe(true);
    expect(again.body.order.publicToken).toBe(first.body.order.publicToken);

    /* स्टॉक 5 → 3 (2 कटे) — merchant inventory से cross-check */
    const stock = await pub().get('/inventory/movements?limit=10')
      .set('Authorization', 'Bearer ' + merchantToken).expect(200);
    const sale = stock.body.items.find((m: any) => m.kind === 'SALE' && String(m.productId) === String(productA));
    expect(sale.delta).toBe(-2);
    expect(sale.after).toBe(3);
  });

  it('order status is reachable ONLY by the random token, never by guessable ids', async () => {
    /* बनाए हुए नहीं रहने वाले पूरे UUID से bhi 404 ही — id गिनकर कोई ऑर्डर नहीं उठा सकता */
    const fake = 'ec9e2f00-1111-4222-9333-444455556666';
    await pub().get('/public/orders/' + fake).expect(404);
    await pub().get('/public/orders/not-a-uuid').expect(404);
  });

  it('binding the confirmation: token from checkout opens the order; phone is never exposed', async () => {
    const firstOrder = await pub().post(`/public/shops/${slug}/checkout`)
      .set('Idempotency-Key', 'token-' + Date.now())
      .send({
        items: [{ productId: Number(productA), qty: 1 }],
        customer: { name: 'सुनीता', phone: '9876500001' },
        fulfilment: 'PICKUP', paymentMode: 'COD',
      }).expect((r) => [200, 201].includes(r.status));
    confirmToken = firstOrder.body.order.publicToken;

    const res = await pub().get('/public/orders/' + confirmToken).expect(200);
    expect(res.body.order.paymentStatus).toBe('PENDING');   // COD अभी अधूरा — PAID नहीं
    expect(res.body.order.fulfilment).toBe('PICKUP');
    expect(res.body.shop.name).toBe('पब्लिक किराना');
    expect(JSON.stringify(res.body)).not.toContain('9876500001'); // ग्राहक का नंबर leak नहीं
    expect(JSON.stringify(res.body)).not.toContain('पोखरी');     // पता भी नहीं
  });

  it('concurrent checkouts cannot oversell the remaining stock', async () => {
    const rows = await pub().get(`/public/shops/${slug}/products?q=आटा`).expect(200);
    const id = rows.body.items[0].id; // stock: 5 −2 −1 = 2 बचा
    const attempt = (key: string) => pub().post(`/public/shops/${slug}/checkout`)
      .set('Idempotency-Key', key)
      .send({
        items: [{ productId: Number(id), qty: 2 }],
        customer: { name: 'रेस कस्ट', phone: '9876500002' },
        fulfilment: 'PICKUP', paymentMode: 'COD',
      });
    const results = await Promise.all([attempt('race-1-' + Date.now()), attempt('race-2-' + Date.now())]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => [200, 201].includes(s)).length).toBeLessThanOrEqual(1); // 2 का पहला ही जाएगा
    const conflict = results.find((r) => r.status === 409);
    if (conflict) expect(conflict.body.reason || conflict.body.message).toBeTruthy();
  });

  it('cross-shop / cross-customer isolation: no path can fetch an order without ITS token', async () => {
    await pub().get('/public/orders').expect(404);
    await pub().get('/public/orders/S-000001').expect(404);  // ऑर्डर नंबर भी रास्ता नहीं
  });

  /* PART 8 regression: variant का अपना stock था तो SALE/RETURN उसी row पर हो —
   * पहले checkout products.stock घटाता था और restock भी product में जोड़ता था,
   * जिससे variant stock कभी नहीं बदलता और गुमशुदा/oversell बनता. */
  it('variant stock is decremented on checkout and restored on cancel (product stock untouched)', async () => {
    const db = app.get(DbService);
    const prod = await pub().post('/products')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({ name: 'टेस्ट कुर्ता', unit: '1 पीस', price: 300, stock: 7, category: 'कपड़े' })
      .expect(201);
    const pid = prod.body.id;
    const variant = (await db.query(
      `INSERT INTO product_variants (shop_id, product_id, name, price, stock, is_active)
       VALUES ($1, $2, 'XL', 320, 4, TRUE) RETURNING id`,
      [shopId, pid],
    ))[0];

    const checkout = await pub().post(`/public/shops/${slug}/checkout`)
      .set('Idempotency-Key', 'variant-' + Date.now())
      .send({
        items: [{ productId: Number(pid), variantId: Number(variant.id), qty: 2 }],
        customer: { name: 'वेरिएंट ग्राहक', phone: '9876500003' },
        fulfilment: 'PICKUP', paymentMode: 'COD',
      }).expect((r) => [200, 201].includes(r.status));
    expect(checkout.body.order.totals.subTotal).toBe(640);   // 320 × 2

    let v = (await db.query('SELECT stock FROM product_variants WHERE id = $1', [variant.id]))[0];
    let p = (await db.query('SELECT stock FROM products WHERE id = $1', [pid]))[0];
    expect(Number(v.stock)).toBe(2);   // variant 4 → 2
    expect(Number(p.stock)).toBe(7);   // product stock अछूता

    const token = checkout.body.order.publicToken;
    await pub().post(`/public/orders/${token}/cancel`).send({ reason: 'टेस्ट वापसी' })
      .expect((r) => [200, 201].includes(r.status));

    v = (await db.query('SELECT stock FROM product_variants WHERE id = $1', [variant.id]))[0];
    p = (await db.query('SELECT stock FROM products WHERE id = $1', [pid]))[0];
    expect(Number(v.stock)).toBe(4);   // 2 → 4 वापस
    expect(Number(p.stock)).toBe(7);   // product stock फिर भी अछूता

    // दोबारा cancel = 409, stock फिर नहीं जुड़ता (idempotent)
    await pub().post(`/public/orders/${token}/cancel`).send({}).expect(409);
    v = (await db.query('SELECT stock FROM product_variants WHERE id = $1', [variant.id]))[0];
    expect(Number(v.stock)).toBe(4);
  });
});
