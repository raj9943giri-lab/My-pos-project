/**
 * PART 5 — pure order-lifecycle rules (DB-free → unit tested).
 *
 * सिर्फ़ दो रास्ते order status बदलते हैं — यह transition map + service का
 * transaction (orders FOR UPDATE row-lock)। Client कोई arbitrary status नहीं
 * भेजता — सिर्फ़ *action* (accept/reject/prepare/…) भेजता है; अगला status यहीं
 * से निकलता है. Rejection और cancellation अलग नतीजे हैं.
 *
 * Status model Part 1/4 पर खड़ा है — पहले से थे NEW/तैयार/PREPARED/TRANSIT/
 * DELIVERED/CANCELLED; नए कदम ACCEPTED और PREPARING जुड़े, ताकि lifecycle पूरा
 * हो (pending→accepted→preparing→ready→out→completed). REJECTED ग्राहक के सामने
 * "दुकान ने स्वीकार नहीं किया" बनता है, CANCELLED से अलग.
 */

export type OrderStatus =
  | 'NEW' | 'ACCEPTED' | 'PREPARING' | 'PREPARED'
  | 'TRANSIT' | 'DELIVERED' | 'REJECTED' | 'CANCELLED';

export type Fulfilment = 'DELIVERY' | 'PICKUP';
export type PayMode = 'COD' | 'PON' | 'UPI_QR';

/** सारे मान्य statuses — कहीं और से कोई string orders.status में नहीं जाती. */
export const ORDER_STATUSES: OrderStatus[] = [
  'NEW', 'ACCEPTED', 'PREPARING', 'PREPARED',
  'TRANSIT', 'DELIVERED', 'REJECTED', 'CANCELLED',
];

/** जिन statuses से मर्चेंट (या ग्राहक) का cancel स्वीकार है. TRANSIT से नहीं —
 *  सामान रास्ते में है; merchant DELIVERED करे या आपस में मिलाए. */
export const CANCELLABLE: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED'];

/** हिंदी labels (customer-web भी यही list मिरर करता है). */
export const ORDER_STATUS_HI: Record<OrderStatus, string> = {
  NEW: 'नया',
  ACCEPTED: 'स्वीकार किया गया',
  PREPARING: 'बनने में',
  PREPARED: 'तैयार',
  TRANSIT: 'रास्ते में',
  DELIVERED: 'पूरी',
  REJECTED: 'स्वीकार नहीं हुआ',
  CANCELLED: 'रद्द',
};

export type MerchantAction =
  | 'ACCEPT' | 'REJECT' | 'START_PREPARING' | 'MARK_READY'
  | 'OUT_FOR_DELIVERY' | 'COMPLETE' | 'CANCEL' | 'MARK_PAID';

/** हर action के अगले status + कब स्वीकार होने के नियम. */
export interface ActionRule {
  next: OrderStatus;
  /** कौन-कौन currents से चलेगा. */
  from: OrderStatus[];
  /** विवरण — delivery-only भी कुछ हैं. */
  fulfilment?: Fulfilment;
}

export const MERCHANT_ACTIONS: Record<MerchantAction, ActionRule> = {
  ACCEPT:           { next: 'ACCEPTED',   from: ['NEW'] },
  REJECT:           { next: 'REJECTED',   from: ['NEW'] },
  START_PREPARING:  { next: 'PREPARING',  from: ['ACCEPTED'] },
  MARK_READY:       { next: 'PREPARED',   from: ['ACCEPTED', 'PREPARING'] },
  // "रास्ते में" सिर्फ़ डिलीवरी ऑर्डर पर; पिकअप सीधे तैयार → पूरा हुआ
  OUT_FOR_DELIVERY: { next: 'TRANSIT',    from: ['PREPARED'], fulfilment: 'DELIVERY' },
  // पिकअप: तैयार → पूरा हुआ; डिलीवरी: रास्ते में → पूरा हुआ
  COMPLETE:         { next: 'DELIVERED',  from: ['TRANSIT', 'PREPARED'] },
  CANCEL:           { next: 'CANCELLED',  from: CANCELLABLE },
  MARK_PAID:        { next: 'NEW', from: [] },  // next इस action में status नहीं बदलता (payment चरण); transition() MARK_PAID को from से पहले ही निपटाता है
};

export type TransitionResult =
  | { ok: true; next: OrderStatus }
  | { ok: false; code: string; message: string };

/**
 * Server-side transition validation. `current` orders.status, `action`
 * client चुना action, fulfilment/payMode DB से (client नहीं).
 */
export function transition(
  current: string,
  action: string,
  fulfilment: Fulfilment,
  payMode: PayMode,
): TransitionResult {
  const rule = (MERCHANT_ACTIONS as Record<string, ActionRule>)[String(action)];
  if (!rule) {
    return { ok: false, code: 'UNKNOWN_ACTION', message: 'नहीं पहचाना गया काम — अप-डेट करके दोबारा कोशिश करें' };
  }
  if (!ORDER_STATUSES.includes(current as OrderStatus)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: 'ऑर्डर की स्थिति अज्ञात है' };
  }
  // असंगत हाल-जाँच: TRANSIT सिर्फ़ DELIVERY ऑर्डर का चरण है — पिकअप ऑर्डर कभी
  // रास्ते में नहीं जाता (OUT_FOR_DELIVERY भी delivery-only है)। ऐसी row मिले
  // तो यह corrupt data है — कोई सत्यापित transition मान्य नहीं.
  if (current === 'TRANSIT' && fulfilment !== 'DELIVERY') {
    return { ok: false, code: 'FULFILMENT', message: 'पिकअप ऑर्डर कभी रास्ते में नहीं जा सकता — सूची ताज़ा करें' };
  }
  if (action === 'MARK_PAID') {
    if (payMode !== 'UPI_QR') {
      return { ok: false, code: 'PAY_MODE', message: 'पेमेंट की पुष्टि सिर्फ़ मैन्युअल UPI ऑर्डर पर होती है' };
    }
    if (current === 'NEW') {
      return { ok: false, code: 'BAD_STATUS', message: 'पहले ऑर्डर स्वीकार करें' };
    }
    if (['DELIVERED', 'REJECTED', 'CANCELLED'].includes(current)) {
      return { ok: false, code: 'BAD_STATUS', message: 'पूरा/रद्द ऑर्डर पेमेंट नहीं बदल सकता' };
    }
    return { ok: true, next: current as OrderStatus }; // status वही — payment_status अलग column change
  }
  if (rule.from.indexOf(current as OrderStatus) === -1) {
    return {
      ok: false,
      code: 'BAD_TRANSITION',
      message: hindiTransitionError(current as OrderStatus, action as MerchantAction),
    };
  }
  if (rule.fulfilment && rule.fulfilment !== fulfilment) {
    return {
      ok: false,
      code: 'FULFILMENT',
      message: rule.fulfilment === 'DELIVERY'
        ? 'यह ऑर्डर पिकअप का है — रास्ते में केवल डिलीवरी ऑर्डर पर'
        : 'यह ऑर्डर डिलीवरी का है — पिकअप का कदम यहाँ नहीं',
    };
  }
  return { ok: true, next: rule.next };
}

function hindiTransitionError(current: OrderStatus, action: MerchantAction): string {
  const done: Record<string, string> = {
    DELIVERED: 'ऑर्डर पहले ही पूरा हो चुका है',
    CANCELLED: 'ऑर्डर पहले ही रद्द हो चुका है',
    REJECTED: 'ऑर्डर पहले ही स्वीकार नहीं हुआ था',
  };
  if (done[current]) return done[current];
  if (action === 'ACCEPT') return 'सिर्फ़ नया ऑर्डर ही स्वीकार होता है — पहले ताज़ा सूची लाएं (रीफ़्रेश)';
  if (action === 'COMPLETE') return 'पूरा होने तक ऑर्डर तैयार/रास्ते में होना ज़रूरी है';
  if (action === 'CANCEL') return 'इस स्थिति में ऑर्डर रद्द नहीं हो सकता';
  return 'इस स्थिति से यह कदम मान्य नहीं है — सूची ताज़ा करें';
}

/**
 * क्या इस transition में स्टॉक वापस जुड़ना चाहिए?
 * Part-4 checkout स्टॉक बनते ही काट देता है (SALE movement, उसी tx) — तो
 * REJECTED/CANCELLED हो तो RETURN movement से ही वापसी. Row-lock + ऊपर की
 * transition जाँच के कारण दोबारा cancel/reject यहाँ पहुँचता ही नहीं
 * (दूसरी call 409 खाती है) — इसलिए स्टॉक ठीक एक बार ही जुड़ता है.
 */
export function needsRestock(current: OrderStatus, next: OrderStatus): boolean {
  if (next !== 'REJECTED' && next !== 'CANCELLED') return false;
  return CANCELLABLE.includes(current);
}

/** ग्राहक cancellation नियम: सिर्फ़ "बाकी पुष्टि" (NEW) ऑर्डर छू सकता है —
 *  मर्चेंट एक बार ACCEPTED कर चुका तो दुकान से ही बात. */
export function customerCanCancel(status: string): boolean {
  return status === 'NEW';
}

/** Order किस चरण का "चालू" (dashboard "प्रोसेसिंग") count है. */
export function isActiveStatus(status: string): boolean {
  return ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'TRANSIT'].includes(status);
}

/** टाइमलाइन के करमानुसार तय गृहस्थी — ग्राहक पेज से भी इस्तेमाल होता है. */
export function timelineOrder(status: string, fulfilment: Fulfilment): string[] {
  if (status === 'REJECTED') return ['NEW', 'REJECTED'];
  if (status === 'CANCELLED') return ['NEW', 'CANCELLED'];
  if (fulfilment === 'PICKUP') return ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'DELIVERED'];
  return ['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'TRANSIT', 'DELIVERED'];
}
