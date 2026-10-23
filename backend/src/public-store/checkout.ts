/**
 * PART 4 — pure checkout helpers (DB-free → unit tested in test/unit/public-store.spec.ts).
 *
 * पैसा हमेशा round2() से ही गिना जाता है — order creation का पूरा हिसाब
 * server करता है; browser से भेजी गई कुल रकम (total) किसी काम नहीं आती।
 */
import { round2 } from '../products/pricing';

export type Fulfilment = 'DELIVERY' | 'PICKUP';
export type PaymentMode = 'COD' | 'PON' | 'UPI_QR';

export const FULFILMENTS: Fulfilment[] = ['DELIVERY', 'PICKUP'];

/** Build a cart line the way only the server is allowed to (price/stock from DB). */
export interface ServerLine {
  productId: number;
  variantId?: number | null;
  name: string;
  variantName?: string | null;
  unit: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  stock: number;
  /** स्टॉक किस row से आया — variant का अपना stock, या product का (variant.stock NULL). */
  stockSource?: 'PRODUCT' | 'VARIANT';
  status: 'OK' | 'OUT' | 'LOW' | 'MISSING';
}

export interface RawCartItem {
  productId: unknown;
  variantId?: unknown;
  qty: unknown;
}

/** Whole qty in 1..MAX; invalid → 0 (dropped later). */
export const MAX_QTY = 99;
export const MAX_ITEMS = 50;

export function normalizeQty(qty: unknown): number {
  const n = Math.round(Number(qty));
  if (!isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), MAX_QTY);
}

/** Coerce a user item to { productId, variantId?, qty }; junk dropped (qty 0 / nan id). */
export function coerceItem(raw: RawCartItem): { productId: number; variantId: number | null; qty: number } | null {
  const productId = Math.round(Number(raw?.productId));
  if (!isFinite(productId) || productId <= 0) return null;
  const qty = normalizeQty(raw?.qty);
  if (qty <= 0) return null;
  let variantId: number | null = null;
  if (raw?.variantId !== undefined && raw?.variantId !== null && raw?.variantId !== '') {
    const v = Math.round(Number(raw.variantId));
    if (isFinite(v) && v > 0) variantId = v;
  }
  return { productId, variantId, qty };
}

/** Merge duplicate rows (same product+variant) and drop junk; caps list length. */
export function sanitizeItems(raw: RawCartItem[]): { productId: number; variantId: number | null; qty: number }[] {
  const merged = new Map<string, { productId: number; variantId: number | null; qty: number }>();
  for (const r of raw || []) {
    const it = coerceItem(r);
    if (!it) continue;
    const key = `${it.productId}:${it.variantId ?? ''}`;
    const prev = merged.get(key);
    merged.set(key, {
      productId: it.productId,
      variantId: it.variantId,
      qty: Math.min(MAX_QTY, (prev ? prev.qty : 0) + it.qty),
    });
  }
  return Array.from(merged.values()).slice(0, MAX_ITEMS);
}

/** Server-side stock clamp — accepted qty can never exceed available stock. */
export function clampQtyToStock(qty: number, stock: number): number {
  return Math.max(0, Math.min(normalizeQty(qty), Math.max(0, Math.round(Number(stock) || 0))));
}

export interface CouponRow {
  code: string;
  kind: 'FLAT' | 'PERCENT' | string;
  value: number;
  min_subtotal: number;
  max_discount: number | null;
  times_used: number;
  max_uses: number | null;
  is_active: boolean;
  expires_at: Date | string | null;
}

export type CouponResult =
  | { ok: true; code: string; amount: number }
  | { ok: false; amount: 0; reason: string };

/** Only real configured coupons discount anything — browser requests are never trusted. */
export function applyCoupon(input: CouponRow | null | undefined, subtotal: number): CouponResult {
  if (!input) {
    return { ok: true, code: '', amount: 0 };
  }
  const code = String(input.code || '').toUpperCase();
  const sub = round2(subtotal);
  if (!input.is_active) return { ok: false, amount: 0, reason: 'COUPON_INACTIVE' };
  if (input.expires_at) {
    const exp = input.expires_at instanceof Date ? input.expires_at : new Date(input.expires_at);
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) return { ok: false, amount: 0, reason: 'COUPON_EXPIRED' };
  }
  if (input.max_uses !== null && input.max_uses !== undefined && (input.times_used || 0) >= input.max_uses) {
    return { ok: false, amount: 0, reason: 'COUPON_USED_UP' };
  }
  if (sub < round2(Number(input.min_subtotal) || 0)) return { ok: false, amount: 0, reason: 'COUPON_MIN_ORDER' };

  let amount = 0;
  if (String(input.kind).toUpperCase() === 'PERCENT') {
    amount = round2((sub * (Number(input.value) || 0)) / 100);
    if (input.max_discount !== null && input.max_discount !== undefined) {
      amount = Math.min(amount, round2(Number(input.max_discount) || 0));
    }
  } else {
    amount = round2(Number(input.value) || 0);
  }
  amount = Math.min(Math.max(amount, 0), sub); // कभी subtotal से ज़्यादा नहीं
  return { ok: true, code, amount };
}

export interface DeliveryConfig {
  deliveryOn: boolean;
  fee: number;
  freeAbove: number;
}

/** Real configured fee only; free above threshold. PICKUP is always ₹0. */
export function deliveryFeeFor(cfg: DeliveryConfig, fulfilment: Fulfilment, subTotal: number): number {
  if (fulfilment !== 'DELIVERY' || !cfg.deliveryOn) return 0;
  const fee = round2(Number(cfg.fee) || 0);
  if (fee <= 0) return 0;
  const freeAbove = round2(Number(cfg.freeAbove) || 0);
  if (freeAbove > 0 && round2(subTotal) >= freeAbove) return 0;
  return fee;
}

export interface Totals {
  subTotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

export function computeTotals(lines: ServerLine[], discount: number, deliveryFee: number): Totals {
  const subTotal = round2(lines.reduce((s, l) => s + (l.qty > 0 ? l.lineTotal : 0), 0));
  const disc = round2(Math.min(Math.max(Number(discount) || 0, 0), subTotal));
  const del = round2(Math.max(Number(deliveryFee) || 0, 0));
  return { subTotal, discount: disc, deliveryFee: del, total: round2(subTotal - disc + del) };
}

/** Guest customer phone policy: Indian mobiles (digits / +91 / 0) → '9198…'. */
export function normalizeGuestPhone(raw: string): { ok: true; phone: string } | { ok: false; reason: string } {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return { ok: false, reason: 'PHONE_REQUIRED' };
  let digits = d;
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) digits = '91' + digits;
  else if (digits.length === 11 && digits.startsWith('0')) digits = '91' + digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits;
  if (!/^(91)?[6-9]\d{9}$/.test(digits)) return { ok: false, reason: 'PHONE_INVALID' };
  return { ok: true, phone: digits };
}

/** Clean an Idempotency-Key header: printable, ≤80 chars, else it is not a key. */
export function cleanIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s || s.length > 80) return null;
  return s.replace(/[^A-Za-z0-9_\-.:]/g, '');
}

/** Human order number (S-000123) — display only; access always needs the token. */
export function orderNumber(id: number | string): string {
  return 'S-' + String(Number(id) || 0).padStart(6, '0');
}

/** Line status of a server-validated cart row. */
export function lineStatus(qtyWanted: number, stock: number, isActive: boolean, found: boolean, unitPrice: number): {
  status: ServerLine['status'];
  qty: number;
} {
  if (!found || !isActive) return { status: 'MISSING', qty: 0 };
  if (stock <= 0) return { status: 'OUT', qty: 0 };
  const qty = clampQtyToStock(qtyWanted, stock);
  if (qty <= 0) return { status: 'OUT', qty: 0 };
  return { status: qty < qtyWanted ? 'LOW' : 'OK', qty };
}
