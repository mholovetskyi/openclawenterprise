/**
 * Distributed rate limiting — Redis sliding window.
 *
 * Uses a Redis sorted set per key (IP/tenant/user) where each member is a
 * request timestamp. Requests older than the window are pruned on each check.
 * This gives accurate sliding-window semantics without fixed buckets.
 *
 * Falls back to in-memory when Redis is not available (single-node only).
 *
 * Usage:
 *   const limiter = await createRateLimiter(cfg);
 *   const { allowed, remaining, resetAt } = await limiter.check("ip:1.2.3.4", 100, 60_000);
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // unix ms when the oldest entry in the window expires
  windowMs: number;
};

export type RateLimiter = {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  close(): Promise<void>;
};

// ── In-memory implementation ──────────────────────────────────────────────────

class InMemoryRateLimiter implements RateLimiter {
  // key → sorted list of request timestamps (ms)
  private windows = new Map<string, number[]>();

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = this.windows.get(key) ?? [];
    // Prune old entries
    timestamps = timestamps.filter((t) => t > cutoff);
    const current = timestamps.length;

    if (current >= limit) {
      const oldest = timestamps[0] ?? now;
      return { allowed: false, remaining: 0, limit, resetAt: oldest + windowMs, windowMs };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return {
      allowed: true,
      remaining: limit - timestamps.length,
      limit,
      resetAt: now + windowMs,
      windowMs,
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  async close(): Promise<void> {
    this.windows.clear();
  }
}

// ── Redis sliding-window implementation ───────────────────────────────────────

type RedisClient = {
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  zremrangebyscore(key: string, min: number | "-inf", max: number | "+inf"): Promise<number>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number, ...args: string[]): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  quit(): Promise<void>;
};

/** Exported alias of the internal Redis client shape for tests/wiring. */
export type RateLimitRedisClient = RedisClient;

async function loadRedis(url: string): Promise<RedisClient> {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  type RedisCtor = new (url: string) => RedisClient;
  // SAFETY: ioredis's CJS entry exports the client constructor directly or under `.default` (ESM interop); `mod.default ?? mod` picks whichever, and createRateLimiter wraps this in try/catch, falling back to the in-memory limiter if the package is absent.
  const mod = req("ioredis") as RedisCtor & { default?: RedisCtor };
  const Redis = mod.default ?? mod;
  return new Redis(url);
}

export class RedisRateLimiter implements RateLimiter {
  constructor(private redis: RedisClient) {}

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const member = `${now}:${Math.random().toString(36).slice(2, 9)}`;

    // Sorted set: score = timestamp ms, member = unique request ID
    await this.redis.zadd(key, now, member);
    await this.redis.zremrangebyscore(key, "-inf", cutoff);
    const count = await this.redis.zcard(key);
    // Set TTL so unused keys are cleaned up automatically
    await this.redis.expire(key, Math.ceil(windowMs / 1000) + 1);

    if (count > limit) {
      // Remove only THIS request's own member. Using zremrangebyscore(now, now)
      // would delete every member co-timestamped in the same millisecond,
      // letting a concurrent same-ms request read a count back under the limit
      // and slip through — a burst bypass.
      await this.redis.zrem(key, member);
      const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const oldestTs = oldest.length >= 2 ? parseInt(oldest[1]!, 10) : now;
      return { allowed: false, remaining: 0, limit, resetAt: oldestTs + windowMs, windowMs };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      limit,
      resetAt: now + windowMs,
      windowMs,
    };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export async function createRateLimiter(redisUrl?: string): Promise<RateLimiter> {
  if (!redisUrl) return new InMemoryRateLimiter();

  try {
    const redis = await loadRedis(redisUrl);
    return new RedisRateLimiter(redis);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ioredis") || msg.includes("Cannot find module")) {
      process.stderr.write(
        "[enterprise/rate-limit] WARNING: ioredis not installed. " +
          "Using in-memory rate limiter — limits are per-node only in multi-node deployments. " +
          "Install with: npm install ioredis\n",
      );
      return new InMemoryRateLimiter();
    }
    throw err;
  }
}
