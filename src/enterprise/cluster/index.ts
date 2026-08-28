/**
 * Distributed cluster subsystem.
 *
 * Provides: leader election, inter-node messaging, session affinity,
 * and stateful channel pinning for horizontal scaling.
 *
 * Backends:
 *   - Redis (ioredis): production HA — enable with enterprise.cluster.redis.url
 *   - In-memory: single-node dev/test (default when Redis is not configured)
 *
 * Leader election: the node that holds the Redis lock key is the leader.
 * Lock is renewed every heartbeatIntervalMs. If a node fails to renew,
 * the lock expires and any follower that wins the next SET NX becomes leader.
 *
 * Activation: enterprise.cluster.enabled: true
 */

import { randomBytes } from "node:crypto";
import os from "node:os";
import type { OpenClawConfig } from "../../config/config.js";

export type ClusterNodeInfo = {
  nodeId: string;
  hostname: string;
  port: number;
  role: "leader" | "follower";
  startedAt: string;
  lastHeartbeatAt: string;
};

export type ClusterBus = {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: (message: unknown) => void): () => void;
};

export type ClusterCoordinator = {
  getLeader(): Promise<ClusterNodeInfo | null>;
  isLeader(): boolean;
  listNodes(): Promise<ClusterNodeInfo[]>;
  registerNode(info: ClusterNodeInfo): Promise<void>;
  removeNode(nodeId: string): Promise<void>;
};

export type ClusterHandle = {
  nodeId: string;
  coordinator: ClusterCoordinator;
  bus: ClusterBus;
  shutdown: () => Promise<void>;
};

// ── In-memory (single-node) implementation ─────────────────────────────────────

class InMemoryCoordinator implements ClusterCoordinator {
  private nodes = new Map<string, ClusterNodeInfo>();
  private nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  async getLeader(): Promise<ClusterNodeInfo | null> {
    return this.nodes.get(this.nodeId) ?? null;
  }

  isLeader(): boolean {
    return true;
  }

  async listNodes(): Promise<ClusterNodeInfo[]> {
    return [...this.nodes.values()];
  }

  async registerNode(info: ClusterNodeInfo): Promise<void> {
    this.nodes.set(info.nodeId, info);
  }

  async removeNode(nodeId: string): Promise<void> {
    this.nodes.delete(nodeId);
  }
}

class InMemoryBus implements ClusterBus {
  private handlers = new Map<string, Set<(msg: unknown) => void>>();

  async publish(channel: string, message: unknown): Promise<void> {
    const subs = this.handlers.get(channel);
    if (subs) {
      for (const handler of subs) {
        try {
          handler(message);
        } catch {
          /* ignore */
        }
      }
    }
  }

  subscribe(channel: string, handler: (message: unknown) => void): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    return () => this.handlers.get(channel)?.delete(handler);
  }
}

// ── Redis implementation ────────────────────────────────────────────────────────

type RedisClient = {
  set(key: string, val: string, ...args: unknown[]): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, callback: (channel: string, message: string) => void): Promise<void>;
  psubscribe(
    pattern: string,
    callback: (pattern: string, channel: string, message: string) => void,
  ): Promise<void>;
  duplicate(): RedisClient;
  quit(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

async function loadRedis(url: string): Promise<RedisClient> {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  let Redis: new (url: string) => RedisClient;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = req("ioredis") as any;
    Redis = mod.default ?? mod;
  } catch {
    throw new Error("Redis cluster backend requires ioredis. Run: npm install ioredis");
  }
  return new Redis(url);
}

class RedisCoordinator implements ClusterCoordinator {
  private _isLeader = false;
  private lockRenewalTimer: NodeJS.Timeout | null = null;

  constructor(
    private redis: RedisClient,
    private nodeId: string,
    private keyPrefix: string,
    private heartbeatMs: number,
  ) {}

  private nodeKey(id = this.nodeId): string {
    return `${this.keyPrefix}node:${id}`;
  }

  private get leaderKey(): string {
    return `${this.keyPrefix}leader`;
  }

  async registerNode(info: ClusterNodeInfo): Promise<void> {
    const ttlSec = Math.ceil((this.heartbeatMs * 4) / 1000); // 4 missed heartbeats = dead
    await this.redis.set(this.nodeKey(info.nodeId), JSON.stringify(info), "EX", ttlSec);
    await this.tryAcquireLeadership(info);
  }

  private async tryAcquireLeadership(info: ClusterNodeInfo): Promise<void> {
    const ttlSec = Math.ceil((this.heartbeatMs * 3) / 1000);
    // NX = only set if key does not exist
    const result = await this.redis.set(
      this.leaderKey,
      JSON.stringify({ ...info, nodeId: this.nodeId }),
      "EX",
      ttlSec,
      "NX",
    );
    if (result === "OK") {
      this._isLeader = true;
    } else {
      // Check if we're already the leader (key exists and belongs to us)
      const leaderRaw = await this.redis.get(this.leaderKey);
      if (leaderRaw) {
        const leader = JSON.parse(leaderRaw) as { nodeId: string };
        this._isLeader = leader.nodeId === this.nodeId;
      }
    }

    if (this._isLeader) {
      this.startLockRenewal(ttlSec);
    }
  }

  private startLockRenewal(ttlSec: number): void {
    if (this.lockRenewalTimer) clearInterval(this.lockRenewalTimer);
    this.lockRenewalTimer = setInterval(async () => {
      try {
        // Extend the lock only if we still hold it
        const raw = await this.redis.get(this.leaderKey);
        if (raw) {
          const current = JSON.parse(raw) as { nodeId: string };
          if (current.nodeId === this.nodeId) {
            await this.redis.set(this.leaderKey, raw, "EX", ttlSec, "XX");
            this._isLeader = true;
          } else {
            this._isLeader = false;
            if (this.lockRenewalTimer) clearInterval(this.lockRenewalTimer);
            this.lockRenewalTimer = null;
          }
        }
      } catch {
        // Redis error during renewal — yield leadership to prevent split-brain.
        // Keep interval running; will reattempt on next tick.
        this._isLeader = false;
      }
    }, this.heartbeatMs);
    this.lockRenewalTimer.unref?.();
  }

  async getLeader(): Promise<ClusterNodeInfo | null> {
    const raw = await this.redis.get(this.leaderKey);
    return raw ? (JSON.parse(raw) as ClusterNodeInfo) : null;
  }

  isLeader(): boolean {
    return this._isLeader;
  }

  async listNodes(): Promise<ClusterNodeInfo[]> {
    const keys = await this.redis.keys(`${this.keyPrefix}node:*`);
    const nodes: ClusterNodeInfo[] = [];
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw) {
        try {
          nodes.push(JSON.parse(raw) as ClusterNodeInfo);
        } catch {
          /* skip */
        }
      }
    }
    return nodes;
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.redis.del(this.nodeKey(nodeId));
    if (nodeId === this.nodeId && this._isLeader) {
      await this.redis.del(this.leaderKey);
      this._isLeader = false;
    }
    if (this.lockRenewalTimer) {
      clearInterval(this.lockRenewalTimer);
      this.lockRenewalTimer = null;
    }
  }

  shutdown(): void {
    if (this.lockRenewalTimer) {
      clearInterval(this.lockRenewalTimer);
      this.lockRenewalTimer = null;
    }
  }
}

class RedisBus implements ClusterBus {
  private subClient: RedisClient;
  private handlers = new Map<string, Set<(msg: unknown) => void>>();

  constructor(
    private pubClient: RedisClient,
    private keyPrefix: string,
  ) {
    this.subClient = pubClient.duplicate();
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.pubClient.publish(`${this.keyPrefix}${channel}`, JSON.stringify(message));
  }

  subscribe(channel: string, handler: (message: unknown) => void): () => void {
    const prefixed = `${this.keyPrefix}${channel}`;
    if (!this.handlers.has(prefixed)) {
      this.handlers.set(prefixed, new Set());
      // Wire up Redis subscription for this channel
      void this.subClient.subscribe(prefixed, (_ch, msg) => {
        const subs = this.handlers.get(prefixed);
        if (!subs) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(msg);
        } catch {
          return;
        }
        for (const h of subs) {
          try {
            h(parsed);
          } catch {
            /* ignore */
          }
        }
      });
    }
    this.handlers.get(prefixed)!.add(handler);
    return () => {
      this.handlers.get(prefixed)?.delete(handler);
    };
  }

  async shutdown(): Promise<void> {
    await this.subClient.quit();
  }
}

// ── Initialization ─────────────────────────────────────────────────────────────

export async function initCluster(cfg: OpenClawConfig): Promise<ClusterHandle> {
  const clusterCfg = cfg.enterprise?.cluster;
  const nodeId = clusterCfg?.nodeId ?? `${os.hostname()}-${randomBytes(4).toString("hex")}`;

  const redisUrl = clusterCfg?.redis?.url as string | undefined;

  if (redisUrl) {
    // ── Redis-backed cluster ──────────────────────────────────────────────────
    let redis: RedisClient;
    try {
      redis = await loadRedis(redisUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ioredis")) {
        process.stderr.write(
          `[enterprise/cluster] WARNING: ${msg}\n` +
            "Falling back to in-memory single-node mode.\n",
        );
        return buildInMemory(nodeId, cfg);
      }
      throw err;
    }

    const keyPrefix = (clusterCfg?.redis?.keyPrefix as string | undefined) ?? "openclaw:";
    const heartbeatMs = (clusterCfg?.heartbeatIntervalMs as number | undefined) ?? 10_000;

    const nodeInfo: ClusterNodeInfo = {
      nodeId,
      hostname: os.hostname(),
      port: cfg.gateway?.port ?? 8000,
      role: "leader", // will be updated by coordinator
      startedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };

    const coordinator = new RedisCoordinator(redis, nodeId, keyPrefix, heartbeatMs);
    const bus = new RedisBus(redis, keyPrefix);

    await coordinator.registerNode(nodeInfo);

    // Heartbeat
    const heartbeatTimer = setInterval(async () => {
      nodeInfo.lastHeartbeatAt = new Date().toISOString();
      nodeInfo.role = coordinator.isLeader() ? "leader" : "follower";
      await coordinator.registerNode(nodeInfo).catch(() => {});
    }, heartbeatMs);
    heartbeatTimer.unref?.();

    return {
      nodeId,
      coordinator,
      bus,
      shutdown: async () => {
        clearInterval(heartbeatTimer);
        coordinator.shutdown();
        await coordinator.removeNode(nodeId);
        await bus.shutdown();
        await redis.quit();
      },
    };
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  return buildInMemory(nodeId, cfg);
}

function buildInMemory(nodeId: string, cfg: OpenClawConfig): ClusterHandle {
  const coordinator = new InMemoryCoordinator(nodeId);
  const bus = new InMemoryBus();
  const heartbeatMs =
    (cfg.enterprise?.cluster?.heartbeatIntervalMs as number | undefined) ?? 10_000;

  const nodeInfo: ClusterNodeInfo = {
    nodeId,
    hostname: os.hostname(),
    port: cfg.gateway?.port ?? 8000,
    role: "leader",
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
  };

  void coordinator.registerNode(nodeInfo);

  const heartbeatTimer = setInterval(async () => {
    nodeInfo.lastHeartbeatAt = new Date().toISOString();
    await coordinator.registerNode(nodeInfo).catch(() => {});
  }, heartbeatMs);
  heartbeatTimer.unref?.();

  return {
    nodeId,
    coordinator,
    bus,
    shutdown: async () => {
      clearInterval(heartbeatTimer);
      await coordinator.removeNode(nodeId);
    },
  };
}
