import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { OtpService } from './otp.service';
import { normalizeDigits } from '../common/phone';
import { env, isDev } from '../config/env';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(private db: DbService, private otp: OtpService) {}

  /** POST /auth/register — profile save (full account OTP verify ke baad active). */
  async register(name: string, phoneDigits10: string) {
    const phone = normalizeDigits(phoneDigits10);
    if (!phone) throw Object.assign(new Error('invalid-phone'), { status: 400 });
    const existing = await this.db.one('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing) {
      await this.db.query('UPDATE users SET name = $1, updated_at = now() WHERE id = $2', [name, existing.id]);
      return { ok: true, exists: true };
    }
    await this.db.query(
      'INSERT INTO users (name, phone) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name',
      [name, phone]);
    return { ok: true, exists: false };
  }

  /** POST /auth/otp/verify ke baad token. */
  async issueTokenAfterVerify(phone: string, name?: string) {
    const existing = await this.db.one<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE phone = $1', [phone]);
    if (!existing) {
      await this.db.query(
        'INSERT INTO users (name, phone, verified_at, updated_at) VALUES ($1, $2, now(), now())',
        [name || '', phone]);
    } else if (name) {
      await this.db.query(
        'UPDATE users SET verified_at = now(), updated_at = now(), name = $1 WHERE id = $2',
        [name, existing.id]);
    } else {
      await this.db.query(
        'UPDATE users SET verified_at = now(), updated_at = now() WHERE id = $1',
        [existing.id]);
    }
    // INSERT/UPDATE ke baad row phir se padhi jaati hai — null par 500 (server fault, client girah nahi).
    const user = await this.db.one<{ id: string; name: string; phone: string }>(
      'SELECT id, name, phone FROM users WHERE phone = $1', [phone]);
    if (!user) throw Object.assign(new Error('user-upsert-returned-no-row'), { status: 500 });
    const shop = await this.db.one(
      `SELECT s.* FROM shops s JOIN shop_members m ON m.shop_id = s.id
       WHERE m.user_id = $1 AND m.role = 'OWNER' LIMIT 1`, [user.id]);
    const token = jwt.sign({ sub: user.id, ph: phone }, env.JWT_SECRET, { expiresIn: '30d' });
    return { token, user: { name: user.name, phone: '+' + phone }, shop: shop || null };
  }

  async me(userId: string) {
    const user = await this.db.one('SELECT id, name, phone, verified_at FROM users WHERE id = $1', [userId]);
    if (!user) throw Object.assign(new Error('no-user'), { status: 401 });
    const shop = await this.db.one(
      `SELECT s.* FROM shops s JOIN shop_members m ON m.shop_id = s.id
       WHERE m.user_id = $1 AND m.role = 'OWNER' LIMIT 1`, [userId]);
    return { user: { name: user.name, phone: '+' + user.phone }, shop: shop || null };
  }

  static signAdmin(email: string): string {
    return jwt.sign({ sub: 'admin', ad: email }, env.ADMIN_JWT_SECRET, { expiresIn: '7d' });
  }

  /** Dev-only helper (OTP devCode exposure sirf isDev && console provider me). */
  get devMode(): boolean { return isDev; }
}
