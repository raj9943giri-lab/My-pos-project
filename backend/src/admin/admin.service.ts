import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Http400, Http404, Http409 } from '../common/http-errors';
import { ShopStatus, ShopAction, shopTransition, UserRole } from '../common/roles';

/**
 * PART 7 — admin panel data: dashboard, shop review workflow, audit log.
 *
 * Approval के सारे बदलाव एक ही transaction में:
 *   shops row FOR UPDATE → नियम-जाँच (shopTransition, common/roles.ts) →
 *   shops UPDATE + shop_status_history + audit_log — दोबारा वही action
 *   रेस में भी दूसरी बार history नहीं लिखता (transition 409 देता है).
 *
 * Publish नियम: APPROVE/UNSUSPEND → published=TRUE (auto-publish),
 * REJECT/SUSPEND → published=FALSE (public store से तुरंत ग़ायब).
 */
@Injectable()
export class AdminService {
  constructor(private db: DbService) {}

  /** Legacy Part-2 body (`status: APPROVED…`) → Part-7 action. */
  static actionFromStatus(status?: string): ShopAction | null {
    const map: Record<string, ShopAction> = {
      APPROVED: 'APPROVE', REJECTED: 'REJECT', SUSPENDED: 'SUSPEND', UNSUSPENDED: 'UNSUSPEND',
    };
    return status ? map[status] || null : null;
  }

  /* ------------------------------ dashboard ------------------------------- */
  async dashboard() {
    const shops = await this.db.query<{ status: string; c: string }>(
      'SELECT approval_status AS status, COUNT(*)::text AS c FROM shops GROUP BY approval_status');
    const complaints = await this.db.query<{ status: string; c: string }>(
      'SELECT status, COUNT(*)::text AS c FROM complaints GROUP BY status');
    const ordersToday = await this.db.one<{ c: string; gmv: string }>(
      `SELECT COUNT(*)::text AS c, COALESCE(SUM(total), 0)::text AS gmv
         FROM orders WHERE placed_at >= date_trunc('day', now())`);
    const oldestPending = await this.db.one<{ age_hours: string }>(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(submitted_at))) / 3600, 0)::text AS age_hours
         FROM shops WHERE approval_status = 'PENDING'`);
    const by = (rows: { status: string; c: string }[]) =>
      rows.reduce<Record<string, number>>((acc, r) => { acc[r.status] = Number(r.c); return acc; }, {});
    const shopCounts = by(shops);
    const complaintCounts = by(complaints);
    const todayCount = Number(ordersToday?.c || 0);

    return {
      shops: {
        byStatus: shopCounts,
        // total/all — admin.html के dashboard कार्ड के लिए (byStatus भी रहता है)
        total: Object.values(shopCounts).reduce((a, b) => a + b, 0),
        all: Object.values(shopCounts).reduce((a, b) => a + b, 0),
        draft: Number(shopCounts[ShopStatus.DRAFT] || 0),
        pending: Number(shopCounts[ShopStatus.PENDING] || 0),
        approved: Number(shopCounts[ShopStatus.APPROVED] || 0),
        rejected: Number(shopCounts[ShopStatus.REJECTED] || 0),
        suspended: Number(shopCounts[ShopStatus.SUSPENDED] || 0),
        oldestPendingHours: Number(oldestPending?.age_hours || 0),
      },
      complaints: {
        byStatus: complaintCounts,
        total: Object.values(complaintCounts).reduce((a, b) => a + b, 0),
        all: Object.values(complaintCounts).reduce((a, b) => a + b, 0),
        open: Number(complaintCounts['OPEN'] || 0),
        inProgress: Number(complaintCounts['IN_PROGRESS'] || 0),
        resolved: Number(complaintCounts['RESOLVED'] || 0),
        closed: Number(complaintCounts['CLOSED'] || 0),
      },
      orders: {
        todayCount,
        // today/TODAY — पुराने admin.html कार्ड के साथ संगत
        today: todayCount,
        todayGmv: Number(ordersToday?.gmv || 0),
        gmv: Number(ordersToday?.gmv || 0),
      },
    };
  }

  /* ------------------------------- shops ---------------------------------- */
  /** GET /admin/shops?status=&q=&page=&limit= · ?queue=1 → PENDING+DRAFT. */
  async listShops(opts: { status?: string; q?: string; page?: number; limit?: number; queue?: boolean }) {
    const where: string[] = [];
    const vals: any[] = [];
    if (opts.queue) {
      where.push(`s.approval_status IN ('${ShopStatus.PENDING}', '${ShopStatus.DRAFT}')`);
    } else if (opts.status) {
      const known = (Object.values(ShopStatus) as string[]).includes(opts.status);
      if (!known) throw Http400('स्थिति फ़िल्टर अज्ञात है (DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED)');
      vals.push(opts.status);
      where.push(`s.approval_status = $${vals.length}`);
    }
    const term = (opts.q || '').trim();
    if (term) {
      vals.push('%' + term + '%');
      where.push(
        `(s.shop_name ILIKE $${vals.length} OR s.owner_name ILIKE $${vals.length} OR s.slug ILIKE $${vals.length} OR s.owner_phone ILIKE $${vals.length})`);
    }
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
    const page = Math.min(Math.max(Number(opts.page) || 1, 1), 500);
    vals.push(limit, (page - 1) * limit);

    const totalRow = await this.db.one<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM shops s ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      vals.slice(0, -2));
    const items = await this.db.query(
      `SELECT s.id, s.shop_name AS name, s.slug, s.emoji,
              s.owner_name AS "ownerName", s.owner_phone AS "ownerPhone",
              s.address, s.pincode, s.categories, s.license_no AS "licenseNo",
              s.approval_status AS status, s.published,
              s.submitted_at AS "submittedAt", s.approved_at AS "approvedAt",
              s.suspended_at AS "suspendedAt", s.rejection_reason AS "reason",
              s.created_at AS "createdAt"
         FROM shops s
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (s.approval_status = 'PENDING') DESC, s.submitted_at NULLS LAST, s.created_at
        LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals);
    return { items, total: Number(totalRow?.total || 0), page, limit, hasMore: page * limit < Number(totalRow?.total || 0) };
  }

  /** GET /admin/shops/:id — विवरण + status इतिहास + खुली शिकायतें. */
  async getShop(id: string) {
    const shop = await this.db.one(
      `SELECT s.id, s.shop_name AS name, s.slug, s.emoji,
              s.owner_name AS "ownerName", s.owner_phone AS "ownerPhone",
              s.address, s.pincode, s.categories, s.license_no AS "licenseNo",
              s.description, s.approval_status AS status, s.published,
              s.submitted_at AS "submittedAt", s.approved_at AS "approvedAt",
              s.suspended_at AS "suspendedAt", s.rejection_reason AS "reason",
              s.is_open AS "isOpen", s.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM shop_members m WHERE m.shop_id = s.id) AS members
         FROM shops s WHERE s.id = $1`, [id]);
    if (!shop) throw Http404('दुकान नहीं मिली');
    const history = await this.db.query(
      `SELECT h.from_status AS "from", h.to_status AS "to", h.action,
              h.reason, h.created_at AS "at",
              a.email AS "adminEmail", u.name AS "userName"
         FROM shop_status_history h
         LEFT JOIN admin_users a ON a.id = h.actor_admin_id
         LEFT JOIN users u ON u.id = h.actor_user_id
        WHERE h.shop_id = $1
        ORDER BY h.created_at DESC LIMIT 30`, [id]);
    const complaints = await this.db.query(
      `SELECT id, status, category, priority, body, created_at AS "createdAt"
         FROM complaints WHERE shop_id = $1
        ORDER BY created_at DESC LIMIT 10`, [id]);
    return { shop, history, complaints };
  }

  /* -------------------------- status workflow ----------------------------- */
  /**
   * platform_policies.value JSONB का असली मान निकालें ({ value: … } लपेट हटाकर).
   * `auto_publish_on_approve=false` पर APPROVE/UNSUSPEND status बदलता है पर
   * दुकान public नहीं होती — admin उसे अलग publish switch से चालू करता है.
   */
  private async autoPublishOnApprove(q: any): Promise<boolean> {
    const rows = await q(`SELECT value FROM platform_policies WHERE key = 'auto_publish_on_approve'`);
    const raw = rows[0]?.value;
    const inner = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    return inner !== false;
  }

  /**
   * PATCH /admin/shops/:id/status — action (या legacy status) + reason.
   * REJECT/SUSPEND कारण माँगते हैं (server ज़िम्मेदारी).
   */
  async setStatus(
    shopId: string,
    input: { action?: string; status?: string },
    reason: string | undefined,
    admin: { id: string; email: string },
  ) {
    const action = (input.action as ShopAction) || AdminService.actionFromStatus(input.status) || '';
    if (!action) throw Http400('action या status चाहिए (APPROVE/REJECT/SUSPEND/UNSUSPEND)');

    return this.db.tx(async (q) => {
      const rows = await (q as any)(
        'SELECT id, approval_status, published FROM shops WHERE id = $1 FOR UPDATE', [shopId]);
      const shop = rows[0];
      if (!shop) throw Http404('दुकान नहीं मिली');

      const res = shopTransition(shop.approval_status, action);
      if (!res.ok) throw Http409(res.message, { code: res.code, currentStatus: shop.approval_status });
      if (res.needsReason && !String(reason || '').trim()) {
        throw Http400('इस कदम के लिए कारण (reason) ज़रूरी है — दुकानदार को दिखेगा');
      }

      // status APPROVED होना और public (published) होना अलग-अलग हैं:
      // auto_publish_on_approve=false पर admin बाद में ख़ुद publish करेगा.
      let publish = res.publish;
      if ((action === 'APPROVE' || action === 'UNSUSPEND') && publish) {
        publish = await this.autoPublishOnApprove(q);
      }

      const updated = await (q as any)(
        `UPDATE shops
            SET approval_status = $2, published = $3,
                approved_at = CASE WHEN $4 IN ('APPROVE', 'UNSUSPEND') THEN now() ELSE approved_at END,
                suspended_at = CASE WHEN $4 = 'SUSPEND' THEN now() ELSE NULL END,
                rejection_reason = CASE WHEN $4 IN ('REJECT', 'SUSPEND') THEN $5 ELSE NULL END,
                updated_at = now()
          WHERE id = $1
          RETURNING id, shop_name AS name, slug, approval_status AS status, published,
                    rejection_reason AS reason`,
        [shopId, res.next, publish, action, reason || null]);

      await (q as any)(
        `INSERT INTO shop_status_history (shop_id, from_status, to_status, action, reason, actor_admin_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [shopId, shop.approval_status, res.next, action, reason || null, admin.id]);
      await (q as any)(
        `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
         VALUES ($1, $2, 'shops', $3, $4)`,
        [admin.id, 'SHOP_' + action, shopId,
          JSON.stringify({ from: shop.approval_status, to: res.next, published: publish, reason: reason || null })]);

      return { ...updated[0], previousStatus: shop.approval_status };
    });
  }

  /** PATCH /admin/shops/:id/publish — APPROVED दुकान को public चालू/बंद करें. */
  async setPublished(
    shopId: string,
    published: boolean,
    admin: { id: string; email: string },
  ) {
    return this.db.tx(async (q) => {
      const rows = await (q as any)(
        'SELECT id, approval_status, published, shop_name AS name, slug FROM shops WHERE id = $1 FOR UPDATE',
        [shopId]);
      const shop = rows[0];
      if (!shop) throw Http404('दुकान नहीं मिली');
      if (shop.approval_status !== ShopStatus.APPROVED) {
        throw Http409('सिर्फ़ APPROVED दुकान public की जा सकती है — पहले अप्रूव करें');
      }
      if (!!shop.published === !!published) {
        return { ...shop, status: shop.approval_status, published: !!published, unchanged: true };
      }
      const updated = await (q as any)(
        `UPDATE shops SET published = $2, updated_at = now()
          WHERE id = $1
          RETURNING id, shop_name AS name, slug, approval_status AS status, published`,
        [shopId, !!published]);
      await (q as any)(
        `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
         VALUES ($1, $2, 'shops', $3, $4)`,
        [admin.id, published ? 'SHOP_PUBLISH' : 'SHOP_UNPUBLISH', shopId,
          JSON.stringify({ from: !!shop.published, to: !!published })]);
      return { ...updated[0], previousPublished: !!shop.published };
    });
  }

  /* ------------------------------- orders --------------------------------- */
  /** GET /admin/orders?status=&q=&shopId=&page=&limit= — platform-wide read-only overview. */
  async listOrders(opts: { status?: string; q?: string; shopId?: string; page?: number; limit?: number }) {
    const known = ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'TRANSIT', 'DELIVERED', 'CANCELLED', 'REJECTED'];
    const where: string[] = [];
    const vals: any[] = [];
    if (opts.status) {
      if (!known.includes(String(opts.status))) {
        throw Http400('ऑर्डर स्थिति अज्ञात है (NEW/ACCEPTED/PREPARING/PREPARED/TRANSIT/DELIVERED/CANCELLED/REJECTED)');
      }
      vals.push(opts.status);
      where.push(`o.status = $${vals.length}`);
    }
    if (opts.shopId) {
      vals.push(opts.shopId);
      where.push(`o.shop_id = $${vals.length}`);
    }
    const term = (opts.q || '').trim();
    if (term) {
      vals.push('%' + term + '%');
      where.push(`(s.shop_name ILIKE $${vals.length} OR o.customer_name ILIKE $${vals.length}
                   OR o.customer_phone ILIKE $${vals.length}
                   OR ('S-' || LPAD(o.id::text, 6, '0')) ILIKE $${vals.length})`);
    }
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
    const page = Math.min(Math.max(Number(opts.page) || 1, 1), 500);
    vals.push(limit, (page - 1) * limit);
    const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const totalRow = await this.db.one<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM orders o JOIN shops s ON s.id = o.shop_id ${cond}`,
      vals.slice(0, -2));
    const items = await this.db.query(
      `SELECT o.id, 'S-' || LPAD(o.id::text, 6, '0') AS "orderNo",
              o.status, o.payment_status AS "paymentStatus", o.pay_mode AS "payMode",
              o.fulfilment, o.total, o.sub_total AS "subTotal", o.delivery_fee AS "deliveryFee",
              o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
              o.placed_at AS "placedAt", o.delivered_at AS "deliveredAt",
              s.id AS "shopId", s.shop_name AS "shopName", s.slug AS "shopSlug",
              (SELECT COALESCE(SUM(i.qty), 0)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount"
         FROM orders o JOIN shops s ON s.id = o.shop_id
         ${cond}
        ORDER BY o.placed_at DESC
        LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals);
    return { items, total: Number(totalRow?.total || 0), page, limit, hasMore: page * limit < Number(totalRow?.total || 0) };
  }

  /* ----------------------------- commissions ------------------------------ */
  /** GET /admin/commissions — default rate + प्रति-दुकान delivered GMV पर अनुमान. */
  async commissionSummary() {
    const row = await this.db.one<{ value: any }>(
      `SELECT value FROM platform_policies WHERE key = 'commission_default_pct'`);
    const raw = row?.value;
    const inner = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    const defaultPct = Number(inner);
    const pct = Number.isFinite(defaultPct) ? defaultPct : 0;
    const shops = await this.db.query<{
      id: string; name: string; status: string; published: boolean; gmv: string; orders: number;
    }>(
      `SELECT s.id, s.shop_name AS name, s.approval_status AS status, s.published,
              COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DELIVERED'), 0)::text AS gmv,
              COUNT(o.id) FILTER (WHERE o.status = 'DELIVERED')::int AS orders
         FROM shops s
         LEFT JOIN orders o ON o.shop_id = s.id
        GROUP BY s.id
        ORDER BY COALESCE(SUM(o.total) FILTER (WHERE o.status = 'DELIVERED'), 0) DESC, s.shop_name
        LIMIT 100`);
    const items = shops.map((s) => {
      const gmv = Number(s.gmv) || 0;
      return {
        ...s, gmv,
        commission: Math.round(gmv * pct) / 100,
      };
    });
    const totalGmv = items.reduce((a, s) => a + s.gmv, 0);
    return {
      defaultPct: pct,
      shops: items,
      totalGmv,
      totalCommission: Math.round(totalGmv * pct) / 100,
    };
  }

  /* ------------------------------- audit ---------------------------------- */
  async writeAudit(adminId: string, action: string, entity: string, entityId: string, meta?: object) {
    await this.db.query(
      `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, entity, entityId, JSON.stringify(meta || {})]);
  }

  async listAudit(limit: number, action?: string) {
    const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const vals: any[] = [cap];
    let where = '';
    if (action) { vals.push(action); where = 'WHERE a.action = $2'; }
    return this.db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.meta, a.created_at AS "at",
              u.email AS "adminEmail", u.name AS "adminName", u.role
         FROM audit_log a
         LEFT JOIN admin_users u ON u.id = a.admin_id
         ${where}
        ORDER BY a.created_at DESC
        LIMIT $1`, vals);
  }
}
