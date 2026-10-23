import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Http403, Http404 } from '../common/http-errors';

/**
 * PART 3 tenant scoping.
 *
 * Every catalogue query is filtered by `shop_id` so one merchant can never read
 * or mutate another shop's products. A merchant may belong to several shops;
 * the catalogue screens always operate on the "primary" shop (OWNER membership
 * first, then the oldest shop).
 *
 * Roles (PART 2 `shop_members.role`):
 *   OWNER   – full control
 *   MANAGER – full catalogue control (create/update/delete, bulk price)
 *   STAFF   – read + operational stock adjustments only
 */
@Injectable()
export class ShopScopeService {
  constructor(private db: DbService) {}

  /** Primary shop id of the user, or null when the user has no shop yet. */
  async primaryShopId(userId: string): Promise<string | null> {
    const row = await this.db.one<{ id: string }>(
      `SELECT s.id
         FROM shops s
         JOIN shop_members m ON m.shop_id = s.id
        WHERE m.user_id = $1
        ORDER BY (m.role = 'OWNER') DESC, s.created_at ASC
        LIMIT 1`,
      [userId],
    );
    return row ? row.id : null;
  }

  /** Primary shop id or 404 (merchant has not created a shop yet). */
  async requireShopId(userId: string): Promise<string> {
    const id = await this.primaryShopId(userId);
    if (!id) throw Http404('पहले अपनी दुकान बनाएं — फिर प्रोडक्ट जोड़ें');
    return id;
  }

  /** Membership role of the user inside the shop (null = not a member). */
  async roleOf(userId: string, shopId: string): Promise<string | null> {
    const m = await this.db.one<{ role: string }>(
      'SELECT role FROM shop_members WHERE shop_id = $1 AND user_id = $2',
      [shopId, userId],
    );
    return m ? m.role : null;
  }

  /**
   * Catalogue write access (OWNER / MANAGER): create, update, delete,
   * category management and bulk price edits.
   */
  async requireManage(userId: string, shopId: string): Promise<void> {
    const role = await this.roleOf(userId, shopId);
    if (!role) throw Http403('यह दुकान आपकी नहीं है');
    if (role === 'STAFF') throw Http403('स्टाफ प्रोडक्ट/कीमत नहीं बदल सकता');
  }

  /**
   * Operational write access (OWNER / MANAGER / STAFF): stock adjustments.
   */
  async requireOperate(userId: string, shopId: string): Promise<void> {
    const role = await this.roleOf(userId, shopId);
    if (!role) throw Http403('यह दुकान आपकी नहीं है');
  }

  /**
   * PART 5 — membership check for a *client-supplied* shop id (order routes).
   * Returns the role; throws 403 when the user is not a member of that shop
   * (दूसरी दुकान के ऑर्डर कभी नहीं दिखते — URL का shopId भरोसेमंद नहीं होता).
   * Catalogue routes use primaryShopId(); order list uses the explicit id so
   * STAFF/MANAGER multi-shop members read the shop they asked about.
   */
  async requireShopMember(userId: string, shopId: string): Promise<string> {
    const role = await this.roleOf(userId, shopId);
    if (!role) throw Http403('यह दुकान आपकी नहीं है');
    return role;
  }
}
