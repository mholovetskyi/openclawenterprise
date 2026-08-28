import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RedisCoordinator, type ClusterRedisClient, type ClusterNodeInfo } from "./index.js";

/**
 * Minimal in-process fake of the subset of Redis commands RedisCoordinator uses,
 * honoring NX/XX on SET so leader-lock semantics behave like the real store.
 */
function makeFakeRedis(): { client: ClusterRedisClient; store: Map<string, string> } {
  const store = new Map<string, string>();
  const client = {
    async set(key: string, val: string, ...args: unknown[]): Promise<string | null> {
      const nx = args.includes("NX");
      const xx = args.includes("XX");
      if (nx && store.has(key)) return null;
      if (xx && !store.has(key)) return null;
      store.set(key, val);
      return "OK";
    },
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },
    async keys(): Promise<string[]> {
      return [...store.keys()];
    },
    async publish(): Promise<number> {
      return 0;
    },
    async subscribe(): Promise<void> {},
    async psubscribe(): Promise<void> {},
    duplicate(): ClusterRedisClient {
      return client;
    },
    async quit(): Promise<void> {},
    on(): void {},
  } as unknown as ClusterRedisClient;
  return { client, store };
}

const nodeInfo = (nodeId: string): ClusterNodeInfo => ({
  nodeId,
  hostname: "host",
  port: 8000,
  role: "leader",
  startedAt: new Date().toISOString(),
  lastHeartbeatAt: new Date().toISOString(),
});

describe("RedisCoordinator leader relinquish (split-brain)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("relinquishes leadership when the lock key disappears on a renewal tick", async () => {
    const { client, store } = makeFakeRedis();
    const coord = new RedisCoordinator(client, "node-A", "test:", 50);

    await coord.registerNode(nodeInfo("node-A"));
    expect(coord.isLeader()).toBe(true);

    // Simulate lock expiry (missed renewals / event-loop starvation): a follower
    // could now win SET NX. The old leader must stop claiming leadership on the
    // very next renewal tick, not one tick later.
    store.delete("test:leader");

    await vi.advanceTimersByTimeAsync(60);

    expect(coord.isLeader()).toBe(false);
    coord.shutdown();
  });

  it("refreshes lastHeartbeatAt on each successful renewal (no stale blob)", async () => {
    const { client, store } = makeFakeRedis();
    const coord = new RedisCoordinator(client, "node-B", "test:", 50);

    await coord.registerNode(nodeInfo("node-B"));
    const before = JSON.parse(store.get("test:leader")!) as ClusterNodeInfo;

    // Advance real wall-clock-derived timestamp so the refreshed heartbeat differs.
    await vi.advanceTimersByTimeAsync(1200);

    const after = JSON.parse(store.get("test:leader")!) as ClusterNodeInfo;
    expect(coord.isLeader()).toBe(true);
    expect(after.role).toBe("leader");
    expect(new Date(after.lastHeartbeatAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.lastHeartbeatAt).getTime(),
    );
    coord.shutdown();
  });
});
