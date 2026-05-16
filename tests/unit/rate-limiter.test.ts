import { describe, it, expect } from 'vitest';
import { MemoryRateLimiter } from '~/infrastructure/rate-limiter';

describe('MemoryRateLimiter', () => {
  it('allows requests within limit', async () => {
    const limiter = new MemoryRateLimiter({ windowMs: 60000, maxRequests: 3 });
    const r1 = await limiter.check('key1');
    expect(r1.allowed).toBe(true);
    const r2 = await limiter.check('key1');
    expect(r2.allowed).toBe(true);
    const r3 = await limiter.check('key1');
    expect(r3.allowed).toBe(true);
    const r4 = await limiter.check('key1');
    expect(r4.allowed).toBe(false);
  });

  it('resets after window', async () => {
    const limiter = new MemoryRateLimiter({ windowMs: 50, maxRequests: 1 });
    await limiter.check('key2');
    const blocked = await limiter.check('key2');
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    const allowed = await limiter.check('key2');
    expect(allowed.allowed).toBe(true);
  });
});
