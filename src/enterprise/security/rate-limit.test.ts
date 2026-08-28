import { describe, it, expect, afterEach } from "vitest";
import {
  createRateLimiter,
  RedisRateLimiter,
  type RateLimiter,
  type RateLimitRedisClient,
} from "./rate-limit.js";

describe("createRateLimiter (in-memory fallback)", () => {
  let limiter: RateLimiter | null = null;
  afterEach(async () => {
    if (limiter) await limiter.close();
    limiter = null;
  });

  it("allows up to the limit then rejects within the window", async () => {
    limiter = await createRateLimiter();
    const a = await limiter.check("ip:1.2.3.4", 2, 60_000);
    const b = await limiter.check("ip:1.2.3.4", 2, 60_000);
    const c = await limiter.check("ip:1.2.3.4", 2, 60_000);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
  });

  it("reset clears the window", async () => {
    limiter = await createRateLimiter();
    await limiter.check("k", 1, 60_000);
    expect((await limiter.check("k", 1, 60_000)).allowed).toBe(false);
    await limiter.reset("k");
    expect((await limiter.check("k", 1, 60_000)).allowed).toBe(true);
  });
});

/**
 * A minimal sorted-set Redis fake that records which prune command the limiter
 * uses on the over-limit reject path.
 */
function makeFakeRedis() {
  const zset = new Map<string, number>();
  const zremCalls: string[] = [];
  const zremrangebyscoreCalls: Array<[number | string, number | string]> = [];
  const client = {
    async zadd(_key: string, score: number, member: string): Promise<number> {
      zset.set(member, score);
      return 1;
    },
    async zrem(_key: string, member: string): Promise<number> {
      zremCalls.push(member);
      return zset.delete(member) ? 1 : 0;
    },
    async zremrangebyscore(
      _key: string,
      min: number | "-inf",
      max: number | "+inf",
    ): Promise<number> {
      zremrangebyscoreCalls.push([min, max]);
      const lo = min === "-inf" ? -Infinity : (min as number);
      const hi = max === "+inf" ? Infinity : (max as number);
      let removed = 0;
      for (const [m, s] of [...zset.entries()]) {
        if (s >= lo && s <= hi) {
          zset.delete(m);
          removed++;
        }
      }
      return removed;
    },
    async zcard(): Promise<number> {
      return zset.size;
    },
    async zrange(): Promise<string[]> {
      return [];
    },
    async expire(): Promise<number> {
      return 1;
    },
    async del(_key: string): Promise<number> {
      const n = zset.size;
      zset.clear();
      return n;
    },
    async quit(): Promise<void> {},
  } as unknown as RateLimitRedisClient;
  return { client, zset, zremCalls, zremrangebyscoreCalls };
}

describe("RedisRateLimiter over-limit member removal (same-ms bypass)", () => {
  it("on reject removes ONLY its own member, leaving co-timestamped siblings", async () => {
    const fake = makeFakeRedis();
    // Pre-seed the window at the limit so the next request goes over.
    const now = Date.now();
    fake.zset.set(`${now}:sibling-1`, now);
    fake.zset.set(`${now}:sibling-2`, now);

    const limiter = new RedisRateLimiter(fake.client);
    const result = await limiter.check("burst-key", 2, 60_000);

    expect(result.allowed).toBe(false);
    // Only one zrem for the request's own member; no blast-radius prune of the ms.
    expect(fake.zremCalls).toHaveLength(1);
    expect(fake.zremrangebyscoreCalls.some(([min, max]) => min === now && max === now)).toBe(false);
    // Both sibling members survive.
    expect(fake.zset.has(`${now}:sibling-1`)).toBe(true);
    expect(fake.zset.has(`${now}:sibling-2`)).toBe(true);
  });

  it("allows a request that is within the limit", async () => {
    const fake = makeFakeRedis();
    const limiter = new RedisRateLimiter(fake.client);
    const result = await limiter.check("ok-key", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(fake.zremCalls).toHaveLength(0);
  });
});
