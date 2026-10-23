import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Http400, Http404 } from '../common/http-errors';
import { validatePolicyPayload } from './policies.rules';

/**
 * PART 7 — platform policies (admin-editable नियम, JSONB value).
 * PATCH पर value पहले per-key validator (policies.rules.ts) से जाँचा जाता
 * है — गलत आकार DB तक नहीं जाता; हर बदलाव audit_log में.
 */
@Injectable()
export class PoliciesService {
  constructor(private db: DbService) {}

  async list() {
    return this.db.query(
      `SELECT key, value, label, description,
              updated_at AS "updatedAt",
              (SELECT email FROM admin_users a WHERE a.id = p.updated_by) AS "updatedByEmail"
         FROM platform_policies p
        ORDER BY key`);
  }

  async update(admin: { id: string }, key: string, payload: unknown) {
    const res = validatePolicyPayload(key, payload);
    if (!res.ok) throw Http400(res.message);
    const value = { value: (res as { value: unknown }).value };

    const row = await this.db.one(
      `UPDATE platform_policies
          SET value = $2::jsonb, updated_by = $3, updated_at = now()
        WHERE key = $1
        RETURNING key, value, label, updated_at AS "updatedAt"`,
      [key, JSON.stringify(value), admin.id]);
    if (!row) throw Http404('पॉलिसी key नहीं मिली');

    await this.db.query(
      `INSERT INTO audit_log (admin_id, action, entity, entity_id, meta)
       VALUES ($1, 'POLICY_UPDATE', 'platform_policies', $2, $3)`,
      [admin.id, key, JSON.stringify({ newValue: value })]);
    return row;
  }
}
