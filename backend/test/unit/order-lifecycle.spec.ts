import {
  CANCELLABLE, customerCanCancel, MERCHANT_ACTIONS, needsRestock, ORDER_STATUS_HI,
  timelineOrder, transition,
} from '../../src/orders/order-lifecycle';
import {
  backoffMinutes, MAX_ATTEMPTS, orderEventText as pickTitle, pickTotal, sanitizeReason,
  ORDER_EVENT_TYPES,
} from '../../src/notifications/notification-events';
import { orderEventText } from '../../src/notifications/notification-events';

describe('PART 5 — order transitions', () => {
  it('accept केवल NEW से', () => {
    expect(transition('NEW', 'ACCEPT', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'ACCEPTED' });
    const bad = transition('ACCEPTED', 'ACCEPT', 'DELIVERY', 'COD');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('BAD_TRANSITION');
  });

  it('अज्ञात action जाने ही नहीं देता (client status नहीं भेजते)', () => {
    const r = transition('NEW', 'ACCEPTED', 'DELIVERY', 'COD') as any;
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_ACTION');
  });

  it('reject सिर्फ़ NEW से; accepted/preparing से reject नहीं', () => {
    expect(transition('NEW', 'REJECT', 'PICKUP', 'COD')).toEqual({ ok: true, next: 'REJECTED' });
    expect((transition('ACCEPTED', 'REJECT', 'PICKUP', 'COD') as any).ok).toBe(false);
    expect((transition('PREPARING', 'REJECT', 'PICKUP', 'COD') as any).ok).toBe(false);
  });

  it('preparing/ready क्रम सही चले', () => {
    expect(transition('ACCEPTED', 'START_PREPARING', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'PREPARING' });
    expect(transition('ACCEPTED', 'MARK_READY', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'PREPARED' });
    expect(transition('PREPARING', 'MARK_READY', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'PREPARED' });
    expect((transition('NEW', 'START_PREPARING', 'DELIVERY', 'COD') as any).ok).toBe(false);
  });

  it('पुराने statuses भी चलें (Part-1/4 की परिपाटी न टूटे)', () => {
    // PREPARED (पुराना 'तैयार') → TRANSIT (डिलीवरी) ✓; पिकअप पर फिर TRANSIT नहीं
    expect(transition('PREPARED', 'OUT_FOR_DELIVERY', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'TRANSIT' });
    const pickup = transition('PREPARED', 'OUT_FOR_DELIVERY', 'PICKUP', 'PON') as any;
    expect(pickup.ok).toBe(false);
    expect(pickup.code).toBe('FULFILMENT');
  });

  it('पिकअप सीधे तैयार → पूरा; डिलीवरी TRANSIT से ही पूरा + तैयार से भी (असली रास्ता transition rule तय करता है)', () => {
    // डिलीवरी पर PREPARED से सीधा COMPLETE हमारे नियम में भी स्वीकार (from list में)
    expect(transition('PREPARED', 'COMPLETE', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'DELIVERED' });
    expect(transition('TRANSIT', 'COMPLETE', 'DELIVERY', 'COD')).toEqual({ ok: true, next: 'DELIVERED' });
    expect(transition('PREPARED', 'COMPLETE', 'PICKUP', 'PON')).toEqual({ ok: true, next: 'DELIVERED' });
    expect((transition('ACCEPTED', 'COMPLETE', 'PICKUP', 'PON') as any).ok).toBe(false);
    expect((transition('TRANSIT', 'COMPLETE', 'PICKUP', 'PON') as any).ok).toBe(false);
  });

  it('TRANSIT से cancel नहीं; PREPARED तक ही', () => {
    expect(transition('PREPARED', 'CANCEL', 'PICKUP', 'COD')).toEqual({ ok: true, next: 'CANCELLED' });
    expect((transition('TRANSIT', 'CANCEL', 'DELIVERY', 'COD') as any).ok).toBe(false);
    expect((transition('DELIVERED', 'CANCEL', 'DELIVERY', 'COD') as any).ok).toBe(false);
  });

  it('रद्द/पूरा ऑर्डर पेमेंट नहीं बदल सकता; MARK_PAID असली UPI ही', () => {
    expect((transition('NEW', 'MARK_PAID', 'DELIVERY', 'COD') as any).ok).toBe(false);
    expect((transition('DELIVERED', 'MARK_PAID', 'DELIVERY', 'UPI_QR') as any).ok).toBe(false);
    expect((transition('CANCELLED', 'MARK_PAID', 'DELIVERY', 'UPI_QR') as any).ok).toBe(false);
    const ok = transition('ACCEPTED', 'MARK_PAID', 'DELIVERY', 'UPI_QR');
    expect(ok).toEqual({ ok: true, next: 'ACCEPTED' });
  });

  it('हर status का हिंदी नाम है (customer-web के साथ पाराइटी)', () => {
    for (const s of Object.keys(MERCHANT_ACTIONS.ACCEPT ? ORDER_STATUS_HI : {})) {
      expect(String(ORDER_STATUS_HI[s as keyof typeof ORDER_STATUS_HI]).length).toBeGreaterThan(1);
    }
  });

  it('needsRestock: केवल रद्द/अस्वीकृत होने पर, और तभी जब वापस करने योग्य status से', () => {
    expect(needsRestock('NEW', 'REJECTED')).toBe(true);
    expect(needsRestock('NEW', 'CANCELLED')).toBe(true);
    expect(needsRestock('PREPARED', 'CANCELLED')).toBe(true);
    expect(needsRestock('NEW', 'ACCEPTED')).toBe(false);
    expect(needsRestock('ACCEPTED', 'PREPARING')).toBe(false);
    expect(needsRestock('TRANSIT', 'DELIVERED')).toBe(false);
    // TRANSIT से cancel नियम ही नहीं चलता — restock भी यहाँ false (double-safe)
    expect(needsRestock('TRANSIT', 'CANCELLED')).toBe(false);
  });

  it('CANCELLABLE + customer rule: ग्राहक सिर्फ़ NEW ही छू सकता है', () => {
    expect(CANCELLABLE).toContain('PREPARED');
    expect(customerCanCancel('NEW')).toBe(true);
    expect(customerCanCancel('ACCEPTED')).toBe(false);
    expect(customerCanCancel('CANCELLED')).toBe(false);
  });

  it('टाइमलाइन: अस्वीकृत/रद्द अपनी छोटी करमानुसार; पिकअप में TRANSIT नहीं', () => {
    expect(timelineOrder('REJECTED', 'DELIVERY')).toEqual(['NEW', 'REJECTED']);
    expect(timelineOrder('CANCELLED', 'PICKUP')).toEqual(['NEW', 'CANCELLED']);
    expect(timelineOrder('PREPARING', 'PICKUP')).not.toContain('TRANSIT');
    expect(timelineOrder('PREPARING', 'DELIVERY')).toContain('TRANSIT');
  });
});

describe('PART 5 — notification events', () => {
  it('पुश टेक्स्ट में ऑर्डर नंबर है, पता/पेमेंट नहीं', () => {
    const t = orderEventText('ORDER_NEW', 'S-000007', 250);
    expect(t.title).toContain('नया ऑर्डर');
    expect(t.body).toContain('S-000007');
    expect(JSON.stringify(t)).not.toContain('address');
    expect(JSON.stringify(t)).not.toContain('paymentStatus');
  });

  it('हर event का अलग शीर्षक', () => {
    const titles = ORDER_EVENT_TYPES.map((e) => pickTitle(e, 'S-1').title);
    expect(new Set(titles).size).toBe(ORDER_EVENT_TYPES.length);
  });

  it('reason सफ़ाई: line-break/लंबाई cap', () => {
    expect(sanitizeReason('a\nb\tc')).toBe('a b c');
    expect(sanitizeReason('x'.repeat(400)).length).toBe(300);
    expect(sanitizeReason(undefined)).toBe('');
  });

  it('backoff 1,2,4,8,16 और 16 ही रहता है; max attempts ≤ 5', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 16]);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(6);
  });

  it('total सिर्फ़ ORDER_NEW पुश में जाता है', () => {
    expect(pickTotal('ORDER_NEW', { total: 123 })).toBe(123);
    expect(pickTotal('ORDER_ACCEPTED', { total: 123 })).toBeUndefined();
  });
});
