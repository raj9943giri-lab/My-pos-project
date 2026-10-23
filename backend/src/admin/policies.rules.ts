/**
 * PART 7 — platform policies के per-key value validators (pure, DB-free).
 *
 * platform_policies.value JSONB है; हर key का अपना आकार नियम यहाँ तय है.
 * हो सकता है भविष्य में यही नियम सर्वर के अन्य हिस्सों (checkout COD सीमा,
 * SLA चेतावनी) को पढ़ने लगें — तो वे भी इसी key-name से पढ़ें.
 */
export type PolicyValidateResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

export interface PolicySpec {
  validate: (v: unknown) => PolicyValidateResult;
}

const numBetween = (min: number, max: number, label: string) =>
  (v: unknown): PolicyValidateResult => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) return { ok: false, message: label + ' — संख्या डालें' };
    if (n < min || n > max) return { ok: false, message: `${label} ${min}…${max} के बीच` };
    return { ok: true, value: n };
  };

const boolOf = (v: unknown): PolicyValidateResult =>
  typeof v === 'boolean' || v === 'true' || v === 'false'
    ? { ok: true, value: v === true || v === 'true' }
    : { ok: false, message: 'true/false ही चलेगा' };

/** key → नियम. नए policies जुड़ें तो यहाँ + migration seed दोनों में. */
export const POLICY_SPECS: Record<string, PolicySpec> = {
  commission_default_pct: { validate: numBetween(0, 30, 'कमीशन %') },
  cod_max_order:          { validate: numBetween(0, 1000000, 'COD सीमा ₹') },
  shop_approval_sla_hrs:  { validate: numBetween(1, 720, 'अप्रूवल SLA घंटे') },
  complaint_sla_hrs:      { validate: numBetween(1, 720, 'शिकायत SLA घंटे') },
  refund_window_days:     { validate: numBetween(0, 90, 'रिफ़ंड विंडो दिन') },
  auto_publish_on_approve: { validate: boolOf },
  max_categories_per_shop: { validate: numBetween(1, 12, 'कैटेगरी सीमा') },
};

export function validatePolicy(key: string, value: unknown): PolicyValidateResult {
  const spec = POLICY_SPECS[key];
  if (!spec) return { ok: false, message: 'अज्ञात पॉलिसी key: ' + key };
  return spec.validate(value);
}

/** पूरा value-शेप जाँच: { value: … } के अंदर वास्तविक मान रहता है. */
export function validatePolicyPayload(key: string, payload: unknown): PolicyValidateResult {
  const inner = (payload as { value?: unknown })?.value;
  if (inner === undefined) return { ok: false, message: 'body { "value": … } के रूप में भेजें' };
  return validatePolicy(key, inner);
}
