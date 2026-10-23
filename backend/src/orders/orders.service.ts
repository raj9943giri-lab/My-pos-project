import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ShopScopeService } from '../shop-scope/shop-scope.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Http400, Http403, Http404, Http409 } from '../common/http-errors';
import { ListOrdersQueryDto, ReasonDto, StatusActionDto } from './dto';
import {
  CANCELLABLE, Fulfilment, MerchantAction, needsRestock, PayMode, transition,
} from './order-lifecycle';
import { orderNumber } from '../public-store/checkout';
import { OrderEventType } from '../notifications/notification-events';

/**
 * PART 5 — merchant order management.
 *
 * हर रास्ता authenticate + सदस्यता-जाँच (`requireShopMember`) — URL का
 * shopId भरोसेमंद नहीं, क्वेरी हमेशा उसी shop_id से बांधी जाती है (tenant
 * isolation service+query दोनों पर).
 *
 * Status बदलने का एक ही दरवाज़ा — `act()`:
 *   orders row FOR UPDATE → transition नियम (order-lifecycle.ts) →
 *   orders UPDATE + order_status_history + स्टॉक वापसी (जब लगे) +
 *   notification_outbox enqueue — सब एक ही TRANSACTION में.
 * दोबारा वही request: row की हाल पहले ही बदली होगी → transition नियम 409 देता
 * है, स्टॉक फिर नहीं कटता/जुड़ता.
 */
@Injectable()
export class OrdersService {
  constructor(
    private db: DbService,
    private scope: ShopScopeService,
    private logs: InventoryService,
    private notifs: NotificationsService,
  ) {}

  private static STATUS_MATCH: Record<string, string[]> = {
    NEW: ['NEW'], ACCEPTED: ['ACCEPTED'], PREPARING: ['PREPARING'],
    PREPARED: ['PREPARED'], TRANSIT: ['TRANSIT'], DELIVERED: ['DELIVERED'],
    REJECTED: ['REJECTED'], CANCELLED: ['CANCELLED'],
    ACTIVE: ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'TRANSIT'],
  };

  /* -------------------------------- list --------------------------------- */

  /** GET /shops/:shopId/orders — अपनी दुकान की सूची (status/date/खोज फ़िल्टर). */
  async list(userId: string, shopId: string, query: ListOrdersQueryDto) {
    await this.scope.requireShopMember(userId, shopId);
    const q = query || ({} as ListOrdersQueryDto);

    const where: string[] = ['o.shop_id = $1::uuid'];
    const vals: any[] = [shopId];

    const status = q.status || 'ALL';
    // 'ALL' = कोई status फ़िल्टर नहीं; बाकी हर status/ACTIVE का map है.
    if (status !== 'ALL') {
      const allow = OrdersService.STATUS_MATCH[status];
      if (!allow) throw Http400('स्थिति फ़िल्टर अज्ञात है');
      vals.push(allow);
      where.push(`o.status = ANY($${vals.length}::varchar[])`);
    }

    if (q.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date) || isNaN(new Date(q.date + 'T00:00:00Z').getTime())) {
        throw Http400('तारीख YYYY-MM-DD में डालें');
      }
      vals.push(q.date);
      where.push(`o.placed_at::date = $${vals.length}::date`);
    }

    const term = (q.q || '').trim();
    if (term) {
      // ऑर्डर नंबर (S-000123) या नाम/फ़ोन — दूसरी दुकान की पंक्ति फिर भी नहीं मिलती
      const digits = term.replace(/\D/g, '');
      if (/^S-\d{6}$/.test(term.toUpperCase()) || (digits.length >= 1 && /^S-/i.test(term))) {
        vals.push(Number(digits) || 0);
        where.push(`o.id = $${vals.length}`);
      } else {
        vals.push('%' + term + '%');
        where.push(`(o.customer_name ILIKE $${vals.length} OR o.customer_phone ILIKE $${vals.length})`);
      }
    }

    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 50);
    const page = Math.min(Math.max(Number(q.page) || 1, 1), 500);
    vals.push(limit, (page - 1) * limit);

    const totalRow = await this.db.one<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total
         FROM orders o
        WHERE ${where.join(' AND ')}`,
      vals.slice(0, -2),
    );
    const total = Number(totalRow?.total || 0);

    // गणना chips (perspective: हर status का count) — वही shop तक सीमित
    const counts = await this.db.query<any>(
      `SELECT o.status, COUNT(*)::int AS c
         FROM orders o
        WHERE o.shop_id = $1::uuid
        GROUP BY o.status`, [shopId]);

    const items = await this.db.query<any>(
      `SELECT o.id::text AS id,
              o.status, o.fulfilment,
              o.pay_mode AS "payMode", o.payment_status AS "paymentStatus",
              o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
              o.total::float8 AS total, o.sub_total::float8 AS "subTotal",
              o.delivery_fee::float8 AS "deliveryFee", o.discount::float8 AS discount,
              o.cancelled_at AS "cancelledAt", o.rejected_at AS "rejectedAt",
              o.placed_at AS "placedAt",
              o.cancellation_reason AS "cancellationReason",
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS "itemCount",
              (SELECT string_agg(oi.product_name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS "itemNames"
         FROM orders o
        WHERE ${where.join(' AND ')}
        ORDER BY o.placed_at DESC
        LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    );

    return {
      shopId,
      items: items.map((r) => this.withNumber(r)),
      page, limit, total,
      counts: counts.reduce((m: Record<string, number>, r: any) => { m[r.status] = r.c; return m; }, {}),
      cancellationWindow: CANCELLABLE,
    };
  }

  private withNumber(r: any): any {
    return { ...r, number: orderNumber(r.id) };
  }

  /* ------------------------------- detail -------------------------------- */

  /** GET /shops/:shopId/orders/:orderId — पूरा विवरण + इतिहास. */
  async detail(userId: string, shopId: string, orderIdRaw: string) {
    await this.scope.requireShopMember(userId, shopId);
    const orderId = OrdersService.parseOrderId(orderIdRaw);
    const o = await this.fetchScoped(shopId, orderId);
    const items = await this.db.query(
      `SELECT oi.id::text AS id, oi.product_id::text AS "productId",
              oi.product_name AS name, oi.variant_name AS "variantName",
              oi.unit, oi.qty, oi.unit_price::float8 AS "unitPrice",
              (oi.unit_price * oi.qty)::float8 AS "lineTotal"
         FROM order_items oi
        WHERE oi.order_id = $1 ORDER BY oi.id`, [orderId]);

    // स्नैपशॉट की सफ़ाई: archived हो चुका प्रोडक्ट भी पहले जैसा नाम/कीमत रखेगा
    return {
      shopId,
      order: this.withNumber(o),
      items,
      history: await this.historyOf(orderId),
    };
  }

  private async fetchScoped(shopId: string, orderId: number, lock = false): Promise<any> {
    const row = await this.db.one<any>(
      `SELECT o.id::text AS id, o.shop_id::text AS "shopId", o.status, o.fulfilment,
              o.pay_mode AS "payMode", o.payment_status AS "paymentStatus",
              o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
              o.addr AS "address", o.landmark, o.delivery_instructions AS "instructions",
              o.sub_total::float8 AS "subTotal", o.delivery_fee::float8 AS "deliveryFee",
              o.discount::float8 AS discount, o.coupon_code AS "couponCode",
              o.total::float8 AS total, o.idempotency_key IS NOT NULL AS "wasRetrySafe",
              o.cancelled_at AS "cancelledAt", o.rejected_at AS "rejectedAt",
              o.accepted_at AS "acceptedAt", o.completed_at AS "completedAt",
              o.placed_at AS "placedAt",
              o.cancellation_reason AS "cancellationReason",
              o.public_token::text AS "publicToken"
         FROM orders o
        WHERE o.id = $1 AND o.shop_id = $2::uuid
        LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
      [orderId, shopId],
    );
    // 403 जानबूझकर कोई और दुकान के ऑर्डर पर नहीं कहते — हर हाल में 404 ही
    if (!row) throw Http404('ऑर्डर नहीं मिला — सूची ताज़ा करें');
    return this.withNumber(row);
  }

  /** GET /shops/:shopId/orders/:orderId/history. */
  async history(userId: string, shopId: string, orderIdRaw: string) {
    await this.scope.requireShopMember(userId, shopId);
    const orderId = OrdersService.parseOrderId(orderIdRaw);
    await this.fetchScoped(shopId, orderId); // tenant जाँच
    return { orderId, items: await this.historyOf(orderId) };
  }

  private async historyOf(orderId: number) {
    return this.db.query(
      `SELECT h.id::text AS id, h.previous_status AS "previousStatus",
              h.new_status AS "newStatus", h.reason,
              h.actor_user_id::text AS "actorUserId", u.name AS "actorName",
              h.created_at AS "createdAt"
         FROM order_status_history h
         LEFT JOIN users u ON u.id = h.actor_user_id
        WHERE h.order_id = $1
        ORDER BY h.created_at ASC, h.id ASC`, [orderId]);
  }

  /* ------------------------- transitions (the door) ---------------------- */

  /** POST /accept|reject|status|cancel — सब एक ही act() में घूमते हैं. */
  async act(userId: string, shopId: string, orderIdRaw: string, dto: StatusActionDto) {
    await this.scope.requireShopMember(userId, shopId);
    const orderId = OrdersService.parseOrderId(orderIdRaw);
    const action = String(dto.action) as MerchantAction;
    const reason = dto.reason !== undefined ? dto.reason : (dto as ReasonDto).reason;

    return this.db.tx(async (q) => {
      const o = await this.fetchScoped(shopId, orderId, true); // row-lock यहीं
      const fulfilment = (o.fulfilment === 'PICKUP' ? 'PICKUP' : 'DELIVERY') as Fulfilment;
      const payMode = (o.payMode || 'COD') as PayMode;

      const verdict = transition(o.status, action, fulfilment, payMode);
      if (!verdict.ok) {
        // गलत क्रम/दोहरा tap → 409 (स्टॉक को छुए बिना रुक जाता है)
        throw Http409(verdict.message, { reason: verdict.code, currentStatus: o.status });
      }
      const next = verdict.next;
      const cleanReason = reason ? String(reason) : undefined;

      let paymentStatus: string | null = null;
      if (action === 'MARK_PAID') {
        if (o.paymentStatus !== 'PENDING') {
          throw Http409('पेमेंट पहले से दर्ज है', { reason: 'PAYMENT_SET', currentStatus: o.status });
        }
        paymentStatus = 'PAID';
      }
      // COD ऑर्डर पर डिलीवरी पूरी = नकद मिल गया — PAYMENT सेट बाकी नहीं
      if (next === 'DELIVERED' && payMode === 'COD' && o.paymentStatus === 'PENDING') {
        paymentStatus = 'PAID';
      }

      // 1) orders UPDATE — status + नए झंडे
      await q(
        `UPDATE orders SET
           status = $2,
           accepted_at  = CASE WHEN $3 = 'ACCEPTED'  THEN now() ELSE accepted_at  END,
           rejected_at  = CASE WHEN $3 = 'REJECTED'  THEN now() ELSE rejected_at  END,
           cancelled_at = CASE WHEN $3 = 'CANCELLED' THEN now() ELSE cancelled_at END,
           completed_at = CASE WHEN $3 = 'DELIVERED' THEN now() ELSE completed_at END,
           cancellation_reason = CASE WHEN $3 = 'CANCELLED' OR $3 = 'REJECTED'
                                       THEN COALESCE($4, cancellation_reason)
                                       ELSE cancellation_reason END,
           payment_status = COALESCE($5, payment_status)
         WHERE id = $1`,
        [orderId, next, next, cleanReason || null, paymentStatus],
      );

      // 2) इतिहास (actor + timestamp + reason) — ऑडिट नियम
      await q(
        `INSERT INTO order_status_history (order_id, previous_status, new_status, actor_user_id, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, o.status, next, userId, cleanReason ? cleanReason.slice(0, 300) : null],
      );

      // 3) स्टॉक वापसी — ठीक एक बार (needsRestock ऊपर transition guard पर है)
      if (needsRestock(o.status as any, next)) {
        await this.restock(q, o, userId);
      }

      // 4) notification outbox — उसी tx में; COMMIT के बाद ही भेजे जाएँगे
      const evt = OrdersService.EVENT_OF[action];
      if (evt && next !== 'NEW') {
        await this.notifs.enqueue(q, {
          event: evt, orderId, shopId, orderNumber: o.number,
          totals: { total: Number(o.total) },
        });
      }

      return {
        ok: true,
        order: await this.readView(q, orderId),
        transition: { previous: o.status, next, actor: userId },
      };
    });
  }

  private static EVENT_OF: Partial<Record<MerchantAction, OrderEventType>> = {
    ACCEPT: 'ORDER_ACCEPTED',
    REJECT: 'ORDER_REJECTED',
    START_PREPARING: 'ORDER_PREPARING',
    MARK_READY: 'ORDER_READY',
    OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
    COMPLETE: 'ORDER_COMPLETED',
    CANCEL: 'ORDER_CANCELLED',
    MARK_PAID: 'ORDER_PAYMENT_MARKED',
  };

  /**
   * SALE कटे हुए स्टॉक को ORDER की items से वापस करता है — RETURN movement
   * log हर row का (products FOR UPDATE). दोबारा cancel यहाँ पहुँचता नहीं:
   * transition नियम (CANCELLABLE से बाहर) 409 देता है.
   */
  /**
   * Public भी — customer-cancel (public-store) उसी shared रास्ते से वापसी करता
   * है ताकि दो जगह दो तरह का गणित न बन जाए.
   */
  async restock(q: (sql: string, params?: any[]) => Promise<any[]>, o: any, actorId: string | null): Promise<void> {
    const items = await q(
      `SELECT oi.product_id, oi.variant_id, oi.variant_name, oi.qty
         FROM order_items oi WHERE oi.order_id = $1`,
      [o.id],
    );
    for (const item of items) {
      // Variant का अपना stock था तो वहीं वापस; variant.stock NULL / variant
      // hard-deleted (FK SET NULL) हो तो product stock में.
      let variant: any = null;
      if (item.variant_id) {
        const vRows = await q(
          `SELECT stock FROM product_variants
            WHERE id = $1 AND product_id = $2 FOR UPDATE`,
          [item.variant_id, item.product_id],
        ) as any[];
        variant = vRows[0] || null;
      }
      if (variant && variant.stock !== null && variant.stock !== undefined) {
        const before = Math.round(Number(variant.stock));
        const after = before + item.qty;
        await q(
          `UPDATE product_variants SET stock = $1 WHERE id = $2 AND product_id = $3`,
          [after, item.variant_id, item.product_id],
        );
        await this.logs.log(q, {
          shopId: o.shopId,
          productId: Number(item.product_id),
          kind: 'RETURN',
          delta: item.qty,
          before, after,
          note: 'order ' + o.number + ' रद्द/अस्वीकृत — वापसी'
            + (item.variant_name ? ' · ' + item.variant_name : ''),
          actorId: actorId || undefined,
        });
        continue;
      }

      const locked = await q(
        `SELECT stock FROM products WHERE id = $1 FOR UPDATE`,
        [item.product_id],
      ) as any[];
      if (!locked.length) continue; // hard-deleted product → कुछ वापस करने को नहीं रहा
      const before = Math.round(Number(locked[0].stock));
      const after = before + item.qty;
      await q(
        `UPDATE products SET stock = $1, updated_at = now() WHERE id = $2`,
        [after, item.product_id],
      );
      await this.logs.log(q, {
        shopId: o.shopId,
        productId: Number(item.product_id),
        kind: 'RETURN',
        delta: item.qty,
        before, after,
        note: 'order ' + o.number + ' रद्द/अस्वीकृत — वापसी',
        actorId: actorId || undefined,
      });
    }
  }

  /* --------------------------- read helpers ------------------------------ */

  private async readView(q: (sql: string, params?: any[]) => Promise<any[]>, orderId: number) {
    const rows = await q(
      `SELECT id::text AS id, status, payment_status AS "paymentStatus",
              cancelled_at AS "cancelledAt", rejected_at AS "rejectedAt",
              accepted_at AS "acceptedAt", completed_at AS "completedAt",
              cancellation_reason AS "cancellationReason", total::float8 AS total
         FROM orders WHERE id = $1`, [orderId]);
    return rows[0] ? this.withNumber(rows[0]) : null;
  }

  private static parseOrderId(idRaw: string): number {
    const id = Number(String(idRaw || '').replace(/\D/g, ''));
    if (!id || !(id >= 0)) throw Http404('ऑर्डर नहीं मिला');
    return id;
  }
}
