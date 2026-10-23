/* PART 7 — platform policies के validators (pure, DB-free). */
import { POLICY_SPECS, validatePolicy, validatePolicyPayload } from '../../src/admin/policies.rules';

describe('PART 7 policies validation', () => {
  it('हर seeded key का spec मौजूद है (migration seed से sync)', () => {
    for (const key of [
      'commission_default_pct', 'cod_max_order', 'shop_approval_sla_hrs',
      'complaint_sla_hrs', 'refund_window_days', 'auto_publish_on_approve',
      'max_categories_per_shop',
    ]) {
      expect(POLICY_SPECS[key]).toBeDefined();
    }
  });

  it('number keys: श्रेणी-सीमा + string भी चले (form-data), junk नहीं', () => {
    expect(validatePolicy('commission_default_pct', 5)).toMatchObject({ ok: true, value: 5 });
    expect(validatePolicy('commission_default_pct', '7.5')).toMatchObject({ ok: true, value: 7.5 });
    expect(validatePolicy('commission_default_pct', 'abc').ok).toBe(false);
    expect(validatePolicy('commission_default_pct', 99).ok).toBe(false);
    expect(validatePolicy('cod_max_order', -1).ok).toBe(false);
    expect(validatePolicy('shop_approval_sla_hrs', 0).ok).toBe(false);
    expect(validatePolicy('shop_approval_sla_hrs', 721).ok).toBe(false);
    expect(validatePolicy('complaint_sla_hrs', 48)).toMatchObject({ ok: true, value: 48 });
    expect(validatePolicy('refund_window_days', 7)).toMatchObject({ ok: true, value: 7 });
    expect(validatePolicy('max_categories_per_shop', '3')).toMatchObject({ ok: true, value: 3 });
  });

  it('boolean key: true/false/string-both, बाकी मना', () => {
    expect(validatePolicy('auto_publish_on_approve', true)).toMatchObject({ ok: true, value: true });
    expect(validatePolicy('auto_publish_on_approve', 'false')).toMatchObject({ ok: true, value: false });
    expect(validatePolicy('auto_publish_on_approve', 1).ok).toBe(false);
    expect(validatePolicy('auto_publish_on_approve', 'haan').ok).toBe(false);
  });

  it('अज्ञात key मना', () => {
    expect(validatePolicy('not_a_policy', 1).ok).toBe(false);
  });

  it('payload { value: … } कवर करता है', () => {
    expect(validatePolicyPayload('cod_max_order', { value: 5000 })).toMatchObject({ ok: true, value: 5000 });
    expect(validatePolicyPayload('cod_max_order', {}).ok).toBe(false);
    expect(validatePolicyPayload('cod_max_order', { value: 'x' }).ok).toBe(false);
  });
});
