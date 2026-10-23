/**
 * PART 3 — pure pricing / stock helpers.
 *
 * Deliberately DB-free so they can be unit tested directly
 * (`backend/test/unit/pricing.spec.ts`).
 */

export interface BulkPriceRow {
  id: number;
  name: string;
  price: number;
}

export interface BulkPriceChange {
  id: number;
  name: string;
  oldPrice: number;
  newPrice: number;
}

/** Round to 2 decimals without float noise (0.1 + 0.2 style). */
export function round2(n: number): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Percentage change of a price.
 *   percent > 0  → मूल्य बढ़ेगा
 *   percent < 0  → डिस्काउंट
 * `minPrice` guards the product against a 0 / negative selling price.
 */
export function applyPercent(price: number, percent: number, minPrice = 1): number {
  const base = Number(price);
  const pct = Number(percent);
  const floor = Math.max(0, Number(minPrice) || 0);
  if (!isFinite(base) || !isFinite(pct)) return floor;
  let next = round2(base * (1 + pct / 100));
  if (next < floor) next = floor;
  return next;
}

/** Plan a bulk price change for a set of products (pure — performs no writes). */
export function planBulkPrice(
  rows: BulkPriceRow[],
  percent: number,
  minPrice = 1,
): BulkPriceChange[] {
  return (rows || []).map((r) => {
    const oldPrice = round2(Number(r.price) || 0);
    return {
      id: r.id,
      name: r.name,
      oldPrice,
      newPrice: applyPercent(oldPrice, percent, minPrice),
    };
  });
}

/**
 * Next stock value after a delta or an absolute set. Stock never goes negative.
 * `absolute` wins over `delta` when both are given.
 */
export function nextStock(current: number, delta?: number, absolute?: number): number {
  let v: number;
  if (absolute !== undefined && absolute !== null) {
    v = Number(absolute);
  } else {
    v = (Number(current) || 0) + (Number(delta) || 0);
  }
  if (!isFinite(v)) v = 0;
  return Math.max(0, Math.round(v));
}
