import { DbService } from '../db/db.service';
import { SlugService } from './slug.service';
import { Injectable } from '@nestjs/common';
import { CreateShopDto, UpdateShopDto } from './dto';
import { Http400, Http403, Http404, Http409 } from '../common/http-errors';
import { normalizeE164 } from '../common/phone';
import { env } from '../config/env';
import { ShopStatus } from '../common/roles';
import { buildShareText, ogFor, publicShopUrl, sanitizePublicText, shareEligibility } from '../share/share';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/* नए कॉलम (Part 2): whatsapp_number, business_phone, license_no, description,
 * lat, lng, pickup_enabled, delivery_enabled, approval_status, published …
 * approval/published सिर्फ़ admin endpoint से बदलते हैं (सुरक्षा नियम). */
const FORBIDDEN_CLIENT_FIELDS = ['approval_status', 'approvalStatus', 'published'];

@Injectable()
export class ShopsService {
  constructor(private db: DbService, private slug: SlugService) {}

  /* ------------------------------- create -------------------------------- */
  async create(userId: string, dto: CreateShopDto) {
    const slugCheck = await this.slug.check(dto.slug);
    if (!slugCheck.available) {
      throw Http409('दुसरी दुकान इसी slug की मालकिन है', { slug: slugCheck.slug, suggestions: slugCheck.suggestions });
    }
    await this.assertCategoryRules(dto.categoryIds, dto.licenseNo);

    const user = await this.db.one<{ id: string; name: string; phone: string }>(
      'SELECT id, name, phone FROM users WHERE id = $1', [userId]);
    if (!user) throw Http404('आपका अकाउंट नहीं मिला');

    const catNames = await this.categoryNamesByIds(dto.categoryIds);
    if (!dto.whatsapp && !dto.businessPhone) throw Http400('कम-से-कम एक नंबर (WhatsApp या business phone) ज़रूरी है');

    const catEmoji = (await this.db.one<{ emoji: string }>(
      'SELECT emoji FROM shop_categories WHERE id = $1', [dto.categoryIds[0]]))?.emoji || '🏪';

    const shop = await this.db.one<any>(
      `INSERT INTO shops
         (owner_name, owner_phone, shop_name, slug, categories, emoji,
          address, pincode, open_time, close_time, is_open, status, rating, about,
          whatsapp_number, business_phone, license_no, description,
          pickup_enabled, delivery_enabled, lat, lng, approved_user_id, approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,
               $7,$8,$9,$10,TRUE,'PENDING',0,$11,
               $12,$13,$14,$15,
               $16,$17,$18,$19,$20,'DRAFT')
       RETURNING *`,
      [
        user.name || '', user.phone, dto.name.trim(), dto.slug, catNames, dto.emoji || catEmoji,
        dto.address || null, dto.pin || null, dto.openTime || '07:00', dto.closeTime || '22:00',
        dto.description || null,
        dto.whatsapp || null, dto.businessPhone || null, dto.licenseNo || null, dto.description || null,
        dto.pickup !== false, dto.delivery !== false, dto.lat ?? null, dto.lng ?? null, user.id,
      ]);

    await this.db.query(
      "INSERT INTO shop_members (shop_id, user_id, role) VALUES ($1, $2, 'OWNER')", [shop.id, userId]);
    await this.db.query(
      `INSERT INTO shop_business_hours (shop_id, dow, open_time, close_time, is_closed)
       SELECT $1, d, $2, $3, FALSE FROM generate_series(0, 6) AS d`,
      [shop.id, dto.openTime || '07:00', dto.closeTime || '22:00']);
    return shop;
  }

  /* ------------------------------ validation ----------------------------- */
  async assertCategoryRules(categoryIds: string[], licenseNo?: string) {
    if (!categoryIds || !categoryIds.length) throw Http400('कम से कम एक व्यवसाय चुनें');
    const rows = await this.db.query<{ id: string; license_required: boolean }>(
      'SELECT id, license_required FROM shop_categories WHERE id = ANY($1::varchar[]) AND is_active', [categoryIds]);
    if (rows.length !== new Set(categoryIds).size) throw Http400('अवैध कैटेगरी चुनी गई');
    if (rows.some((r) => r.license_required) && !licenseNo) {
      throw Http400('इस व्यवसाय के लिए लाइसेंस नंबर ज़रूरी है');
    }
  }

  async categoryNamesByIds(ids: string[]): Promise<string[]> {
    const rows = await this.db.query<{ name: string }>(
      'SELECT name FROM shop_categories WHERE id = ANY($1::varchar[]) ORDER BY sort_order', [ids]);
    return rows.map((r) => r.name);
  }

  /* ----------------------------- membership ------------------------------ */
  private async memberRole(userId: string, shopId: string): Promise<string | null> {
    const m = await this.db.one<{ role: string }>(
      'SELECT role FROM shop_members WHERE shop_id = $1 AND user_id = $2', [shopId, userId]);
    return m?.role || null;
  }

  /* -------------------------------- read -------------------------------- */
  async my(userId: string) {
    return this.db.one(
      `SELECT s.* FROM shops s
       JOIN shop_members m ON m.shop_id = s.id
       WHERE m.user_id = $1 AND m.role = 'OWNER'
       ORDER BY s.created_at LIMIT 1`, [userId]);
  }

  /** किसी भी member (STAFF भी) देख सकता है; OWNER बदल सकता है. */
  async getById(userId: string, id: string) {
    const shop = await this.db.one('SELECT * FROM shops WHERE id = $1', [id]);
    if (!shop) throw Http404('दुकान नहीं मिली');
    const role = await this.memberRole(userId, id);
    if (!role) throw Http403('यह दुकान आपकी नहीं है');
    return shop;
  }

  /* ------------------------------- update -------------------------------- */
  async update(userId: string, id: string, dto: UpdateShopDto, rawBody?: Record<string, unknown>) {
    await this.getById(userId, id);
    if (await this.memberRole(userId, id) !== 'OWNER') throw Http403('सिर्फ़ OWNER बदल सकता है');
    if (rawBody && FORBIDDEN_CLIENT_FIELDS.some((f) => f in rawBody)) {
      throw Http400('approval_status / published बदलना सर्वर की ज़िम्मेदारी है');
    }
    const cur = await this.db.one<{ slug: string; license_no: string }>(
      'SELECT slug, license_no FROM shops WHERE id = $1', [id]);
    if (dto.slug && dto.slug !== cur!.slug) {
      const chk = await this.slug.check(dto.slug, { excludeShopId: id });
      if (!chk.available) throw Http409('यह slug दूसरी दुकान का है', { suggestions: chk.suggestions });
    }
    if (dto.categoryIds) await this.assertCategoryRules(dto.categoryIds, dto.licenseNo || cur!.license_no);

    const sets: string[] = [];
    const vals: any[] = [];
    const add = (col: string, v: any) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
    if (dto.name !== undefined) add('shop_name', dto.name.trim());
    if (dto.slug !== undefined) add('slug', dto.slug);
    if (dto.categoryIds !== undefined) add('categories', await this.categoryNamesByIds(dto.categoryIds));
    if (dto.licenseNo !== undefined) add('license_no', dto.licenseNo);
    if (dto.address !== undefined) add('address', dto.address);
    if (dto.pin !== undefined) add('pincode', dto.pin);
    if (dto.lat !== undefined) add('lat', dto.lat);
    if (dto.lng !== undefined) add('lng', dto.lng);
    if (dto.whatsapp !== undefined) add('whatsapp_number', dto.whatsapp ? normalizeE164(dto.whatsapp) : null);
    if (dto.businessPhone !== undefined) add('business_phone', dto.businessPhone ? normalizeE164(dto.businessPhone) : null);
    if (dto.description !== undefined) { add('description', dto.description); add('about', dto.description); }
    if (dto.openTime !== undefined) add('open_time', dto.openTime);
    if (dto.closeTime !== undefined) add('close_time', dto.closeTime);
    if (dto.pickup !== undefined) add('pickup_enabled', dto.pickup);
    if (dto.delivery !== undefined) add('delivery_enabled', dto.delivery);
    if (dto.emoji !== undefined) add('emoji', dto.emoji);
    if (!sets.length) return this.db.one('SELECT * FROM shops WHERE id = $1', [id]);
    add('updated_at', new Date());
    await this.db.query(`UPDATE shops SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return this.db.one('SELECT * FROM shops WHERE id = $1', [id]);
  }

  /* --------------------------- approval workflow -------------------------- */
  async submitForApproval(userId: string, id: string) {
    const shop = await this.getById(userId, id);
    if (await this.memberRole(userId, id) !== 'OWNER') throw Http403('सिर्फ़ OWNER submit कर सकता है');
    // APPROVED (या पुरानी PUBLISHED वैल्यू) वाली दुकान फिर नहीं भेजती.
    if (shop.approval_status === ShopStatus.APPROVED || shop.approval_status === 'PUBLISHED') {
      throw Http400('दुकान पहले से अप्रूव्ड है');
    }
    // SUSPENDED दुकान admin UNSUSPEND से ही वापस आती है — merchant submit रास्ता नहीं.
    if (shop.approval_status === ShopStatus.SUSPENDED) {
      throw Http400('दुकान सस्पेंड है — admin से संपर्क करें');
    }
    if (!shop.whatsapp_number && !shop.business_phone) throw Http400('प्रोफ़ाइल में कोई नंबर नहीं');
    if (!shop.address) throw Http400('प्रोफ़ाइल में पता डालें');
    const ids = await this.categoryIdsOf(shop);
    if (ids.length) {
      const catRows = await this.db.query<{ license_required: boolean }>(
        'SELECT license_required FROM shop_categories WHERE id = ANY($1::varchar[])', [ids]);
      if (catRows.some((c) => c.license_required) && !shop.license_no) {
        throw Http400('लाइसेंस नंबर प्रोफ़ाइल में डालें');
      }
    }
    const updated = await this.db.one(
      `UPDATE shops SET approval_status = $2, submitted_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`, [id, ShopStatus.PENDING]);
    // SUBMIT भी status-history में जाता है (merchant actor) — admin panel इतिहास दिखाता है.
    await this.db.query(
      `INSERT INTO shop_status_history (shop_id, from_status, to_status, action, actor_user_id)
       VALUES ($1, $2, $3, 'SUBMIT', $4)`,
      [id, shop.approval_status, ShopStatus.PENDING, userId]);
    return updated;
  }

  private async categoryIdsOf(shop: any): Promise<string[]> {
    const names: string[] = shop.categories || [];
    if (!names.length) return [];
    return (await this.db.query<{ id: string }>(
      'SELECT id FROM shop_categories WHERE name = ANY($1)', [names])).map((r) => r.id);
  }

  /* ------------------------------- public -------------------------------- */
  /** GET /shops/:slug/public — सिर्फ़ APPROVED + published; private fields कभी नहीं. */
  async publicBySlug(slug: string) {
    const shop = await this.db.one(
      `SELECT s.id, s.shop_name AS name, s.slug, s.emoji, s.address, s.pincode,
              COALESCE(s.description, s.about) AS description,
              s.open_time AS "openTime", s.close_time AS "closeTime",
              s.logo_url AS "logoUrl", s.cover_url AS "coverUrl",
              s.is_open AS "isOpen", s.pickup_enabled AS pickup, s.delivery_enabled AS delivery
       FROM shops s
       WHERE s.slug = $1 AND s.approval_status = 'APPROVED' AND s.published = TRUE`, [slug]);
    if (!shop) throw Http404('सार्वजनिक दुकान नहीं मिली (अप्रूव्ड दुकानें यहाँ दिखती नहीं)');
    const og = ogFor(shop, env.PUBLIC_SHOP_ORIGIN, env.MEDIA_URL_BASE, !this.isDevEnv());
    return {
      shop,
      og,
      note: 'WhatsApp हर मैसेज में लिंक-प्रीव्यू दिखने की गारंटी नहीं देता।',
    };
  }

  private isDevEnv(): boolean {
    return env.NODE_ENV !== 'production';
  }

  /**
   * PART 6 — GET /shops/:shopId/share-info (auth member).
   * मर्चेंट की दुकान का public URL + अप्रूव्ड संदेश + OG. सिर्फ़ public फ़ील्ड
   * (पता/फ़ोन/लाइसेंस/आईडी कभी नहीं); अप्रूव्ड-न-हुई दुकान भी अपना हाल देख सकती है —
   * पर `shareable:false` + हिंदी कारण के साथ (झूठे "लाइव है" दावे नहीं).
   */
  async shareInfo(userId: string, shopId: string) {
    const role = await this.memberRole(userId, shopId);
    if (!role) throw Http403('यह दुकान आपकी नहीं है');
    const shop = await this.db.one(
      `SELECT s.id, s.shop_name AS name, s.slug, s.emoji,
              COALESCE(s.description, s.about) AS description,
              s.approval_status AS "approvalStatus", s.published,
              s.logo_url AS "logoUrl", s.cover_url AS "coverUrl"
       FROM shops s WHERE s.id = $1`, [shopId]);
    if (!shop) throw Http404('दुकान नहीं मिली');
    if (!shop.slug) throw Http400('दुकान का slug नहीं बना — प्रोफ़ाइल सेव करें');

    const isProd = !this.isDevEnv();
    const url = publicShopUrl(env.PUBLIC_SHOP_ORIGIN, shop.slug, isProd);
    const og = ogFor(shop, env.PUBLIC_SHOP_ORIGIN, env.MEDIA_URL_BASE, isProd);
    const eligibility = shareEligibility(shop.approvalStatus, shop.published);
    const shareText = buildShareText(env.SHARE_TEXT_TEMPLATE, shop.name, url);
    return {
      shop: {
        name: sanitizePublicText(shop.name, 80),
        slug: shop.slug,
        emoji: shop.emoji || '🏪',
        status: shop.approvalStatus,
        published: !!shop.published,
      },
      publicUrl: url,
      shareText,
      og,
      shareable: eligibility.shareable,
      notShareableReason: eligibility.reason,
      note: 'WhatsApp प्रीव्यू कैश हो सकता है और हर चैट में दिखने की गारंटी नहीं; "भेज दिया" की पुष्टि सिर्फ़ WhatsApp खुद दिखाता है.',
    };
  }

  /* -------------------------------- media -------------------------------- */
  async addMedia(userId: string, id: string, file: Express.Multer.File | undefined, kindRaw: string) {
    if (await this.memberRole(userId, id) !== 'OWNER') throw Http403('सिर्फ़ OWNER मीडिया जोड़ सकता है');
    if (!(await this.db.one('SELECT id FROM shops WHERE id = $1', [id]))) throw Http404('दुकान नहीं मिली');

    const kind = String(kindRaw || '').toUpperCase();
    if (!['LOGO', 'COVER'].includes(kind)) throw Http400('kind LOGO ya COVER honi chahiye');
    if (!file) throw Http400('फ़ाइल नहीं मिली (field name must be "file")');
    if ((file.size || 0) === 0 || file.size > 3 * 1024 * 1024) throw Http400('इमेज साइज़ 3MB से कम');
    const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const b = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.alloc(0);
    // Magic bytes — सिर्फ़ Content-Type header पर भरोसा नहीं. WEBP में RIFF के
    // बाद offset 8 पर 'WEBP' भी ज़रूरी है (कोई भी RIFF file न चल जाए).
    const jpeg = b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    const png = b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    const webp = b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    const detected = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : '';
    if (!okMime || !detected || detected !== file.mimetype) {
      throw Http400('सिर्फ़ असली image/jpeg · png · webp (magic bytes मेल खाने चाहिए)');
    }
    if (b.length !== file.size) throw Http400('अपलोड अधूरा है — दोबारा भेजें');

    const dir = path.join(env.UPLOAD_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const ext = detected === 'image/png' ? '.png' : detected === 'image/webp' ? '.webp' : '.jpg';
    const fname = kind.toLowerCase() + '-' + crypto.randomBytes(8).toString('hex') + ext;
    fs.writeFileSync(path.join(dir, fname), b);
    const url = env.MEDIA_URL_BASE.replace(/\/+$/, '') + '/' + id + '/' + fname;

    await this.db.query(
      `INSERT INTO shop_media (shop_id, kind, url, mime, bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (shop_id, kind) DO UPDATE
         SET url = EXCLUDED.url, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes`,
      [id, kind, url, detected, b.length]);
    await this.db.query(
      kind === 'LOGO'
        ? 'UPDATE shops SET logo_url = $1, updated_at = now() WHERE id = $2'
        : 'UPDATE shops SET cover_url = $1, updated_at = now() WHERE id = $2',
      [url, id]);
    return { kind: kind.toLowerCase(), url };
  }
}
