import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Http400, Http404, Http403 } from '../common/http-errors';
import { env } from '../config/env';
import {
  backoffMinutes, MAX_ATTEMPTS, orderEventText, OrderEventType,
  ORDER_EVENT_TYPES, pickTotal, sanitizeReason,
} from './notification-events';

/**
 * PART 5 — notifications की सारी लेखनी एक जगह.
 *
 * 1) enqueue(): order transaction के अंदर बुलाई जाती है (उसी tx की `q` से) —
 *    मतलब row केवल तब लिखती है जब order बदलाव COMMIT होता है. Transaction
 *    fail → outbox row भी rollback (आधा-अधूरा कभी नहीं).
 * 2) drain(): मैन scheduler (main.ts) हर ~20 सेकंड में. हर row के लिए:
 *      - in-app history row (notifications टेबल) डुप्लिकेट-रोक के साथ
 *      - FCM push — सिर्फ़ FCM_SERVER_KEY configured होने पर (नहीं → SKIPPED,
 *        "कतार हुई" का मतलब हर हाल में दुकानदार ऐप सूची में दिखेगा, पर push
 *        की डिलीवरी का वादा तब तक नहीं जब तक provider लगा न जाए)
 * 3) device tokens + readable in-app history + mark-read.
 *
 * Push body में पता/पेमेंट विवरण कभी नहीं (notification-events.ts देखें).
 */
@Injectable()
export class NotificationsService {
  private static readonly log = new Logger(NotificationsService.name);

  constructor(private db: DbService) {}

  /* ----------------------------- enqueue (tx) ---------------------------- */

  /**
   * Same-transaction enqueue. Dedupe को unique index (uq_outbox_event)
   * संभालता है — दोबारा उसी event/order पर DO NOTHING.
   */
  async enqueue(
    q: (sql: string, params?: any[]) => Promise<any[]>,
    params: {
      event: OrderEventType;
      orderId: number | string;
      shopId: string;
      orderNumber?: string;
      totals?: { total?: number };
    },
  ): Promise<void> {
    if (!(ORDER_EVENT_TYPES as string[]).includes(params.event)) return;
    const orderNumber = params.orderNumber || '#' + String(params.orderId);
    const { title, body } = orderEventText(
      params.event, orderNumber,
      pickTotal(params.event, params.totals) as number | undefined,
    );
    await q(
      `INSERT INTO notification_outbox (event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'ORDER', $2, $3)
       ON CONFLICT (event_type, aggregate_type, aggregate_id) DO NOTHING`,
      [
        params.event,
        String(params.orderId),
        JSON.stringify({
          shopId: String(params.shopId),
          orderNumber,
          // ⚠️ ग्राहक का नाम/पता/फ़ोन/पेमेंट विवरण यहाँ नहीं रखना (push rule)
          title, body,
        }),
      ],
    );
  }

  /* ------------------------------- drain --------------------------------- */

  /** COMMIT के बाद scheduler बुलाता है. हर कॉल ज़्यादा से ज़्यादा `limit` rows. */
  async drain(limit = 20): Promise<void> {
    const rows = await this.db.query<any>(
      `SELECT id, event_type, aggregate_id, payload, attempt_count
         FROM notification_outbox
        WHERE status = 'PENDING'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY next_attempt_at NULLS FIRST, created_at
        LIMIT $1`, [Math.min(Math.max(limit, 1), 50)]);

    for (const row of rows) {
      // काम शुरू करने से पहले row अपने आप पर लॉक (दूसरे worker से दोहरा भेजा नहीं)
      const claimed = await this.db.one<{ id: number }>(
        `UPDATE notification_outbox SET status = 'PROCESSING'
          WHERE id = $1 AND status = 'PENDING'
          RETURNING id`, [row.id]);
      if (!claimed) continue;
      try {
        await this.deliver(row);
        await this.db.query(
          `UPDATE notification_outbox
              SET status = 'DONE', processed_at = now(), next_attempt_at = NULL
            WHERE id = $1`, [row.id]);
      } catch (e: any) {
        const attempts = (Number(row.attempt_count) || 0) + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await this.db.query(
          `UPDATE notification_outbox
              SET status = $2, attempt_count = $3, last_error = $4,
                  next_attempt_at = now() + ($5 || ' minutes')::interval
            WHERE id = $1`,
          [
            row.id, failed ? 'FAILED' : 'PENDING', attempts,
            String(e && e.message ? e.message : e).slice(0, 500),
            String(backoffMinutes(attempts)),
          ],
        );
        if (failed) {
          NotificationsService.log.warn('outbox row FAILED after ' + attempts + ' attempts: ' + row.event_type);
        }
      }
    }
  }

  /** एक outbox row की डिलीवरी: in-app history (हमेशा) + FCM (configured हो तो). */
  private async deliver(row: any): Promise<void> {
    const payload = row.payload || {};
    const shopId: string = payload.shopId || '';
    const orderNumber: string = payload.orderNumber || payload.aggregate_id;
    if (!shopId) throw new Error('outbox payload बिना shopId');

    // 1) in-app history — shop के सदस्यों को दिखाना (user_id NULL रहेगा;
    //    दुकान की सूची shop_id से जुड़ती है पर सुखद दोनों हर सदस्य को दिखे
    //    इसलिए user_id डालते हैं जब सदस्य ज्ञात).
    const dup = await this.db.one<{ id: number }>(
      `SELECT id FROM notifications
        WHERE shop_id = $1::uuid AND ref_id = $2 AND body = $3
        LIMIT 1`,
      [shopId, String(row.aggregate_id), String(payload.body || '')],
    );
    if (!dup) {
      await this.db.query(
        `INSERT INTO notifications (shop_id, type, ref_kind, ref_id, body)
         VALUES ($1::uuid, 'ORDER', 'ORDER', $2, $3)`,
        [shopId, String(row.aggregate_id), String(payload.body || '')],
      );
    }

    // 2) FCM push — केवल configured. भरोसा: कतार+शिकायत दर्ज, वादा नहीं.
    if (!env.FCM_SERVER_KEY) {
      // SKIPPED होता FAILED नहीं — configured नहीं कोई गड़बड़ नहीं है.
      // पर "queued" को "delivered" कहना झूठ है; drain का DONE यहाँ भी सही रूप है —
      // in-app history का पूरा काम खत्म हो गया. Push को साफ़ note में record करते हैं.
      await this.db.query(
        `UPDATE notification_outbox
            SET last_error = 'FCM_SERVER_KEY configured नहीं — सिर्फ़ in-app इतिहास'
          WHERE id = $1`, [row.id]);
      return;
    }
    const members = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM shop_members WHERE shop_id = $1::uuid`, [shopId]);
    for (const m of members) {
      const tokens = await this.db.query<{ device_token: string; platform: string }>(
        `SELECT device_token, platform FROM user_device_tokens
          WHERE user_id = $1 AND is_active`, [m.user_id]);
      for (const t of tokens) {
        await this.pushToDevice(t.device_token, payload.title, payload.body, orderNumber);
      }
    }
  }

  /** FCM legacy HTTP (server key) — try/catch ऊपर का retry इंजन संभालता है. */
  private async pushToDevice(token: string, title: string, body: string, orderNumber: string): Promise<void> {
    if (!global.fetch) throw new Error('Node fetch उपलब्ध नहीं — FCM के लिए Node 18+ चाहिए');
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': 'key=' + env.FCM_SERVER_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        priority: 'high',
        notification: { title, body },
        data: { kind: 'ORDER', orderNumber },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('FCM ' + res.status + ': ' + text.slice(0, 200));
    }
  }

  /* ---------------------------- device tokens ---------------------------- */

  /** POST /notifications/device-tokens — अपना ही token; refresh पढ़ता है. */
  async registerDevice(userId: string, dto: { token?: string; platform?: string }, raw: any) {
    const token = sanitizeReason(dto && dto.token).slice(0, 250);
    if (!token) throw Http400('डिवाइस टोकन डालें');
    const platform = ['ANDROID', 'IOS', 'WEB'].includes(String(dto.platform)) ? String(dto.platform) : 'ANDROID';
    await this.db.query(
      `INSERT INTO user_device_tokens (user_id, device_token, platform, is_active, last_seen_at)
       VALUES ($1, $2, $3, TRUE, now())
       ON CONFLICT (device_token) DO UPDATE
         SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
             is_active = TRUE, last_seen_at = now()`,
      [userId, token, platform],
    );
    return { ok: true, platform };
  }

  /* ------------------------ in-app history (user) ------------------------ */

  /** GET /notifications — उस user के सारे shops की सूची (शॉप आइसोलेशन). */
  async listForUser(userId: string, limitRaw?: number) {
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 100);
    const items = await this.db.query(
      `SELECT n.id::text AS id, n.type, n.ref_kind, n.ref_id,
              n.body, n.read_at AS "readAt", n.created_at AS "createdAt",
              s.shop_name AS "shopName", s.slug AS "shopSlug"
         FROM notifications n
         JOIN shops s          ON s.id = n.shop_id
         JOIN shop_members m   ON m.shop_id = n.shop_id
        WHERE m.user_id = $1
        ORDER BY n.created_at DESC
        LIMIT $2`, [userId, limit]);
    const unread = await this.db.one<{ c: number }>(
      `SELECT COUNT(*)::int AS c
         FROM notifications n
         JOIN shop_members m ON m.shop_id = n.shop_id
        WHERE m.user_id = $1 AND n.read_at IS NULL`, [userId]);
    return { items, unread: unread ? Number(unread.c) : 0 };
  }

  /** POST /notifications/:id/read — सिर्फ़ उस user के shop का नोटिफिकेशन. */
  async markRead(userId: string, idRaw: string) {
    const id = Number(String(idRaw || '').replace(/\D/g, ''));
    if (!id) throw Http404('नोटिफिकेशन नहीं मिला');
    const res = await this.db.query<any>(
      `UPDATE notifications n
          SET read_at = now()
        WHERE n.id = $1
          AND n.read_at IS NULL
          AND EXISTS (
            SELECT 1 FROM shop_members m
             WHERE m.shop_id = n.shop_id AND m.user_id = $2)
        RETURNING id`, [id, userId]);
    if (!res.length) throw Http404('नोटिफिकेशन नहीं मिला या पढ़ा जा चुका है');
    return { ok: true };
  }
}
