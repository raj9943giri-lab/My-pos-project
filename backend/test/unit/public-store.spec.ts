import {
  applyCoupon, cleanIdempotencyKey, clampQtyToStock, coerceItem, computeTotals, CouponRow,
  deliveryFeeFor, lineStatus, MAX_ITEMS, normalizeGuestPhone, normalizeQty, orderNumber,
  sanitizeItems,
} from '../../src/public-store/checkout';
import { round2 } from '../../src/products/pricing';

/* PART 4 — pure checkout helpers (DB-free). सर्वर ही पैसा गिनता है, इसलिए इन
 * helpers का सच ही acceptance का आधार है (browser totals झुठलाए जाते हैं). */

/* Part-3 spec परिवार की परिपाटी: union नतीजों को पहले narrow करो
 * (ok:false पर ही reason मिलता है, ok:true पर नहीं — TS यह नहीं खुद जानता). */
const reject = (c: CouponRow, sub: number) =>
  applyCoupon(c, sub) as { ok: false; amount: 0; reason: string };
const invalidPhone = (raw: string) =>
  normalizeGuestPhone(raw) as { ok: false; reason: string };

describe('normalizeQty', () => {
  it('keeps whole quantities inside 0..99', () => {
    expect(normalizeQty(3)).toBe(3);
    expect(normalizeQty('7')).toBe(7);
    expect(normalizeQty(0)).toBe(0);
    expect(normalizeQty(150)).toBe(99);
    expect(normalizeQty(-4)).toBe(0);
    expect(normalizeQty(2.6)).toBe(3);
  });
  it('junk becomes 0 (droppable)', () => {
    expect(normalizeQty('abc')).toBe(0);
    expect(normalizeQty(undefined)).toBe(0);
    expect(normalizeQty(null)).toBe(0);
  });
});

describe('coerceItem / sanitizeItems', () => {
  it('keeps a good item, drops junk rows', () => {
    expect(coerceItem({ productId: 5, variantId: 2, qty: 2 })).toEqual({ productId: 5, variantId: 2, qty: 2 });
    expect(coerceItem({ productId: 0, qty: 2 })).toBe(null);
    expect(coerceItem({ productId: '12', qty: 0 })).toBe(null);
    expect(coerceItem({ productId: 'abc', qty: 1 })).toBe(null);
  });
  it('merges duplicate product+variant rows', () => {
    const items = sanitizeItems([
      { productId: 3, variantId: null, qty: 1 },
      { productId: '3', qty: 2 },
      { productId: 9, qty: 1 },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ productId: 3, variantId: null, qty: 3 });
  });
  it('caps the cart length', () => {
    const many = Array.from({ length: MAX_ITEMS + 10 }, (_, i) => ({ productId: i + 1, qty: 1 }));
    expect(sanitizeItems(many)).toHaveLength(MAX_ITEMS);
  });
  it('per-row qty still capped at 99 after merging', () => {
    const items = sanitizeItems([
      { productId: 3, qty: 60 },
      { productId: 3, qty: 60 },
    ]);
    expect(items[0].qty).toBe(99);
  });
});

describe('clampQtyToStock', () => {
  it('clamps to available stock', () => {
    expect(clampQtyToStock(10, 4)).toBe(4);
    expect(clampQtyToStock(2, 9)).toBe(2);
  });
  it('zero stock means zero qty (never negative request)', () => {
    expect(clampQtyToStock(1, 0)).toBe(0);
    expect(clampQtyToStock(3, -2)).toBe(0);
  });
});

const activeCoupon = (over: Partial<CouponRow> = {}): CouponRow => ({
  code: 'SWAGAT10',
  kind: 'PERCENT',
  value: 10,
  min_subtotal: 100,
  max_discount: 50,
  times_used: 0,
  max_uses: null,
  is_active: true,
  expires_at: null,
  ...over,
});

describe('applyCoupon (server-computed only)', () => {
  it('percent coupon with a max ceiling', () => {
    expect(applyCoupon(activeCoupon(), 400)).toEqual({ ok: true, code: 'SWAGAT10', amount: 40 });
    expect(applyCoupon(activeCoupon({ max_discount: 25 }), 400).amount).toBe(25);
  });
  it('flat coupon never exceeds the subtotal', () => {
    const flat = activeCoupon({ kind: 'FLAT', value: 80, min_subtotal: 0 });
    expect(applyCoupon(flat, 120).amount).toBe(80);
    expect(applyCoupon(flat, 50).amount).toBe(50);
  });
  it('min subtotal, expiry, usage limit and inactive rules reject', () => {
    expect(applyCoupon(activeCoupon({ min_subtotal: 500 }), 400).ok).toBe(false);
    expect(reject(activeCoupon({ expires_at: '2020-01-01' }), 400).reason).toBe('COUPON_EXPIRED');
    expect(reject(activeCoupon({ max_uses: 5, times_used: 5 }), 400).reason).toBe('COUPON_USED_UP');
    expect(reject(activeCoupon({ is_active: false }), 400).reason).toBe('COUPON_INACTIVE');
  });
  it('no coupon means no discount, never an error', () => {
    expect(applyCoupon(null, 999)).toEqual({ ok: true, code: '', amount: 0 });
  });
  it('a future expiry date still applies', () => {
    const future = activeCoupon({ expires_at: new Date(Date.now() + 86400000) });
    expect(applyCoupon(future, 200).ok).toBe(true);
  });
});

describe('deliveryFeeFor (real configured fee only)', () => {
  const cfg = { deliveryOn: true, fee: 25, freeAbove: 499 };
  it('charges the configured fee under the free threshold', () => {
    expect(deliveryFeeFor(cfg, 'DELIVERY', 450)).toBe(25);
  });
  it('free above the threshold; pickup is always ₹0', () => {
    expect(deliveryFeeFor(cfg, 'DELIVERY', 499)).toBe(0);
    expect(deliveryFeeFor(cfg, 'DELIVERY', 999)).toBe(0);
    expect(deliveryFeeFor(cfg, 'PICKUP', 100)).toBe(0);
  });
  it('delivery turned off means no fee (and no delivery)', () => {
    expect(deliveryFeeFor({ ...cfg, deliveryOn: false }, 'DELIVERY', 100)).toBe(0);
  });
  it('zero-configured fee means free delivery', () => {
    expect(deliveryFeeFor({ ...cfg, fee: 0 }, 'DELIVERY', 100)).toBe(0);
  });
});

describe('computeTotals (2-decimal safe math)', () => {
  it('subtotal − discount + fee, rounded', () => {
    const lines = [
      { qty: 3, unitPrice: 45.5, lineTotal: 136.5 },
      { qty: 1, unitPrice: 20, lineTotal: 20 },
    ];
    expect(round2(lines.reduce((s, l) => s + l.lineTotal, 0))).toBe(156.5);
    const t = computeTotals(lines as any, 6.5, 20);
    expect(t).toEqual({ subTotal: 156.5, discount: 6.5, deliveryFee: 20, total: 170 });
  });
  it('discount can never exceed subtotal or go negative', () => {
    const t = computeTotals([{ qty: 1, unitPrice: 10, lineTotal: 10 }] as any, 500, 0);
    expect(t.discount).toBe(10);
    expect(t.total).toBe(0);
  });
  it('float noise is rounded away (0.1+0.2 style carts)', () => {
    const t = computeTotals([
      { qty: 1, unitPrice: 0.1, lineTotal: 0.1 },
      { qty: 1, unitPrice: 0.2, lineTotal: 0.2 },
    ] as any, 0, 0);
    expect(t.total).toBe(0.3);
  });
});

describe('normalizeGuestPhone (guest checkout policy)', () => {
  it('accepts Indian 10-digit mobiles and +91/0 variants → 91…', () => {
    expect((normalizeGuestPhone('9876543210') as any).phone).toBe('919876543210');
    expect((normalizeGuestPhone('+91 98765 43210') as any).phone).toBe('919876543210');
    expect((normalizeGuestPhone('09876543210') as any).phone).toBe('919876543210');
    expect((normalizeGuestPhone('919876543210') as any).phone).toBe('919876543210');
  });
  it('rejects empty, short and non-mobile numbers', () => {
    expect(normalizeGuestPhone('')).toEqual({ ok: false, reason: 'PHONE_REQUIRED' });
    expect(invalidPhone('12345').reason).toBe('PHONE_INVALID');
    expect(invalidPhone('1234567890').reason).toBe('PHONE_INVALID'); // शुरुआत 6-9 से ही
    expect(invalidPhone('987654321').reason).toBe('PHONE_INVALID');  // 9 अंक — छोटा
    // '9876543210x' जैसी अशुद्ध झंझट common/phone.ts की परिपाटी जैसी ही है:
    // ग़ैर-अंक हटते हैं (9876543210x → 919876543210, ok).
    expect((normalizeGuestPhone('9876543210x') as any).phone).toBe('919876543210');
    expect((normalizeGuestPhone('+91 98765 43210 ') as any).phone).toBe('919876543210');
  });
});

describe('cleanIdempotencyKey (duplicate-submission guard)', () => {
  it('keeps printable keys, strips junk', () => {
    expect(cleanIdempotencyKey('ORD-2024_01.1')).toBe('ORD-2024_01.1');
    expect(cleanIdempotencyKey('  k ey\n')).toBe('key');
    expect(cleanIdempotencyKey('evt=${drop}')).toBe('evtdrop');
  });
  it('null/empty/too-long is not a key', () => {
    expect(cleanIdempotencyKey(undefined)).toBe(null);
    expect(cleanIdempotencyKey('   ')).toBe(null);
    expect(cleanIdempotencyKey('k'.repeat(81))).toBe(null);
  });
});

describe('lineStatus (stock/existence states)', () => {
  it('OK when enough stock', () => {
    expect(lineStatus(2, 5, true, true, 10)).toEqual({ status: 'OK', qty: 2 });
  });
  it('LOW means clamped to remaining stock', () => {
    expect(lineStatus(5, 3, true, true, 10)).toEqual({ status: 'LOW', qty: 3 });
  });
  it('OUT for zero stock, MISSING for unknown/inactive products', () => {
    expect(lineStatus(1, 0, true, true, 10)).toEqual({ status: 'OUT', qty: 0 });
    expect(lineStatus(1, 5, false, true, 10).status).toBe('MISSING');
    expect(lineStatus(1, 5, true, false, 10).status).toBe('MISSING');
  });
});

describe('orderNumber (display only)', () => {
  it('pads to S-######; access still needs the token', () => {
    expect(orderNumber(1)).toBe('S-000001');
    expect(orderNumber(123456)).toBe('S-123456');
    expect(orderNumber('17')).toBe('S-000017');
  });
});
