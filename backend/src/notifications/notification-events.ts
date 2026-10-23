/**
 * PART 5 — notification event helpers (DB-free, unit-tested).
 *
 * नियम:
 *  - Push text में कभी ग्राहक का पता/पेमेंट विवरण नहीं जाता — सिर्फ़ order
 *    नंबर, स्थिति और total (total भी केवल नियमों के अनुसार).
 *  - "Queue हो गया" ≠ "पहुँच गया" — इसलिए outbox processor बाद में सही
 *    परिणाम (DONE प.push भेजा / SKIPPED provider configured नहीं) दर्ज करता है.
 *  - कोई provider secret यहाँ नहीं — env (FCM_SERVER_KEY) main.ts जैसा.
 */

export type OrderEventType =
  | 'ORDER_NEW'
  | 'ORDER_ACCEPTED'
  | 'ORDER_REJECTED'
  | 'ORDER_PREPARING'
  | 'ORDER_READY'
  | 'ORDER_OUT_FOR_DELIVERY'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'ORDER_PAYMENT_MARKED';

export const ORDER_EVENT_TYPES: OrderEventType[] = [
  'ORDER_NEW', 'ORDER_ACCEPTED', 'ORDER_REJECTED', 'ORDER_PREPARING',
  'ORDER_READY', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_COMPLETED',
  'ORDER_CANCELLED', 'ORDER_PAYMENT_MARKED',
];

/** हर event का स्थापित हिंदी शीर्षक + body template (पता/पेमेंट नहीं). */
export function orderEventText(
  event: OrderEventType,
  orderNumber: string,
  total?: number,
): { title: string; body: string } {
  const t = (title: string, body: string): { title: string; body: string } => ({ title, body });
  switch (event) {
    case 'ORDER_NEW':             return t('नया ऑर्डर आया 🧾', 'ऑर्डर ' + orderNumber + prefix(total) + ' — ऐप में खोलें और स्वीकार करें.');
    case 'ORDER_ACCEPTED':        return t('ऑर्डर स्वीकार हुआ ✅', 'ऑर्डर ' + orderNumber + ' दुकान ने स्वीकार किया.');
    case 'ORDER_REJECTED':        return t('ऑर्डर स्वीकार नहीं हुा', 'ऑर्डर ' + orderNumber + ' दुकान ने स्वीकार नहीं किया.');
    case 'ORDER_PREPARING':       return t('सामान बनने में 👨‍🍳', 'ऑर्डर ' + orderNumber + ' की तैयारी शुरू.');
    case 'ORDER_READY':           return t('ऑर्डर तैयार 🎒', 'ऑर्डर ' + orderNumber + ' लेने/भेजने के लिए तैयार.');
    case 'ORDER_OUT_FOR_DELIVERY': return t('डिलीवरी पर 🛵', 'ऑर्डर ' + orderNumber + ' आपकी ओर आ रहा है.');
    case 'ORDER_COMPLETED':       return t('ऑर्डर पूरा 🎉', 'ऑर्डर ' + orderNumber + ' पूरा हो गया.');
    case 'ORDER_CANCELLED':       return t('ऑर्डर रद्द ✖️', 'ऑर्डर ' + orderNumber + ' रद्द किया गया.');
    case 'ORDER_PAYMENT_MARKED':  return t('पेमेंट दर्ज 💰', 'ऑर्डर ' + orderNumber + ' की पेमेंट पुष्टि दर्ज हुई.');
    default:                      return t('ऑर्डर अपडेट', 'ऑर्डर ' + orderNumber + ' अपडेट — ऐप खोलें.');
  }
}
function prefix(total?: number): string {
  const ok = total !== undefined && Number.isFinite(Number(total));
  return ok ? ' (₹' + (Math.round(Number(total) * 100) / 100) + ')' : '';
}

/** रेज़न फ़ील्ड की सफ़ाई — line break निकाले, लंबाई cap (स्टेटस हिस्ट्री भी यही रखेगा). */
export function sanitizeReason(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return s.slice(0, 300);
}

/** Bounded retry का backoff (मिनट): 1, 2, 4, 8, 16 फिर 16 ही. */
export function backoffMinutes(afterAttempts: number): number {
  return Math.min(16, Math.pow(2, Math.max(0, afterAttempts - 1)));
}

/** सबसे ज़्यादा कितनी कोशिश — उसके बाद row FAILED पर जमा (मैन्युअल जाँच के लिए). */
export const MAX_ATTEMPTS = 5;

/** ऑडिट नियम: इस event में push body के साथ total भी जाएगा? */
export function pickTotal(event: OrderEventType, totals?: { total?: number }): number | undefined {
  if (event === 'ORDER_NEW') return totals && Number(totals.total);
  return undefined;
}
