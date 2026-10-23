import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Http400, Http404, Http409 } from '../common/http-errors';
import { UserRole, ADMIN_ROLES, isAdminRole } from '../common/roles';
import { AdminAuthService } from './admin-auth.service';

/**
 * PART 7 — admin अकाउंट मैनेजमेंट (सिर्फ़ SUPER_ADMIN routes से बुलाया जाता है):
 *   list (कौन कब आया/आख़िरी login) · create (role चुनकर) · patch (role, चालू/
 *   अक्षम, पासवर्ड reset) · पासवर्ड scrypt hash (admin-auth.service).
 *
 * सुरक्षा नियम:
 *   - ख़ुद को अक्षम/डिग्रेड नहीं कर सकते (आख़िरी सुपर-एडमिन दरवाज़े से बाहर न रह जाए).
 *   - आख़िरी चालू SUPER_ADMIN अक्षम/डिग्रेड नहीं होगा (कम से कम एक ज़िंदा रहता है).
 */
@Injectable()
export class AdminUsersService {
  constructor(private db: DbService) {}

  async list() {
    return this.db.query(
      `SELECT id, email, name, role, is_active AS "isActive",
              last_login_at AS "lastLoginAt", created_at AS "createdAt"
         FROM admin_users
        ORDER BY (role = 'SUPER_ADMIN') DESC, created_at`);
  }

  async create(actor: { id: string }, dto: { email: string; name: string; role: string; password: string }) {
    const email = String(dto.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Http400('ईमेल सही नहीं लग रहा');
    if (!isAdminRole(dto.role)) throw Http400('भूमिका SUPER_ADMIN / ADMIN / SUPPORT में चुनें');
    if (dto.role === UserRole.MERCHANT) throw Http400('मर्चेंट admin नहीं बन सकता');
    if (!dto.password || String(dto.password).length < 8) throw Http400('पासवर्ड कम से कम 8 अक्षर');
    const dup = await this.db.one('SELECT id FROM admin_users WHERE email = $1', [email]);
    if (dup) throw Http409('यह ईमेल पहले से admin है');
    const row = await this.db.one(
      `INSERT INTO admin_users (email, name, pwd_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, is_active AS "isActive", created_at AS "createdAt"`,
      [email, String(dto.name || '').trim() || email, AdminAuthService.hashPassword(dto.password), dto.role]);
    await this.db.query(
      `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
       VALUES ($1, 'ADMIN_CREATE', 'admin_users', $2, $3)`,
      [actor.id, row!.id, JSON.stringify({ email, role: dto.role })]);
    return row;
  }

  async patch(actor: { id: string }, adminId: string, dto: { role?: string; isActive?: boolean; password?: string }) {
    const target = await this.db.one<{ id: string; email: string; role: string; is_active: boolean }>(
      'SELECT id, email, role, is_active FROM admin_users WHERE id = $1', [adminId]);
    if (!target) throw Http404('एडमिन नहीं मिला');

    const demoting = dto.role !== undefined && dto.role !== target.role;
    const disabling = dto.isActive === false && target.is_active;
    if (target.id === actor.id && (disabling || demoting)) {
      throw Http400('ख़ुद का अकाउंट अक्षम/डिग्रेड नहीं कर सकते — दूसरा SUPER_ADMIN करें');
    }

    if (disabling || demoting) {
      const sup = await this.db.one<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM admin_users
          WHERE role = 'SUPER_ADMIN' AND is_active AND id <> $1`, [target.id]);
      if (target.role === UserRole.SUPER_ADMIN && Number(sup?.n || 0) === 0) {
        throw Http409('आख़िरी चालू SUPER_ADMIN बंद नहीं होगा — पहले दूसरा SUPER_ADMIN बनाएं');
      }
    }

    if (dto.role !== undefined && !isAdminRole(dto.role)) {
      throw Http400('भूमिका SUPER_ADMIN / ADMIN / SUPPORT में चुनें');
    }
    if (dto.password !== undefined && String(dto.password).length < 8) {
      throw Http400('पासवर्ड कम से कम 8 अक्षर');
    }

    const sets: string[] = [];
    const vals: any[] = [];
    const add = (col: string, v: any) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
    if (dto.role !== undefined) add('role', dto.role);
    if (dto.isActive !== undefined) add('is_active', dto.isActive);
    if (dto.password !== undefined) add('pwd_hash', AdminAuthService.hashPassword(dto.password));
    if (!sets.length) throw Http400('बदलने का कोई फ़ील्ड नहीं');
    add('updated_at', new Date());
    vals.push(adminId);
    await this.db.query(
      `UPDATE admin_users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);

    await this.db.query(
      `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
       VALUES ($1, 'ADMIN_PATCH', 'admin_users', $2, $3)`,
      [actor.id, adminId,
        JSON.stringify({ role: dto.role, isActive: dto.isActive, passwordReset: dto.password !== undefined })]);

    return this.db.one<{ id: string; email: string; name: string; role: string; is_active: boolean }>(
      'SELECT id, email, name, role, is_active FROM admin_users WHERE id = $1', [adminId]);
  }

  /** Role सूची UI के लिए (ADMIN_ROLES — MERCHANT admin panel में नहीं). */
  static readonly ASSIGNABLE: UserRole[] = ADMIN_ROLES;
}
