import { describe, it, expect, afterEach } from "vitest";
import { initCluster, type ClusterHandle } from "./index.js";
import type { OpenClawConfig } from "../../config/config.js";

const baseCfg = {
  enterprise: { cluster: { enabled: true, nodeId: "test-node-1" } },
  gateway: { port: 8000 },
} as unknown as OpenClawConfig;

describe("initCluster", () => {
  let handle: ClusterHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
  });

  it("returns a handle with nodeId, coordinator, bus, and shutdown", async () => {
    handle = await initCluster(baseCfg);
    expect(handle.nodeId).toBeTruthy();
    expect(handle.coordinator).toBeDefined();
    expect(handle.bus).toBeDefined();
    expect(typeof handle.shutdown).toBe("function");
  });

  it("uses nodeId from config when provided", async () => {
    handle = await initCluster(baseCfg);
    expect(handle.nodeId).toBe("test-node-1");
  });

  it("generates a nodeId when not configured", async () => {
    const cfg = {} as OpenClawConfig;
    handle = await initCluster(cfg);
    expect(typeof handle.nodeId).toBe("string");
    expect(handle.nodeId.length).toBeGreaterThan(0);
  });

  it("shutdown resolves without error", async () => {
    handle = await initCluster(baseCfg);
    await expect(handle.shutdown()).resolves.toBeUndefined();
    handle = null; // already shut down
  });
});

describe("InMemoryCoordinator (via initCluster)", () => {
  let handle: ClusterHandle;

  afterEach(async () => {
    if (handle) {await handle.shutdown();}
  });

  it("registers the node on init (getLeader returns current node)", async () => {
    handle = await initCluster(baseCfg);
    const leader = await handle.coordinator.getLeader();
    expect(leader?.nodeId).toBe("test-node-1");
    expect(leader?.role).toBe("leader");
  });

  it("isLeader returns true for in-memory coordinator", async () => {
    handle = await initCluster(baseCfg);
    expect(handle.coordinator.isLeader()).toBe(true);
  });

  it("listNodes returns the registered node", async () => {
    handle = await initCluster(baseCfg);
    const nodes = await handle.coordinator.listNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(nodes.some((n) => n.nodeId === "test-node-1")).toBe(true);
  });

  it("removeNode removes a node from the list", async () => {
    handle = await initCluster(baseCfg);
    await handle.coordinator.removeNode("test-node-1");
    const nodes = await handle.coordinator.listNodes();
    expect(nodes.some((n) => n.nodeId === "test-node-1")).toBe(false);
  });

  it("shutdown removes the node from the coordinator", async () => {
    handle = await initCluster(baseCfg);
    await handle.shutdown();
    const nodes = await handle.coordinator.listNodes();
    expect(nodes.some((n) => n.nodeId === "test-node-1")).toBe(false);
    handle = null as unknown as ClusterHandle;
  });
});

describe("InMemoryBus (via initCluster)", () => {
  let handle: ClusterHandle;

  afterEach(async () => {
    if (handle) {await handle.shutdown();}
  });

  it("delivers published messages to subscribers", async () => {
    handle = await initCluster(baseCfg);
    const received: unknown[] = [];
    handle.bus.subscribe("test-channel", (msg) => received.push(msg));
    await handle.bus.publish("test-channel", { hello: "world" });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ hello: "world" });
  });

  it("multiple subscribers receive the same message", async () => {
    handle = await initCluster(baseCfg);
    const r1: unknown[] = [];
    const r2: unknown[] = [];
    handle.bus.subscribe("ch", (m) => r1.push(m));
    handle.bus.subscribe("ch", (m) => r2.push(m));
    await handle.bus.publish("ch", "ping");
    expect(r1).toEqual(["ping"]);
    expect(r2).toEqual(["ping"]);
  });

  it("unsubscribe stops message delivery", async () => {
    handle = await initCluster(baseCfg);
    const received: unknown[] = [];
    const unsub = handle.bus.subscribe("ch2", (m) => received.push(m));
    await handle.bus.publish("ch2", "msg1");
    unsub();
    await handle.bus.publish("ch2", "msg2");
    expect(received).toHaveLength(1);
    expect(received[0]).toBe("msg1");
  });

  it("publish to channel with no subscribers does not throw", async () => {
    handle = await initCluster(baseCfg);
    await expect(handle.bus.publish("empty-channel", "data")).resolves.toBeUndefined();
  });

  it("subscriber errors are swallowed", async () => {
    handle = await initCluster(baseCfg);
    handle.bus.subscribe("err-ch", () => { throw new Error("subscriber error"); });
    await expect(handle.bus.publish("err-ch", "data")).resolves.toBeUndefined();
  });
});
