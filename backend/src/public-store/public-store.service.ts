import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Http400, Http404, Http409 } from '../common/http-errors';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { customerCanCancel } from '../orders/order-lifecycle';
import { CartValidateDto, CheckoutDto, PublicProductQueryDto } from './dto';
import {
  applyCoupon, cleanIdempotencyKey, computeTotals, CouponResult, CouponRow,
  deliveryFeeFor, Fulfilment, lineStatus, normalizeGuestPhone, orderNumber,
  PaymentMode, sanitizeItems, ServerLine,
} from './checkout';
import { env } from '../config/env';
import { buildShareText, ogFor, sanitizePublicText } from '../share/share';

/**
 * PART 4 — customer storefront backend.
 *
 * हर product request slug वाली published दुकान (approval_status='APPROVED'
 * AND published) तक scoped है; private merchant data कभी निकलता नहीं. Order
 * के पैसे सिर्ज़ server गिनता है (browser के totals झुठलाए जाते हैं), stock
 * कटौती + movement log एक transaction में, और दोबारा tap/retry से डुप्लिकेट
 * order Idempotency-Key + unique index दोनों से रोके जाते हैं.
 */
@Injectable()
export class PublicStoreService {
  constructor(
    private db: DbService,
    private logs: InventoryService,
    private orders: OrdersService,           // PART 5: shared वापसी (restock)
    private notifs: NotificationsService,    // PART 5: outbox enqueue
  ) {}

  /* ------------------------------ shop ----------------------------------- */

  /** हमेशा published दुकान — दूसरों (DRAFT/PENDING/APPROVED-unpublished) यहाँ नहीं दिखतीं. */
  private async publishedShop(slug: string): Promise<any | null> {
    return this.db.one(
      `SELECT s.id, s.shop_name AS name, s.slug, s.emoji, s.description, s.about,
              s.address, s.pincode, s.logo_url AS "logoUrl", s.cover_url AS "coverUrl",
              s.is_open AS "isOpen", s.is_accepting_orders AS "accepting",
              s.open_time AS "openTime", s.close_time AS "closeTime",
              s.whatsapp_number AS "whatsapp", s.business_phone AS "businessPhone",
              s.delivery_enabled AS delivery, s.pickup_enabled AS pickup,
              s.cod_enabled AS "codEnabled", s.pon_enabled AS "ponEnabled",
              s.upi_vpa AS "upiVpa", s.min_order::float8 AS "minOrder",
              COALESCE(ds.delivery_on, s.delivery_enabled)  AS "deliveryOn",
              COALESCE(ds.fee, 20)::float8                  AS "deliveryFeeCfg",
              COALESCE(ds.free_above, 499)::float8          AS "freeAboveCfg",
              COALESCE(ds.note, '')                         AS "etaNote"
         FROM shops s
         LEFT JOIN delivery_settings ds ON ds.shop_id = s.id
        WHERE s.slug = $1 AND s.approval_status = 'APPROVED' AND s.published = TRUE
        LIMIT 1`,
      [String(slug).toLowerCase()],
    );
  }

  private async requireShop(slug: string): Promise<any> {
    const shop = await this.publishedShop(slug);
    if (!shop) throw Http404('सार्वजनिक दुकान नहीं मिली');
    return shop;
  }

  /** GET /public/shops/:slug — public data only (privacy: VPA मास्क फ्लैग बनता है). */
  async shopSummary(slug: string) {
    const s = await this.requireShop(slug);
    const contact = s.whatsapp || s.businessPhone || null;
    return {
      shop: {
        name: s.name,
        slug: s.slug,
        emoji: s.emoji,
        description: s.description || s.about || null,
        address: s.address,
        pincode: s.pincode,
        logoUrl: s.logoUrl,
        coverUrl: s.coverUrl,
        openTime: s.openTime,
        closeTime: s.closeTime,
        isOpen: !!s.isOpen,
        acceptingOrders: !!s.accepting && !!s.isOpen,
        contact,
        delivery: !!s.delivery && !!s.deliveryOn,
        pickup: !!s.pickup,
        minOrder: Number(s.minOrder) || 0,
        etaNote: s.etaNote || null,
        paymentMethods: this.paymentMethods(s, null),
      },
      og: this.ogOf(s),
      note: 'WhatsApp हर मैसेज में लिंक-प्रीव्यू दिखने की गारंटी नहीं देता।',
    };
  }

  /**
   * PART 6 — साझा OG builder (share/share.ts): absolute image + safe default,
   * साफ़ किया title/description, canonical URL. published दुकान ही यहाँ आती है.
   */
  private ogOf(s: { name: unknown; description?: unknown; about?: unknown; slug: string; logoUrl?: unknown; coverUrl?: unknown }) {
    return ogFor(s, env.PUBLIC_SHOP_ORIGIN, env.MEDIA_URL_BASE, env.NODE_ENV === 'production');
  }

  /**
   * PART 6 — GET /public/shops/:slug/metadata — क्रॉलर/फ्रंटएंड के लिए safe
   * metadata JSON. published दुकान ही मिलेगी (404 वरना); कोई private फ़ील्ड नहीं.
   */
  async publicMetadata(slug: string) {
    const s = await this.requireShop(slug);
    const og = this.ogOf(s);
    return {
      slug: s.slug,
      metadata: {
        pageTitle: og.title,
        metaDescription: og.description,
        canonicalUrl: og.url,
        og,
        twitter: {
          card: og.twitterCard,
          title: og.title,
          description: og.description,
          image: og.image,
          imageAlt: og.imageAlt,
        },
      },
      note: 'WhatsApp/Facebook क्रॉलर पहले HTML response का og:* पढ़ते हैं — customer-web SSR में यही metadata server-side render होता है. प्रीव्यू दिखने की गारंटी प्लेटफ़ॉर्म खुद तय करता है.',
    };
  }

  /** दुकान के सच में चालू पेमेंट तरीके — gateway configured नहीं है तो UPI नहीं दिखेगा. */
  private paymentMethods(s: any, fulfilment: Fulfilment | null): PaymentMode[] {
    const modes: PaymentMode[] = [];
    if (s.codEnabled) modes.push('COD');
    if (fulfilment !== 'DELIVERY' || fulfilment === null) {
      if (s.ponEnabled) modes.push('PON');
    }
    if (s.upiVpa) modes.push('UPI_QR');
    return fulfilment === 'DELIVERY' ? modes.filter((m) => m !== 'PON') : modes;
  }

  /* --------------------------- categories / products ---------------------- */

  /** GET /public/shops/:slug/categories — सिर्फ़ available प्रोडक्ट वाली कैटेगरी. */
  async categories(slug: string) {
    const shop = await this.requireShop(slug);
    const rows = await this.db.query(
      `SELECT pc.id::text AS id, pc.name, pc.emoji,
              COUNT(p.id) FILTER (WHERE p.is_active AND p.stock > 0)::int AS available
         FROM product_categories pc
         LEFT JOIN products p ON p.category_id = pc.id
        WHERE pc.shop_id = $1
        GROUP BY pc.id, pc.name, pc.emoji, pc.sort_order
        ORDER BY pc.sort_order, pc.name`,
      [shop.id],
    );
    return { shop: shop.slug, items: rows.filter((r: any) => r.available > 0) };
  }

  /** पब्लिक प्रोडक्ट shape — low_at जैसी merchant-only fields यहाँ नहीं रहती. */
  private static PRODUCT_COLUMNS = `
    p.id::text                        AS id,
    p.name                            AS name,
    p.unit                            AS unit,
    p.price::float8                   AS price,
    p.mrp::float8                     AS mrp,
    p.stock                           AS stock,
    p.photo_url                       AS "photoUrl",
    p.brand                           AS brand,
    p.fresh_note                      AS fresh,
    p.life_note                       AS life,
    pc.id::text                       AS "categoryId",
    COALESCE(pc.name, '')             AS "category"`;

  async listProducts(slug: string, q: PublicProductQueryDto) {
    const shop = await this.requireShop(slug);
    const query = q || ({} as PublicProductQueryDto);

    const where: string[] = ['p.shop_id = $1', 'p.is_active'];
    const vals: any[] = [shop.id];

    if (query.inStock === 'true' || query.inStock === '1') where.push('p.stock > 0');

    if (query.categoryId) {
      vals.push(query.categoryId);
      where.push(`p.category_id = $${vals.length}::bigint`);
    }

    const term = (query.q || '').trim();
    if (term) {
      vals.push('%' + term + '%');
      where.push(`(p.name ILIKE $${vals.length} OR COALESCE(p.brand, '') ILIKE $${vals.length})`);
    }

    const sort =
      query.sort === 'price_asc' ? 'p.price ASC, p.name ASC'
      : query.sort === 'price_desc' ? 'p.price DESC, p.name ASC'
      : 'p.name ASC';

    const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 50);
    const page = Math.min(Math.max(Number(query.page) || 1, 1), 500);
    vals.push(limit, (page - 1) * limit);

    const totalRow = await this.db.one<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total
         FROM products p
        WHERE ${where.join(' AND ')}`,
      vals.slice(0, -2),
    );
    const total = Number(totalRow?.total || 0);

    const items = await this.db.query(
      `SELECT ${PublicStoreService.PRODUCT_COLUMNS}
         FROM products p
         LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${sort}
        LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    );

    return { shop: shop.slug, items, page, limit, total, hasMore: page * limit < total };
  }

  /** GET /public/shops/:slug/products/:id — product + उसके variants (cross-shop रोका). */
  async productBySlug(shopSlug: string, pid: string) {
    const shop = await this.requireShop(shopSlug);
    const id = Number(String(pid).replace(/\D/g, ''));
    if (!id) throw Http404('प्रोडक्ट नहीं मिला');
    const row = await this.db.one<any>(
      `SELECT ${PublicStoreService.PRODUCT_COLUMNS}
         FROM products p
         LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE p.id = $1 AND p.shop_id = $2 AND p.is_active`,
      [id, shop.id],
    );
    if (!row) throw Http404('प्रोडक्ट नहीं मिला');
    const variants = await this.db.query(
      `SELECT v.id::text AS id, v.name, v.price::float8 AS price, v.stock
         FROM product_variants v
        WHERE v.product_id = $1 AND v.is_active
        ORDER BY v.sort_order, v.id`,
      [id],
    );
    return { shop: shop.slug, product: { ...row, available: row.stock > 0, variants } };
  }

  /* ------------------------------ cart check ------------------------------ */

  /** Server-side line build — price/stock केवल DB से; browser की कीमतों पर भरोसा नहीं.
   *  ⚠ lock=true सिर्फ़ उसी tx के `q` पर चलाएँ — pool से FOR UPDATE का lock फौरन छूट जाता है
   *    (oversell रेस). `dq` न देने पर pool (जैसे validate/quote पाठ). */
  private async buildLines(shopId: string, rawItems: any[], lock: boolean, dq?: DbService['query']): Promise<ServerLine[]> {
    const items = sanitizeItems(rawItems);
    if (!items.length) throw Http400('कार्ट खाली है');
    const Q: DbService['query'] = dq ?? ((sql, params) => this.db.query(sql, params));

    const ids = Array.from(new Set(items.map((i) => i.productId)));
    const products = await Q<any>(
      `SELECT p.id, p.name, p.unit, p.price::float8 AS price, p.stock, p.is_active
         FROM products p
        WHERE p.shop_id = $1 AND p.id = ANY($2::bigint[])
        ${lock ? 'FOR UPDATE' : ''}`,
      [shopId, ids],
    );
    const vIds = items.filter((i) => i.variantId).map((i) => i.variantId as number);
    const variants = vIds.length
      ? await Q<any>(
          `SELECT v.id, v.product_id, v.name, v.price::float8 AS price, v.stock, v.is_active
             FROM product_variants v
            WHERE v.id = ANY($1::bigint[])
            ${lock ? 'FOR UPDATE' : ''}`,
          [vIds],
        )
      : [];
    const byId = new Map<string, any>(products.map((p: any) => [String(p.id), p]));
    const vById = new Map<string, any>(variants.map((v: any) => [String(v.id), v]));
    return items.map((it) => {
      const p = byId.get(String(it.productId));
      const variant = it.variantId ? vById.get(String(it.variantId)) : null;

      let name = '', unitPrice = 0, stock = 0, isActive = false, variantName: string | null = null;
      let stockSource: 'PRODUCT' | 'VARIANT' = 'PRODUCT';
      if (p) {
        const belongsWithShop = variant ? variant.product_id === p.id : true;
        isActive = !!p.is_active && belongsWithShop && (!variant || variant.is_active);
        name = p.name;
        unitPrice = variant?.price ?? (Number(p.price) || 0);
        // variant.stock NULL = product.stock ही चलेगा (Part-4 design).
        if (variant && variant.stock !== null && variant.stock !== undefined) {
          stock = variant.stock;
          stockSource = 'VARIANT';
        } else {
          stock = p.stock;
          stockSource = 'PRODUCT';
        }
        variantName = variant?.name || null;
      }
      const { status, qty } = lineStatus(it.qty, Number(stock) || 0, isActive, !!p, unitPrice);
      return {
        productId: it.productId,
        variantId: variant?.id ?? null,
        name: p ? name : '',
        variantName,
        unit: p?.unit || '',
        qty,
        unitPrice: Number(unitPrice) || 0,
        lineTotal: Math.round((Number(unitPrice) || 0) * qty * 100) / 100,
        stock: Number(stock) || 0,
        stockSource,
        status,
      };
    });
  }

  /** कूपन — lock=true भी tx के `q` के साथ ही (row-lock रेस से). FOR UPDATE आख़िरी clause. */
  private async couponByCode(shopId: string, codeRaw: string, lock: boolean, dq?: DbService['query']): Promise<CouponRow | null> {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!code) return null;
    const Q: DbService['query'] = dq ?? ((sql, params) => this.db.query(sql, params));
    const rows = await Q<CouponRow>(
      `SELECT code, kind, value::float8 AS value, min_subtotal::float8 AS min_subtotal,
              max_discount::float8 AS max_discount, times_used, max_uses, is_active, expires_at
         FROM shop_coupons
        WHERE shop_id = $1 AND upper(code) = $2
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}`,
      [shopId, code],
    );
    return rows[0] || null;
  }

  private fulfilmentOf(shop: any, dto: { fulfilment?: string }): Fulfilment {
    const f: Fulfilment = dto.fulfilment === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
    if (f === 'DELIVERY' && !(shop.delivery && shop.deliveryOn)) {
      throw Http400('यह दुकान अभी डिलीवरी नहीं देती');
    }
    if (f === 'PICKUP' && !shop.pickup) {
      throw Http400('यह दुकान अभी पिकअप नहीं देती');
    }
    return f;
  }

  private async summaryFor(
    shop: any,
    dto: { items: any[]; couponCode?: string; fulfilment?: string },
    coupon: CouponRow | null,
  ) {
    const lines = await this.buildLines(shop.id, dto.items, false);
    const fulfilment = this.fulfilmentOf(shop, dto);
    const subTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const applied = applyCoupon(coupon, subTotal);
    if (coupon && !applied.ok) {
      throw Http400('कूपन लागू नहीं होगा: ' + this.couponReason(applied.reason), { couponReason: applied.reason });
    }
    const deliveryFee = deliveryFeeFor(
      { deliveryOn: !!shop.deliveryOn, fee: Number(shop.deliveryFeeCfg), freeAbove: Number(shop.freeAboveCfg) },
      fulfilment,
      subTotal,
    );
    const totals = computeTotals(lines, applied.ok ? applied.amount : 0, deliveryFee);
    const minOrder = Number(shop.minOrder) || 0;
    return { lines, fulfilment, coupon: applied, totals, minOrder };
  }

  private couponReason(r: string): string {
    return r === 'COUPON_MIN_ORDER' ? 'न्यूनतम रकम पूरी नहीं हुई'
      : r === 'COUPON_EXPIRED' ? 'कूपन अवधि समाप्त'
      : r === 'COUPON_USED_UP' ? 'कूपन सीमा पूरी'
      : r === 'COUPON_INACTIVE' ? 'कूपन बंद है' : 'कूपन अवैध';
  }

  /** POST /public/shops/:slug/checkout/validate — cart हर आदेश से पहले सर्वर से जाँचा. */
  async validateCart(slug: string, dto: CartValidateDto) {
    const shop = await this.requireShop(slug);
    const coupon = dto.couponCode ? await this.couponByCode(shop.id, dto.couponCode, false) : null;
    if (dto.couponCode && !coupon) throw Http400('यह कूपन इस दुकान का नहीं है');

    const s = await this.summaryFor(shop, dto, coupon);
    const problems = s.lines.some((l) => l.status !== 'OK');
    const minMet = s.totals.subTotal >= s.minOrder;

    return {
      shop: shop.slug,
      fulfilment: s.fulfilment,
      lines: s.lines,
      coupon: s.coupon.ok ? { code: s.coupon.code, amount: s.coupon.amount } : null,
      totals: s.totals,
      delivery: {
        available: !!shop.delivery && !!shop.deliveryOn,
        etaNote: shop.etaNote || null,
        feeRule: { fee: Number(shop.deliveryFeeCfg), freeAbove: Number(shop.freeAboveCfg) },
      },
      pickup: !!shop.pickup,
      minOrder: { value: s.minOrder, met: minMet },
      acceptOrders: !!shop.accepting && !!shop.isOpen,
      ok: !problems && minMet && !!shop.accepting && !!shop.isOpen,
    };
  }

  /* ------------------------------ checkout -------------------------------- */

  /**
   * POST /public/shops/:slug/checkout — असली order.
   *
   * - Transaction: products FOR UPDATE → हिसाब → order + items insert →
   *   stock कटौती → SALE movement log — सब एक ही COMMIT/ROLLBACK में.
   * - Idempotency-Key: वही key दोबारा आई तो उसी order की झलक वापस (duplicate flag);
   *   दो समांतर रिक्वेस्ट के रेस को unique index (23505) पकड़ता है.
   */
  async createOrder(slug: string, dto: CheckoutDto, idemKeyHeader: unknown) {
    const idemKey = cleanIdempotencyKey(idemKeyHeader);
    if (idemKeyHeader && !idemKey) throw Http400('Idempotency-Key header अवैध है');

    const shop = await this.requireShop(slug);

    if (!shop.accepting || !shop.isOpen) {
      throw Http409('दुकान अभी ऑर्डर नहीं ले रही — थोड़ी देर में कोशिश करें', { reason: 'SHOP_NOT_ACCEPTING' });
    }

    const fulfillment = this.fulfilmentOf(shop, dto);
    const available = this.paymentMethods(shop, fulfillment);
    if (!available.includes(dto.paymentMode)) {
      throw Http400('यह पेमेंट तरीका इस दुकान में चालू नहीं है', { available });
    }

    // गेस्ट कस्टमर जाँच (नंबर normal E.164 बनता है; address डिलीवरी पर ज़रूरी)
    const cust = normalizeGuestPhone(dto.customer?.phone || '');
    if (!cust.ok) {
      throw Http400(cust.reason === 'PHONE_REQUIRED' ? 'मोबाइल नंबर डालें' : 'मोबाइल नंबर गलत है');
    }
    const name = String(dto.customer?.name || '').trim();
    if (name.length < 2 || name.length > 60) throw Http400('ग्राहक का नाम सही डालें');

    const address = fulfillment === 'DELIVERY' ? String(dto.address || '').trim() : '';
    if (fulfillment === 'DELIVERY' && address.length < 6) {
      throw Http400('डिलीवरी का पता डालें (कम से कम 6 अक्षर)');
    }
    const landmark = String(dto.landmark || '').trim().slice(0, 120) || null;
    const instructions = String(dto.instructions || '').trim().slice(0, 200) || null;

    const coupon = dto.couponCode ? await this.couponByCode(shop.id, dto.couponCode, false) : null;
    if (dto.couponCode && !coupon) throw Http400('यह कूपन इस दुकान का नहीं है');

    // डुप्लिकेट fast-path: वही key पहले से पूरा order बना चुकी हो
    if (idemKey) {
      const dup = await this.duplicateBy(shop.id, idemKey);
      if (dup) return dup;
    }

    try {
      const created = await this.db.tx(async (q) => {
        // 1) product rows लॉक करके नई हाल से हिसाब (यहाँ फिर से MAX_QTY तक)
        //    lock इसी tx के q पर — pool पर होता तो रेस में oversell हो जाता.
        const lines = await this.buildLines(shop.id, dto.items, true, q);
        const subTotal = lines.reduce((s, l) => s + l.lineTotal, 0);

        const deliveryFee = deliveryFeeFor(
          { deliveryOn: !!shop.deliveryOn, fee: Number(shop.deliveryFeeCfg), freeAbove: Number(shop.freeAboveCfg) },
          fulfillment, subTotal);

        // 2) कूपन row-lock के साथ जाँच (use-count रेस से सुरक्षित)
        let applied: CouponResult = { ok: true, code: '', amount: 0 };
        if (coupon) {
          const lockedCoupon = await this.couponByCode(shop.id, coupon.code, true, q);
          applied = applyCoupon(lockedCoupon, subTotal);
          if (!applied.ok) {
            throw Http400('कूपन लागू नहीं होगा: ' + this.couponReason(applied.reason), { couponReason: applied.reason });
          }
        }
        const totals = computeTotals(lines, applied.ok ? applied.amount : 0, deliveryFee);

        const minOrder = Number(shop.minOrder) || 0;
        if (totals.subTotal < minOrder) {
          throw Http400(`न्यूनतम ऑर्डर ₹${minOrder} — कार्ट छोटा है`, { reason: 'MIN_ORDER' });
        }

        // 3) स्टॉक/एक्टिविटी अंतिम जाँच — कोई भी रुकावट हो तो 409 + नई हाल
        const bad = lines.filter((l) => l.status !== 'OK' || l.qty <= 0);
        if (bad.length) {
          throw Http409(
            'स्टॉक/कीमत बदली है — कार्ट की नई हाल देखकर दोबारा भेजें',
            { reason: 'CART_CONFLICT', lines, totals },
          );
        }

        // 4) ग्राहक (per-shop, नाम अपडेट) — tx के q पर ही, पूरा order-ack एक साथ rollback
        const customer = (await q<{ id: string }>(
          `INSERT INTO customers (shop_id, name, phone)
           VALUES ($1, $2, $3)
           ON CONFLICT (shop_id, phone) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [shop.id, name, cust.phone],
        ))[0];

        // 5) order row (public_token का DEFAULT gen_random_uuid)
        const order = await q<any>(
          `INSERT INTO orders
             (shop_id, customer_id, status, pay_mode, payment_status, fulfilment,
              customer_name, customer_phone, addr, landmark, delivery_instructions,
              sub_total, delivery_fee, discount, coupon_code, total, idempotency_key)
           VALUES ($1,$2,'NEW',$3,'PENDING',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id, public_token::text AS "publicToken", placed_at`,
          [
            shop.id, customer?.id || null, dto.paymentMode, fulfillment,
            name, cust.phone,
            fulfillment === 'DELIVERY' ? address : null,
            landmark, instructions,
            totals.subTotal, totals.deliveryFee, totals.discount,
            applied.ok && applied.code ? applied.code : null,
            totals.total, idemKey,
          ],
        ).then((rows: any[]) => rows[0]);

        // 6) items (नाम/यूनिट snapshot) + स्टॉक कटौती + SALE movement log
        for (const l of lines) {
          if (l.qty <= 0) continue;
          await q(
            `INSERT INTO order_items (order_id, product_id, product_name, unit, qty, unit_price, variant_id, variant_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [order.id, l.productId, l.name, l.unit, l.qty, l.unitPrice, l.variantId, l.variantName],
          );
          const before = Math.round(Number(l.stock));
          const after = before - l.qty;
          if (l.stockSource === 'VARIANT' && l.variantId) {
            // Variant का अपना stock है — उसी row से काटो, product.stock नहीं.
            await q(
              `UPDATE product_variants SET stock = $1
                WHERE id = $2 AND product_id = $3`,
              [after, l.variantId, l.productId],
            );
          } else {
            await q(
              `UPDATE products SET stock = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
              [after, l.productId, shop.id],
            );
          }
          await this.logs.log(q, {
            shopId: shop.id,
            productId: l.productId,
            kind: 'SALE',
            delta: -l.qty,
            before,
            after,
            note: 'order ' + orderNumber(order.id) + (l.variantName ? ' · ' + l.variantName : ''),
          });
        }

        // 7) कूपन इस्तेमाल गिनी गई
        if (coupon && applied.ok) {
          await q(
            'UPDATE shop_coupons SET times_used = times_used + 1 WHERE shop_id = $1 AND code = $2',
            [shop.id, (coupon as CouponRow).code],
          );
        }

        // 8) PART 5 — पहला status-history row (NEW) ताकि ग्राहक की टाइमलाइन
        //     बनने से ही शुरू हो, और नया ऑर्डर का notification outbox में (यही tx;
        //     COMMIT के बाद ही दुकानदार को जाएगा — in-app इतिहास + FCM अगर configured)
        await q(
          `INSERT INTO order_status_history (order_id, previous_status, new_status)
           VALUES ($1, NULL, 'NEW')`,
          [order.id],
        );
        await this.notifs.enqueue(q, {
          event: 'ORDER_NEW',
          orderId: order.id,
          shopId: shop.id,
          orderNumber: orderNumber(order.id),
          totals: { total: totals.total },
        });

        return { order, totals, fulfillment, coupon: applied };
      });

      const { order, totals, fulfillment: f, coupon: applied } = created;
      return {
        duplicate: false,
        order: {
          id: order.id,
          number: orderNumber(order.id),
          publicToken: order.publicToken,
          status: 'NEW',
          paymentStatus: 'PENDING',
          paymentMode: dto.paymentMode,
          fulfilment: f,
          etaNote: fulfilledNote(shop, f),
          totals,
          coupon: applied.ok && applied.code ? { code: applied.code, amount: applied.amount } : null,
          placedAt: order.placed_at,
          upiVpa: dto.paymentMode === 'UPI_QR' ? shop.upiVpa : null,
          shop: { name: shop.name, slug: shop.slug, contact: shop.whatsapp || shop.businessPhone || null },
        },
      };
    } catch (e: any) {
      // रेस: दूसरी कॉपी बिच में आ गई → 23505 (shop+idempotency) → वही order वापस
      if (String(e?.code || '') === '23505' && idemKey) {
        const dup = await this.duplicateBy(shop.id, idemKey);
        if (dup) return dup;
      }
      throw e;
    }
  }

  /** उसी (shop, idempotency_key) वाले पिछले order की public झलक. */
  private async duplicateBy(shopId: string, idemKey: string): Promise<any | null> {
    const found = await this.db.one<{ id: number }>(
      'SELECT id FROM orders WHERE shop_id = $1 AND idempotency_key = $2',
      [shopId, idemKey],
    );
    if (!found) return null;
    const detail = await this.orderPublic((await this.db.one<{ public_token: string }>(
      'SELECT public_token FROM orders WHERE id = $1', [found.id],
    ))!.public_token);
    // पहली checkout जवाब जैसा ही आकार — publicToken नाम से ही
    const { token, ...order } = detail.order as Record<string, any>;
    return { duplicate: true, order: { ...order, publicToken: token } };
  }

  /* -------------------------- order status (token) ------------------------ */

  private static HEX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * GET /public/orders/:token — order का status, न गिना जा सकने वाले token से
   * (order नंबर/क्रम से कोई पहुँच नहीं). Order के items और पैसे; ग्राहक का
   * नाम/नंबर/पता कभी नहीं भेजते (token यूआरएल में अर्थ भी कोई भी हो सकता है).
   */
  async orderPublic(token: string) {
    const t = String(token || '').trim().toLowerCase();
    if (!PublicStoreService.HEX_UUID_RE.test(t)) {
      throw Http404('ऑर्डर नहीं मिला — लिंक दोबारा जाँचें');
    }
    const o = await this.db.one<any>(
      `SELECT o.id, o.public_token::text AS token, o.status, o.payment_status AS "paymentStatus",
              o.pay_mode AS "paymentMode", o.fulfilment,
              o.sub_total::float8 AS "subTotal", o.delivery_fee::float8 AS "deliveryFee",
              o.discount::float8 AS discount, o.coupon_code AS "couponCode",
              o.total::float8 AS total, o.placed_at AS "placedAt",
              o.cancellation_reason AS "cancellationReason",
              o.cancelled_at AS "cancelledAt",
              s.shop_name AS "shopName", s.slug AS "shopSlug", s.emoji AS "shopEmoji",
              s.whatsapp_number AS "whatsapp", s.business_phone AS "businessPhone",
              s.address AS "shopAddress", s.upi_vpa AS "upiVpa"
         FROM orders o
         JOIN shops s ON s.id = o.shop_id
        WHERE o.public_token = $1::uuid`,
      [t],
    );
    if (!o) {
      // सही token बनाने में कितनी कोशिश दुश्मनों को नहीं देनी (404 ही).
      throw Http404('ऑर्डर नहीं मिला — लिंक दोबारा जाँचें');
    }
    const items = await this.db.query(
      `SELECT product_name AS name, variant_name AS "variantName", unit, qty,
              unit_price::float8 AS "unitPrice"
         FROM order_items WHERE order_id = $1 ORDER BY id`,
      [o.id],
    );
    // PART 5 — स्थिति टाइमलाइन (कब क्या बदला) + रद्द/अस्वीकृत का reason.
    // actor का नाम ग्राहक को नहीं दिखता; सिर्फ़ स्थिति + हिंदी reason.
    const history = await this.db.query(
      `SELECT h.new_status AS status, h.reason, h.created_at AS "createdAt"
         FROM order_status_history h
        WHERE h.order_id = $1
        ORDER BY h.created_at ASC, h.id ASC`,
      [o.id],
    );
    return {
      order: {
        number: orderNumber(o.id),
        token: o.token,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMode: o.paymentMode,
        fulfilment: o.fulfilment,
        totals: { subTotal: o.subTotal, deliveryFee: o.deliveryFee, discount: o.discount, total: o.total },
        couponCode: o.couponCode || null,
        placedAt: o.placedAt,
        upiVpa: o.paymentMode === 'UPI_QR' ? o.upiVpa : null,
        cancellationReason: o.cancellationReason || null,
        cancelledAt: o.cancelledAt || null,
        canCancel: customerCanCancel(o.status),
      },
      history,
      pickup: o.fulfilment === 'PICKUP'
        ? { address: o.shopAddress || null }
        : null,
      shop: {
        name: o.shopName,
        slug: o.shopSlug,
        emoji: o.shopEmoji,
        contact: o.whatsapp || o.businessPhone || null,
      },
      items,
    };
  }

  /* ------------------------ customer cancel (token) ---------------------- */

  /**
   * POST /public/orders/:token/cancel — ग्राहक अपना (NEW) ऑर्डर रद्द कर सकता है.
   *
   * नियम: token ही पहचान है; सिर्फ़ NEW (बाकी पुष्टि) ऑर्डर ही — एक बार दुकान
   * स्वीकार कर चुकी हो तो दुकान से ही बात करनी पड़ेगी. Transaction में row-lock
   * + स्टॉक वापसी (RETURN movement, OrdersService का shared restock) + history
   * + outbox — दोबारा tap पर status पहले ही CANCELLED → 409, स्टॉक फिर नहीं जुड़ता.
   */
  async cancelByToken(token: string, reasonRaw: unknown) {
    const t = String(token || '').trim().toLowerCase();
    if (!PublicStoreService.HEX_UUID_RE.test(t)) {
      throw Http404('ऑर्डर नहीं मिला — लिंक दोबारा जाँचें');
    }
    const reason = String(reasonRaw ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300) || 'ग्राहक ने रद्द किया';

    // token → order (पहले बिना lock जाँच — row तो मान्य token पर ही मिलेगी)
    const found = await this.db.one<{ id: number }>(
      'SELECT id FROM orders WHERE public_token = $1::uuid', [t]);
    if (!found) throw Http404('ऑर्डर नहीं मिला — लिंक दोबारा जाँचें');

    return this.db.tx(async (q) => {
      const o = await this.pickForCancel(found.id, q);
      if (!customerCanCancel(o.status)) {
        const why = o.status === 'CANCELLED'
          ? 'ऑर्डर पहले ही रद्द है'
          : 'दुकान ऑर्डर स्वीकार कर चुकी है — रद्द के लिए दुकान को सीधे बताएं';
        throw Http409(why, { currentStatus: o.status });
      }

      await q(
        `UPDATE orders SET status = 'CANCELLED', cancelled_at = now(),
                cancellation_reason = $2
          WHERE id = $1`,
        [o.id, reason],
      );
      await q(
        `INSERT INTO order_status_history (order_id, previous_status, new_status, reason)
         VALUES ($1, $2, 'CANCELLED', $3)`,
        [o.id, o.status, reason],
      );

      await this.orders.restock(q, o, null);   // ठीक एक बार

      await this.notifs.enqueue(q, {
        event: 'ORDER_CANCELLED', orderId: o.id, shopId: o.shopId,
        orderNumber: orderNumber(o.id),
      });

      return { ok: true, status: 'CANCELLED', number: orderNumber(o.id) };
    });
  }

  /** ग्राहक-cancel के लिए lock + बेहद सीमित झलक (पता/नाम/फ़ोन यहाँ नहीं). */
  private async pickForCancel(orderId: number, q: (sql: string, params?: any[]) => Promise<any[]>) {
    const rows = await q(
      `SELECT id, id::text AS "idText", shop_id::text AS "shopId", status
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    ) as any[];
    if (!rows.length) throw Http404('ऑर्डर नहीं मिला');
    const r = rows[0];

    // restock() हेल्पर की अपेक्षा रूप: { id (number), shopId, number, items? }
    const items = await q(
      `SELECT oi.product_id, oi.qty FROM order_items oi WHERE oi.order_id = $1`,
      [orderId],
    );
    return { ...r, id: orderId, number: orderNumber(orderId), items };
  }
}

/** डिलीवरी हो तो ETA नोट (shop की निर्धारित), पिकअप हो तो दुकान से. */
function fulfilledNote(shop: any, f: Fulfilment): string {
  return f === 'PICKUP' ? 'दुकान से उठाना — आराम से आजाद' : (shop.etaNote || '');
}
