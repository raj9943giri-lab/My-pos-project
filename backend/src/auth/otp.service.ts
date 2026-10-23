import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { env, isDev } from '../config/env';
import { RateLimiter } from '../common/throttle';
import { maskPhone } from '../common/phone';
import { smsProvider, SmsProvider } from './sms.provider';

const PEPPER = env.JWT_SECRET;                                      // avoid same hash across envs

async function hashCode(phone: string, code: string): Promise<string> {
  return crypto.createHash('sha256').update(phone + ':' + code + ':' + PEPPER).digest('hex');
}

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export interface OtpRequestResult {
  ok: boolean;
  ttlSec: number;
  /** ONLY in development + console provider. Production always undefined. */
  devCode?: string;
}

@Injectable()
export class OtpService {
  private limiter: RateLimiter;
  private sms: SmsProvider;

  constructor(private db: DbService) {
    this.limiter = new RateLimiter(env.OTP_MAX_PER_30MIN, 30 * 60 * 1000);
    this.sms = smsProvider();
  }

  async request(phone: string, purpose: 'LOGIN' | 'REGISTER'): Promise<OtpRequestResult> {
    const gate = this.limiter.hit('otp:' + phone);            // rate-limit: 5 / 30 min
    if (!gate.ok) {
      throw Object.assign(new Error('otp-rate-limited'), { status: 429, retryAfter: gate.retryAfterSec });
    }
    const code = Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');
    const hash = await hashCode(phone, code);
    const ttl = env.OTP_TTL_MINUTES * 60 * 1000;
    // Purani unconsumed codes invalidate (one active code per phone)
    await this.db.query(
      'UPDATE otp_codes SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL', [phone]);
    await this.db.query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
      [phone, hash, purpose, String(env.OTP_TTL_MINUTES)]);

    const masked = maskPhone(phone);
    this.sms.send(phone, `Meri Dukaan login code: ${code} (valid ${env.OTP_TTL_MINUTES} min)`).catch((e) => {
      // Gateway failures sirf generic log — code kisi log me nahi jata
      console.error('[otp] sms send failed for', masked, e.message);
    });

    const out: OtpRequestResult = { ok: true, ttlSec: env.OTP_TTL_MINUTES * 60 };
    if (isDev && env.SMS_PROVIDER === 'console') out.devCode = code;   // DEV-ONLY mock mode
    return out;
  }

  async verify(phone: string, code: string): Promise<{ ok: boolean }> {
    const rows = await this.db.query<{ id: number; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM otp_codes
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [phone]);
    const row = rows[0];
    if (!row) throw Object.assign(new Error('no-otp'), { status: 400 });
    if (row.attempts >= env.OTP_MAX_ATTEMPTS) {
      await this.db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
      throw Object.assign(new Error('otp-locked'), { status: 429 });
    }
    const ok = timingSafeEq(await hashCode(phone, code), row.code_hash);
    if (!ok) {
      await this.db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      throw Object.assign(new Error('wrong-code'), { status: 400 });
    }
    await this.db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    return { ok: true };
  }
}
