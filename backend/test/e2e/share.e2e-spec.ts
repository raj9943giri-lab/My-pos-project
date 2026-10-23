/* PART 6 — सार्वजनिक लिंक/शेयर/OG integration flow.
 *
 * NOTE (honesty): यह DB पर चलता है — बिना DATABASE_URL/JWT_SECRET के खुद-ब-खुद
 * SKIP हो जाता है (नीचे describe.skip), इसलिए बिना-DB के सिर्फ़ unit से बाकी supply.
 * Local PostgreSQL + .env के बाद: `npm run test:e2e`.
 *
 * जाँचें:
 *   - GET /shops/:id/share-info → मर्चेंट ही (दूसरी दुकान का token 403)
 *   - public URL सर्वर-configured origin से बनता है (device से नहीं)
 *   - GET /public/shops/:slug/metadata → सिर्फ़ published; unpublished/draft 404
 */
const run = !!process.env.DATABASE_URL && !!process.env.JWT_SECRET;

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { seedE2EAdmin, e2eAdminToken } from './helpers';

(process.env.DATABASE_URL ? describe : describe.skip)('shop share & OG metadata (integration)', () => {
  let app: INestApplication;
  let merchantToken = '';
  let strangerToken = '';
  let shopId = '';
  const slug = 'share-e2e-' + Math.floor(Math.random() * 100000);
  const draftSlug = 'draft-e2e-' + Math.floor(Math.random() * 100000);

  const pub = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(90000);
    const modRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    async function mkUser(name: string): Promise<string> {
      const phone = '8555' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      await pub().post('/auth/register').send({ name, phone }).expect(201);
      const req = await pub().post('/auth/otp/request').send({ phone }).expect(201);
      const ver = await pub().post('/auth/otp/verify').send({ phone, code: req.body.devCode }).expect(201);
      return String(ver.body.token);
    }

    merchantToken = await mkUser('शेयर ई२ई मालिक');
    strangerToken = await mkUser('दूसरे मुहल्ले का दुकानदार');

    const shopRes = await pub().post('/shops')
      .set('Authorization', 'Bearer ' + merchantToken)
      .send({
        name: 'शेयर टेस्ट किराना', slug,
        categoryIds: ['grocery'], whatsapp: '+919876543210',
        address: 'टेस्ट गली', pin: '232101',
      }).expect(201);
    shopId = shopRes.body.id;

    // एक दूसरी दुकान भी (stranger का — draft रहेगी; इसका metadata कभी नहीं मिलेगा)
    await pub().post('/shops')
      .set('Authorization', 'Bearer ' + strangerToken)
      .send({
        name: 'ड्राफ़्ट दुकान', slug: draftSlug,
        categoryIds: ['grocery'], whatsapp: '+919876543211',
        address: 'ड्राफ़्ट गली', pin: '232101',
      }).expect(201);

    await pub().post(`/shops/${shopId}/submit-for-approval`)
      .set('Authorization', 'Bearer ' + merchantToken).send({}).expect(201);

    const adminSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
    await seedE2EAdmin(app.get(DbService));
    await pub().patch(`/admin/shops/${shopId}/status`)
      .set('Authorization', 'Bearer ' + e2eAdminToken(adminSecret))
      .send({ status: 'APPROVED' }).expect((r) => [200, 201].includes(r.status));
  });

  afterAll(async () => { await app.close(); });

  it('share-info मर्चेंट को public URL + टेम्पलेट संदेश देता है (published दुकान)', async () => {
    const res = await pub().get(`/shops/${shopId}/share-info`)
      .set('Authorization', 'Bearer ' + merchantToken).expect(200);
    expect(res.body.shop.slug).toBe(slug);
    expect(res.body.shareable).toBe(true);
    expect(res.body.publicUrl).toContain('/s/' + slug);
    expect(res.body.publicUrl.startsWith('https://')).toBe(true);
    // हिंदी संदेश: नाम और URL ठीक-ठीक एक-एक बार
    expect(res.body.shareText).toContain('शेयर टेस्ट किराना');
    expect(res.body.shareText.split(slug).length - 1).toBe(1);
    // OG: default image fallback (कवर अपलोड नहीं किया) + canonical
    expect(res.body.og.url).toBe(res.body.publicUrl);
    expect(String(res.body.og.image).endsWith('og-default.png')).toBe(true);
    expect(res.body.og.twitterCard).toBe('summary');
    // privacy: पता/नंबर/लाइसेंस/आईडी share-info में कभी नहीं
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('टेस्ट गली');
    expect(body).not.toContain('9876543210');
    expect(body).not.toContain(shopId);
  });

  it('share-info दूसरी दुकान के token पर 403 (ownership जाँच)', async () => {
    await pub().get(`/shops/${shopId}/share-info`)
      .set('Authorization', 'Bearer ' + strangerToken).expect(403);
  });

  it('share-info बिना token → 401', async () => {
    await pub().get(`/shops/${shopId}/share-info`).expect(401);
  });

  it('published दुकान का /public/shops/:slug/metadata साफ़ metadata देता है', async () => {
    const res = await pub().get(`/public/shops/${slug}/metadata`).expect(200);
    expect(res.body.metadata.canonicalUrl).toContain('/s/' + slug);
    expect(res.body.metadata.og.title).toBe('शेयर टेस्ट किराना');
    expect(res.body.metadata.twitter.card).toBe('summary');
    expect(JSON.stringify(res.body)).not.toContain('9876543210');
  });

  it('draft दुकान का metadata 404 — draft/publish-न-हुई कभी exposed नहीं', async () => {
    await pub().get(`/public/shops/${draftSlug}/metadata`).expect(404);
    await pub().get(`/public/shops/${draftSlug}`).expect(404);
  });

  it('अजीब slug भी 404 ही देता है (injection-friendly इनपुट पर कुछ नहीं बनता)', async () => {
    await pub().get('/public/shops/' + encodeURIComponent('%3E%3Cscript%3E') + '/metadata').expect(404);
  });
});
