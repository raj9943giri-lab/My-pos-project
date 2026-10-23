/**
 * Phone helpers — normalized international formats (DB requirement).
 *  - users.phone / otp_codes.phone      → digits without '+', e.g. 919876543210
 *  - shops.whatsapp_number/business     → E.164 with '+', e.g. +919876543210
 */

export const IND_MOBILE_RE = /^[6-9]\d{9}$/;

/** → '919876543210' (digits) ya null agar invalid. Indian + generic support. */
export function normalizeDigits(raw: string): string | null {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 && IND_MOBILE_RE.test(d)) d = '91' + d;          // India
  else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  else if (d.length === 12 && d.startsWith('91')) d = d;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

/** → '+919876543210' (E.164 with plus) ya null. */
export function normalizeE164(raw: string): string | null {
  const d = normalizeDigits(raw);
  return d ? '+' + d : null;
}

export function isValidE164(v: string): boolean {
  return /^\+\d{10,15}$/.test(String(v || ''));
}

/** +91987654xxxx (masking for logs/errors — koi sensitive data leak nahi). */
export function maskPhone(digits: string): string {
  const d = String(digits || '');
  return '+' + d.slice(0, 5) + 'xxxxx' + d.slice(-2);
}
