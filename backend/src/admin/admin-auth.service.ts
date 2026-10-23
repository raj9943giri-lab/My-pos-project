import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { env, isDev } from '../config/env';
import { Http400, Http401 } from '../common/http-errors';
import { UserRole } from '../common/roles';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

/**
 * PART 7 — admin login + password hashing.
 *
 * Password: node crypto.scrypt (कोई नया dependency नहीं) — format:
 *   scrypt$<N>$<saltHex>$<derivedHex>   (verify पर timingSafeEqual)
 * Login: email+password → admin JWT { sub, ad, rl } 12 घंटे.
 * Bootstrap: admin_users खाली हो और ADMIN_EMAIL/ADMIN_PASSWORD .env में हो तो
 * पहला SUPER_ADMIN अपने-आप बनता है (module init पर एक बार) — वरना कोई login
 * नहीं बन पाता. DB में plaintext कभी नहीं जाता.
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  constructor(private db: DbService) {}

  /* ------------------------------ hashing -------------------------------- */
  static hashPassword(password: string): string {
    const N = 16384, r = 8, p = 1, keylen = 64;
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, keylen, { N, r, p });
    return ['scrypt', String(N), salt.toString('hex'), derived.toString('hex')].join('$');
  }

  static verifyPassword(password: string, stored: string | null | undefined): boolean {
    try {
      const parts = String(stored || '').split('$');
      if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
      const N = Number(parts[1]);
      const salt = Buffer.from(parts[2], 'hex');
      const expected = Buffer.from(parts[3], 'hex');
      const derived = crypto.scryptSync(password, salt, expected.length, { N, r: 8, p: 1 });
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /* ---------------------------- bootstrap -------------------------------- */
  /** admin_users खाली + .env credentials → पहला SUPER_ADMIN. Idempotent. */
  async ensureBootstrap(): Promise<void> {
    try {
      const row = await this.db.one<{ n: string }>('SELECT COUNT(*)::text AS n FROM admin_users');
      if (row && Number(row.n) > 0) return;
      if (!env.ADMIN_PASSWORD) return; // main.ts production में पहले ही रोक चुका
      const email = env.ADMIN_EMAIL || 'admin@pos.local';
      await this.db.query(
        `INSERT INTO admin_users (email, name, pwd_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [email.toLowerCase(), 'मुख्य एडमिन', AdminAuthService.hashPassword(env.ADMIN_PASSWORD), UserRole.SUPER_ADMIN],
      );
      if (isDev) console.log('[admin-auth] bootstrap SUPER_ADMIN बना:', email);
    } catch (e: any) {
      // bootstrap fail = server start न रुके (table न होना पर भी) — login वैसे 401 देगा.
      console.error('[admin-auth] bootstrap skipped:', e && e.message);
    }
  }

  async onModuleInit() { await this.ensureBootstrap(); }

  /* ------------------------------- login --------------------------------- */
  async login(emailRaw: string, password: string) {
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email || !password) throw Http400('ईमेल और पासवर्ड दोनों ज़रूरी');
    const admin = await this.db.one<{
      id: string; email: string; name: string; role: string; pwd_hash: string; is_active: boolean;
    }>('SELECT id, email, name, role, pwd_hash, is_active FROM admin_users WHERE email = $1', [email]);
    // Enumeration-रोक: गलत ईमेल पर भी एक dummy scrypt चलाते हैं ताकि जवाब का
    // समय एक जैसा रहे (हमेशा 401 — असली कारण में नहीं बताते).
    const ok = admin
      ? AdminAuthService.verifyPassword(password, admin.pwd_hash)
      : AdminAuthService.verifyPassword(password, DUMMY_HASH);
    if (!admin || !ok) throw Http401('ईमेल या पासवर्ड गलत है');
    if (!admin.is_active) throw Http401('यह admin अकाउंट अक्षम किया गया है — SUPER_ADMIN से संपर्क करें');

    const role = admin.role as UserRole;
    const token = jwt.sign(
      { sub: admin.id, ad: admin.email, rl: role },
      env.ADMIN_JWT_SECRET,
      { expiresIn: '12h' },
    );
    await this.db.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [admin.id]);
    await this.db.query(
      `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
       VALUES ($1, 'ADMIN_LOGIN', 'admin_users', $2, '{}')`,
      [admin.id, admin.id],
    );
    return {
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role },
      expiresInHours: 12,
    };
  }

  /** GET /admin/me — चालू सत्र की ताज़ा भूमिका (RolesGuard DB से जाँच चुका). */
  async me(admin: { id: string; email: string; role: UserRole | string }) {
    const row = await this.db.one<{ id: string; email: string; name: string; role: string; last_login_at: string }>(
      'SELECT id, email, name, role, last_login_at FROM admin_users WHERE id = $1', [admin.id]);
    if (!row) throw Http401('Admin session समाप्त');
    return {
      admin: { id: row.id, email: row.email, name: row.name, role: row.role },
      lastLoginAt: row.last_login_at,
    };
  }
}

/** गलत-ईमेल पर भी एक जैसा CPU काम — यह hash असली किसी password का नहीं. */
const DUMMY_HASH = 'scrypt$16384$00000000000000000000000000000000$' + '0'.repeat(128);
