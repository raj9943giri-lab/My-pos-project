/**
 * PART 3 — inventory helpers (pure, DB-free → unit-testable).
 *
 * Every stock write in the system (products single adjust, bulk stock) funnels
 * a row through here so `inventory_movements.kind` stays a small whitelist.
 */

export const MOVEMENT_KINDS = ['RESTOCK', 'ADJUST', 'SET', 'BULK', 'SALE', 'RETURN'] as const;

export type MovementKind = typeof MOVEMENT_KINDS[number];

export const MAX_MOVEMENT_NOTE = 140;

/** A kind not on the list degrades to ADJUST instead of poisoning the audit. */
export function normalizeKind(value: unknown): MovementKind {
  const v = String(value || '').toUpperCase();
  return (MOVEMENT_KINDS as readonly string[]).includes(v) ? (v as MovementKind) : 'ADJUST';
}

/** Trimmed, length-capped note (null when empty). */
export function sanitizeNote(value: unknown, max = MAX_MOVEMENT_NOTE): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}
