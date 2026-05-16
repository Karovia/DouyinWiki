export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private buckets = new Map<string, BucketEntry>();

  constructor(private defaultRule: RateLimitRule = { windowMs: 60000, maxRequests: 100 }) {}

  async check(key: string, rule?: RateLimitRule): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const r = rule || this.defaultRule;
    const now = Date.now();

    const entry = this.buckets.get(key);
    if (!entry || now > entry.resetAt) {
      const resetAt = now + r.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: r.maxRequests - 1, resetAt };
    }

    if (entry.count >= r.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { allowed: true, remaining: r.maxRequests - entry.count, resetAt: entry.resetAt };
  }
}

export const WORKSPACE_RATE_LIMIT: RateLimitRule = {
  windowMs: 60 * 1000,
  maxRequests: 60,
};
