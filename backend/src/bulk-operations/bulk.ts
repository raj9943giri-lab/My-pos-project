/**
 * PART 3 — bulk operations helpers (pure, DB-free → unit-testable).
 */

/** Hard cap so one request can never lock half the catalogue. */
export const MAX_BULK_ITEMS = 200;

export type BulkStatus = 'updated' | 'unchanged' | 'missing';

export interface BulkStockInputItem {
  id: number;
  delta?: number;
  stock?: number;
}

export interface BulkStockResultRow {
  id: number;
  status: BulkStatus;
  delta: number;
  before: number;
  after: number;
}

/**
 * Coerce raw id values (HTML forms may send strings) into a clean list of
 * positive ints — deduped, capped at `max`.
 */
export function coerceIds(raw: unknown, max = MAX_BULK_ITEMS): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<number>();
  for (const v of list) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && !seen.has(n)) seen.add(n);
    if (seen.size >= max) break;
  }
  return Array.from(seen);
}

/**
 * Classify one item against its locked product row (DB-free).
 *   - no matching row        → missing
 *   - next stock == current  → unchanged (nothing written)
 *   - otherwise              → updated, with the delta actually applied
 */
export function classifyStockItem(
  before: number | null | undefined,
  item: BulkStockInputItem,
): BulkStockResultRow {
  const id = Number(item.id);
  if (before === null || before === undefined) {
    return { id, status: 'missing', delta: 0, before: 0, after: 0 };
  }
  const cur = Math.max(0, Math.round(Number(before) || 0));
  let next: number;
  if (item.stock !== undefined && item.stock !== null) {
    next = Math.max(0, Math.round(Number(item.stock) || 0));
  } else {
    next = Math.max(0, cur + (Math.round(Number(item.delta) || 0)));
  }
  const delta = next - cur;
  return {
    id,
    status: delta === 0 ? 'unchanged' : 'updated',
    delta,
    before: cur,
    after: next,
  };
}
