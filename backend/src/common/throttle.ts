/**
 * Tiny fixed-window in-memory rate limiter.
 * Dev/Part-2 use; production me Redis-backed limiter se replace karein
 * (dekhe README → “Production notes”). Sensitive auth data yahan save nahi hoti —
 * sirf key + window count.
 */
interface Bucket { count: number; resetAt: number }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private max: number, private windowMs: number) {}

  /** true if allowed; else { retryAfterSec } */
  hit(key: string): { ok: boolean; retryAfterSec?: number } {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now > b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true };
    }
    if (b.count >= this.max) {
      return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
    }
    b.count += 1;
    return { ok: true };
  }
}
