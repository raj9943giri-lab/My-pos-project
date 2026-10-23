import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ShopScopeService } from '../shop-scope/shop-scope.service';
import { Http400, Http403, Http404, Http409 } from '../common/http-errors';
import {
  ComplaintCategory, ComplaintPriority, complaintTransition, UserRole,
} from '../common/roles';
import { CreateComplaintDto, ListComplaintsQueryDto } from './dto';

/**
 * PART 7 — शिकायत (complaints) जीवन-चक्र:
 *
 *   दर्ज करने के दो सार्वजनिक दरवाज़े:
 *     · ग्राहक: POST /public/orders/:token/complaint (token = ऑर्डर का random
 *       access token — बिना लॉगिन; rate-limited; ऑर्डर से दुकान+ग्राहक जुड़ते हैं)
 *     · दुकानदार: POST /shops/:shopId/complaints (member JWT)
 *   प्रबंधन (admin panel, role-matrix):
 *     · list/detail: SUPER_ADMIN + ADMIN + SUPPORT
 *     · status कदम: वही तीनों — START (ज़िम्मेदारी + पहला जवाब) → RESOLVE
 *       (हल-नोट ज़रूरी) → CLOSED; REOPEN (RESOLVED → IN_PROGRESS).
 *       SUPPORT शिकायत सिर्फ़ ख़ुद के नाम ले सकता है; SUPER/ADMIN किसी को भी सौंपें.
 *
 * Status का एक ही दरवाज़ा — act(): row FOR UPDATE → नियम (complaintTransition)
 * → UPDATE + complaint_status_history + audit_log एक ही TRANSACTION में. दोहरा
 * tap रेस में भी दूसरा कदम 409 खाता है — इतिहास दो बार नहीं लिखता.
 */
@Injectable()
export class ComplaintsService {
  /** order public_token (DB में UUID) — ग़लत आकार पहले ही रोकें, वरना
   *  PG uuid-cast 500 देता है (जैसे public-store का orderPublic करता है). */
  private static HEX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(private db: DbService, private scope: ShopScopeService) {}

  /* ------------------------------- filing -------------------------------- */
  /** ग्राहक — order public_token से (कोई login नहीं; controller rate-limit). */
  async createForOrder(token: string, dto: CreateComplaintDto) {
    const t = String(token || '').trim().toLowerCase();
    if (!ComplaintsService.HEX_UUID_RE.test(t)) {
      throw Http404('यह ऑर्डर शिकायत के लिए नहीं मिला — लिंक दोबारा जाँचें');
    }
    const order = await this.db.one<{ id: number; shop_id: string; customer_name: string; customer_phone: string }>(
      `SELECT id, shop_id, customer_name, customer_phone
         FROM orders WHERE public_token = $1::uuid AND status NOT IN ('CANCELLED', 'REJECTED')`,
      [t]);
    if (!order) throw Http404('यह ऑर्डर शिकायत के लिए नहीं मिला (token ग़लत या ऑर्डर रद्द/अस्वीकृत)');

    const created = await this.insert({
      shopId: order.shop_id,
      orderId: order.id,
      category: dto.category as ComplaintCategory,
      priority: (dto.priority || 'NORMAL') as ComplaintPriority,
      source: 'CUSTOMER',
      body: dto.body,
      customerName: dto.customerName?.trim() || order.customer_name || null,
      customerPhone: dto.customerPhone?.replace(/\D/g, '') || order.customer_phone || null,
      orderRef: 'S-' + String(order.id).padStart(6, '0'),
    });
    return { complaint: created };
  }

  /** दुकानदार — अपनी दुकान की शिकायत (platform से). */
  async createForMerchant(userId: string, shopId: string, dto: CreateComplaintDto) {
    await this.scope.requireShopMember(userId, shopId);
    const created = await this.insert({
      shopId,
      orderId: null,
      category: dto.category as ComplaintCategory,
      priority: (dto.priority || 'NORMAL') as ComplaintPriority,
      source: 'MERCHANT',
      body: dto.body,
      customerName: null,
      customerPhone: null,
      orderRef: null,
    });
    return { complaint: created };
  }

  private async insert(input: {
    shopId: string; orderId: number | null; category: ComplaintCategory;
    priority: ComplaintPriority; source: 'CUSTOMER' | 'MERCHANT'; body: string;
    customerName: string | null; customerPhone: string | null; orderRef: string | null;
  }) {
    const row = await this.db.one(
      `INSERT INTO complaints
         (shop_id, order_id, order_ref, category, priority, source,
          body, customer_name, customer_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN')
       RETURNING id::text AS id, shop_id AS "shopId", category, priority, source,
                 status, body, created_at AS "createdAt"`,
      [input.shopId, input.orderId, input.orderRef, input.category, input.priority,
        input.source, input.body, input.customerName, input.customerPhone]);
    await this.db.query(
      `INSERT INTO complaint_status_history (complaint_id, from_status, to_status, action, note)
       VALUES ($1, NULL, 'OPEN', 'CREATE', $2)`,
      [(row as any).id, input.source === 'CUSTOMER' ? 'ग्राहक ने दर्ज की' : 'दुकानदार ने दर्ज की']);
    return row;
  }

  /* ---------------------------- admin: list/detail ------------------------ */
  async list(query: ListComplaintsQueryDto, admin: { id: string }) {
    const where: string[] = [];
    const vals: any[] = [];
    /** केवल '?' वाले ही clause ही param लेते हैं — बिना-placeholder वाले
     *  clause (IS NULL आदि) value नहीं खाएँगे, वरना अप्रयुक्त NULL param से
     *  PG "could not determine data type" देता है. */
    const add = (clause: string, v: any) => {
      if (!clause.includes('?')) { where.push(clause); return; }
      vals.push(v);
      where.push(clause.replace('?', '$' + vals.length));
    };

    if (query.status) add('c.status = ?', query.status);
    if (query.priority) add('c.priority = ?', query.priority);
    if (query.shopId) add('c.shop_id = ?', query.shopId);
    if (query.assigned === 'me') add('c.assigned_to = ?', admin.id);
    if (query.assigned === 'unassigned') add('c.assigned_to IS NULL', null);
    const term = (query.q || '').trim();
    if (term) {
      vals.push('%' + term + '%');
      where.push(`(c.body ILIKE $${vals.length} OR c.order_ref ILIKE $${vals.length}
                   OR s.shop_name ILIKE $${vals.length} OR c.customer_name ILIKE $${vals.length})`);
    }

    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const page = Math.min(Math.max(Number(query.page) || 1, 1), 500);
    vals.push(limit, (page - 1) * limit);
    const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const totalRow = await this.db.one<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total
         FROM complaints c JOIN shops s ON s.id = c.shop_id ${cond}`,
      vals.slice(0, -2));
    const items = await this.db.query(
      `SELECT c.id::text AS id, c.status, c.category, c.priority, c.source,
              c.body, c.order_ref AS "orderRef", c.customer_name AS "customerName",
              c.assigned_to AS "assignedTo", (SELECT name FROM admin_users a WHERE a.id = c.assigned_to) AS "assignedName",
              s.shop_name AS "shopName", s.id AS "shopId", s.slug AS "shopSlug",
              c.first_response_at AS "firstResponseAt", c.resolved_at AS "resolvedAt",
              c.created_at AS "createdAt"
         FROM complaints c JOIN shops s ON s.id = c.shop_id
         ${cond}
        ORDER BY (c.priority = 'HIGH') DESC, (c.status = 'OPEN') DESC, c.created_at
        LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals);
    return { items, total: Number(totalRow?.total || 0), page, limit, hasMore: page * limit < Number(totalRow?.total || 0) };
  }

  async detail(id: number) {
    const row = await this.db.one(
      `SELECT c.id::text AS id, c.status, c.category, c.priority, c.source, c.body,
              c.order_ref AS "orderRef", c.order_id AS "orderId",
              c.customer_name AS "customerName", c.customer_phone AS "customerPhone",
              c.assigned_to AS "assignedTo", (SELECT name FROM admin_users a WHERE a.id = c.assigned_to) AS "assignedName",
              s.shop_name AS "shopName", s.id AS "shopId", s.slug AS "shopSlug",
              s.owner_name AS "ownerName", s.owner_phone AS "ownerPhone",
              c.first_response_at AS "firstResponseAt", c.resolved_at AS "resolvedAt",
              c.closed_at AS "closedAt", c.resolution_note AS "resolutionNote",
              c.created_at AS "createdAt", c.updated_at AS "updatedAt"
         FROM complaints c JOIN shops s ON s.id = c.shop_id
        WHERE c.id = $1`, [id]);
    if (!row) throw Http404('शिकायत नहीं मिली');
    const history = await this.db.query(
      `SELECT h.from_status AS "from", h.to_status AS "to", h.action, h.note,
              h.created_at AS "at", a.name AS "adminName"
         FROM complaint_status_history h
         LEFT JOIN admin_users a ON a.id = h.actor_admin_id
        WHERE h.complaint_id = $1 ORDER BY h.created_at`, [id]);
    const notes = await this.db.query(
      `SELECT n.id, n.body, n.is_internal AS "isInternal", n.author_name AS "authorName",
              n.created_at AS "at"
         FROM complaint_notes n WHERE n.complaint_id = $1 ORDER BY n.created_at`, [id]);
    const allowed = (Object.values(['START', 'RESOLVE', 'CLOSE', 'REOPEN']) as string[])
      .filter((a) => complaintTransition(row.status, a).ok);
    return { complaint: row, history, notes, allowedActions: allowed };
  }

  /* --------------------------- admin: lifecycle --------------------------- */
  /**
   * act() — START/RESOLVE/CLOSE/REOPEN. RESOLVE पर हल-नोट ज़रूरी (नियम से),
   * START पर ज़िम्मेदारी लगती है (SUPPORT ख़ुद को ही सौंप सकता है).
   */
  async act(
    admin: { id: string; role: UserRole | string },
    id: number,
    dto: { action: string; note?: string; noteAny?: string; assignTo?: string },
  ) {
    const note = String(dto.note ?? dto.noteAny ?? '').trim() || null;

    return this.db.tx(async (q) => {
      const rows = await (q as any)(
        `SELECT c.id, c.status, c.assigned_to, c.first_response_at
           FROM complaints c WHERE c.id = $1 FOR UPDATE`, [id]);
      const cur = rows[0];
      if (!cur) throw Http404('शिकायत नहीं मिली');

      const res = complaintTransition(cur.status, dto.action);
      if (!res.ok) throw Http409(res.message, { code: res.code, currentStatus: cur.status });

      // किसे सौंपा — START/REOPEN पर तय होता है
      let assignee: string | null = cur.assigned_to;
      if (res.assigns) {
        if (dto.assignTo && String(dto.assignTo) !== String(admin.id)) {
          if (admin.role !== UserRole.SUPER_ADMIN && admin.role !== UserRole.ADMIN) {
            throw Http403('SUPPORT शिकायत सिर्फ़ ख़ुद को सौंप सकता है');
          }
          const target = await (q as any)(
            'SELECT id, role, is_active FROM admin_users WHERE id = $1', [dto.assignTo]);
          if (!target[0] || !target[0].is_active) throw Http400('यह admin मौजूद/चालू नहीं है');
          assignee = dto.assignTo;
        } else {
          assignee = admin.id; // ख़ुद की ज़िम्मेदारी (default)
        }
      }

      // PG पैरामीटर positional होते हैं — क्रम $1… से ही (set करने वाला
      // clause का '?' ही value खाता है; बिना-'?' clause कोई param नहीं).
      const sets: string[] = [];
      const vals: any[] = [];
      const add = (clause: string, v: any) => {
        if (!clause.includes('?')) { sets.push(clause); return; }
        vals.push(v);
        sets.push(clause.replace('?', '$' + vals.length));
      };
      add('status = ?', res.next);
      sets.push('updated_at = now()');
      if (res.assigns) add('assigned_to = ?', assignee);
      if (res.assigns && !cur.first_response_at) sets.push('first_response_at = now()');
      if (dto.action === 'RESOLVE') {
        sets.push('resolved_at = now()');
        add('resolution_note = ?', note);
      }
      if (dto.action === 'CLOSE') sets.push('closed_at = now()');
      if (dto.action === 'REOPEN') sets.push('resolved_at = NULL', 'closed_at = NULL');
      vals.push(id); // WHERE — आख़िरी placeholder
      await (q as any)(
        `UPDATE complaints SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);

      await (q as any)(
        `INSERT INTO complaint_status_history (complaint_id, from_status, to_status, action, note, actor_admin_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, cur.status, res.next, dto.action, note, admin.id]);
      await (q as any)(
        `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
         VALUES ($1, $2, 'complaints', $3, $4)`,
        [admin.id, 'COMPLAINT_' + dto.action, String(id),
          JSON.stringify({ from: cur.status, to: res.next })]);

      return {
        id: String(id),
        status: res.next,
        previousStatus: cur.status,
        assignedTo: assignee,
        firstResponseAt: cur.first_response_at || (res.assigns ? new Date().toISOString() : null),
        resolutionNote: dto.action === 'RESOLVE' ? note : undefined,
      };
    });
  }

  /** टिप्पणी धागा — चालू/बंद दोनों हाल में लिख सकते हैं (हल के बाद भी नोट). */
  async addNote(admin: { id: string; role: UserRole | string; email: string }, id: number, body: string, isInternal?: boolean) {
    const cur = await this.db.one<{ id: number }>('SELECT id FROM complaints WHERE id = $1', [id]);
    if (!cur) throw Http404('शिकायत नहीं मिली');
    const nameRow = await this.db.one<{ name: string }>('SELECT name FROM admin_users WHERE id = $1', [admin.id]);
    const note = await this.db.one(
      `INSERT INTO complaint_notes (complaint_id, author_admin_id, author_name, body, is_internal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, body, is_internal AS "isInternal", created_at AS "at"`,
      [id, admin.id, nameRow?.name || admin.email, body.trim(), isInternal !== false]);
    await this.db.query('UPDATE complaints SET updated_at = now() WHERE id = $1', [id]);
    return note;
  }
}
