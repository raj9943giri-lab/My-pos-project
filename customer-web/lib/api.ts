/**
 * PART 4 — public store API client.
 *
 * हर fetch backend के public endpoints पर. Client-साइड पर NEXT_PUBLIC_API_BASE,
 * server-साइड (RSC) पर API_BASE (या fallback NEXT_PUBLIC_API_BASE).
 */

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** अवैध slug/404/429 सब का एक ही error घर — RSC इसे notFound() पर बदलता है. */
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function apiBase(): string {
  const isServer = typeof window === 'undefined';
  const b = isServer ? (process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE) : process.env.NEXT_PUBLIC_API_BASE;
  return trimSlash(b || 'http://localhost:4000');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'नेटवर्क नहीं मिला — इंटरनेट जाँचें और फिर कोशिश करें');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as any).message || 'कुछ गड़बड़ हुई — फिर कोशिश करें';
    throw new ApiError(res.status, String(msg), body as Record<string, unknown>);
  }
  return body as T;
}

export const api = {
  shop: (slug: string) => request<import('./types').ShopResponse>(
    '/public/shops/' + encodeURIComponent(slug)),
  categories: (slug: string) => request<{ shop: string; items: import('./types').CategoryChip[] }>(
    '/public/shops/' + encodeURIComponent(slug) + '/categories'),
  products: (slug: string, q: Record<string, string | number | undefined>) => {
    const usp = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && usp.set(k, String(v)));
    return request<import('./types').ProductListResponse>(
      '/public/shops/' + encodeURIComponent(slug) + '/products?' + usp.toString());
  },
  product: (slug: string, pid: string) => request<{ shop: string; product: import('./types').PublicProduct }>(
    '/public/shops/' + encodeURIComponent(slug) + '/products/' + encodeURIComponent(pid)),
  validate: (slug: string, payload: Record<string, unknown>) =>
    request<import('./types').ValidateResponse>(
      '/public/shops/' + encodeURIComponent(slug) + '/checkout/validate',
      { method: 'POST', body: JSON.stringify(payload) }),
  checkout: (slug: string, payload: Record<string, unknown>, idempotencyKey: string) =>
    request<import('./types').CheckoutResponse>(
      '/public/shops/' + encodeURIComponent(slug) + '/checkout',
      { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': idempotencyKey } }),
  order: (token: string) => request<import('./types').OrderViewResponse>(
    '/public/orders/' + encodeURIComponent(token)),
  /** PART 5 — ग्राहक cancel: सिर्फ़ NEW ऑर्डर पर server मान्यता देता है. */
  orderCancel: (token: string, reason?: string) =>
    request<{ ok: boolean; status: string; number: string }>(
      '/public/orders/' + encodeURIComponent(token) + '/cancel',
      { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) }),
};
