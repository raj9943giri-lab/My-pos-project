/** Shared slug helpers — mirror of app/src/main/assets/pos-api.js (dev parity). */

export const SLUG_RE = /^[a-z0-9\u0900-\u097F][a-z0-9\u0900-\u097F-]{1,39}$/;

/** Normalize a shop name to a slug: latin + Devanagari, no spaces. */
export function slugify(input: string): string {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 40 ? s.slice(0, 40).replace(/-+[^-]*$/, '') : s || 'dukan';
}

/** Taken par naye options: sharma-kirana → [sharma-kirana-2 … -5]. */
export function slugCandidates(base: string): string[] {
  const b = slugify(base);
  return [2, 3, 4, 5].map((n) => b + '-' + n);
}
