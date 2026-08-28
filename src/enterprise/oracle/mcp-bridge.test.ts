import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOracleMcpBridge,
  evaluateMcpGuardrails,
  enforceRowLimit,
  type OracleMcpBridgeConfig,
  type OracleMcpBridgeDeps,
  type McpTransport,
  type OracleMcpBridgeMetrics,
} from "./mcp-bridge.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockTransport(overrides: Partial<McpTransport> = {}): McpTransport {
  return {
    call: vi.fn(async () => ({ content: [{ id: 1 }], rowCount: 1 })),
    listTools: vi.fn(async () => [
      { name: "sql_query", description: "Run SQL" },
      { name: "describe_table", description: "Describe table" },
    ]),
    ping: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeMetrics(): OracleMcpBridgeMetrics & {
  counts: Record<string, number>;
  observations: Array<{ labels: Record<string, string>; value: number }>;
} {
  const counts: Record<string, number> = {};
  const observations: Array<{ labels: Record<string, string>; value: number }> = [];
  return {
    counts,
    observations,
    toolCalls: {
      inc(labels?: Record<string, string>) {
        const key = `${labels?.tool ?? "?"}:${labels?.status ?? "?"}`;
        counts[key] = (counts[key] ?? 0) + 1;
      },
    },
    toolLatency: {
      observe(labels: Record<string, string>, value: number) {
        observations.push({ labels, value });
      },
      startTimer: () => () => {},
    },
    guardrailBlocks: {
      inc(labels?: Record<string, string>) {
        const key = `block:${labels?.tool ?? "?"}:${labels?.rule ?? "?"}`;
        counts[key] = (counts[key] ?? 0) + 1;
      },
    },
    healthStatus: { set() {}, inc() {}, dec() {} },
  };
}

const baseConfig: OracleMcpBridgeConfig = {
  enabled: true,
  endpoint: "https://adb.us-ashburn-1.oraclecloud.com/mcp",
  healthCheckIntervalMs: 0,
};

function makeDeps(overrides: Partial<OracleMcpBridgeDeps> = {}): {
  transport: McpTransport;
  callFn: ReturnType<typeof vi.fn>;
  closeFn: ReturnType<typeof vi.fn>;
  metrics: ReturnType<typeof makeMetrics>;
  deps: OracleMcpBridgeDeps;
} {
  const callFn = vi.fn(async () => ({ content: [{ id: 1 }], rowCount: 1 }));
  const closeFn = vi.fn(async () => {});
  const transport = makeMockTransport({
    call: callFn,
    close: closeFn,
    ...(overrides.transport as Partial<McpTransport>),
  });
  const m = makeMetrics();
  return {
    transport,
    callFn,
    closeFn,
    metrics: m,
    deps: {
      resolveSecret: vi.fn(async (v: string) => v),
      metricsOverride: m,
      transport,
      ...overrides,
    },
  };
}

// ── Unit: evaluateMcpGuardrails ──────────────────────────────────────────────

describe("evaluateMcpGuardrails", () => {
  it("should allow a normal tool call", () => {
    const result = evaluateMcpGuardrails(
      { tool: "sql_query", input: { query: "SELECT id FROM employees" } },
      baseConfig,
    );
    expect(result.action).toBe("allow");
  });

  it("should block a tool on the blocklist", () => {
    const result = evaluateMcpGuardrails(
      { tool: "drop_table", input: {} },
      { ...baseConfig, blockedTools: ["drop_table"] },
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("oracle-mcp-blocklist");
  });

  it("should block a tool not on the allowlist", () => {
    const result = evaluateMcpGuardrails(
      { tool: "dangerous_tool", input: {} },
      { ...baseConfig, allowedTools: ["sql_query", "describe_table"] },
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("oracle-mcp-allowlist");
  });

  it("should allow a tool on the allowlist", () => {
    const result = evaluateMcpGuardrails(
      { tool: "sql_query", input: { query: "SELECT 1" } },
      { ...baseConfig, allowedTools: ["sql_query"] },
    );
    expect(result.action).toBe("allow");
  });

  it("should detect UNION SELECT injection", () => {
    const result = evaluateMcpGuardrails(
      {
        tool: "sql_query",
        input: { query: "SELECT * FROM users UNION SELECT password FROM admin" },
      },
      baseConfig,
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("sqli-union-select");
  });

  it("should detect comment-terminated injection", () => {
    const result = evaluateMcpGuardrails(
      { tool: "sql_query", input: { query: "' ; --" } },
      baseConfig,
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("sqli-comment-sequence");
  });

  it("should detect stacked query injection", () => {
    const result = evaluateMcpGuardrails(
      { tool: "sql_query", input: { query: "SELECT 1; DROP TABLE users" } },
      baseConfig,
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("sqli-stacked-query");
  });

  it("should detect always-true condition injection", () => {
    const result = evaluateMcpGuardrails(
      { tool: "sql_query", input: { query: "SELECT * FROM users WHERE id=1 OR '1'='1'" } },
      baseConfig,
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("sqli-always-true");
  });

  it("should detect Oracle-specific dangerous packages", () => {
    const result = evaluateMcpGuardrails(
      {
        tool: "sql_query",
        input: { query: "SELECT UTL_HTTP.REQUEST('http://evil.com') FROM dual" },
      },
      baseConfig,
    );
    expect(result.action).toBe("block");
    expect(result.ruleId).toBe("sqli-oracle-specific");
  });

  it("should return require-approval for listed tools", () => {
    const result = evaluateMcpGuardrails(
      { tool: "execute_ddl", input: { query: "CREATE TABLE test (id INT)" } },
      { ...baseConfig, requireApproval: ["execute_ddl"] },
    );
    expect(result.action).toBe("require-approval");
    expect(result.ruleId).toBe("oracle-mcp-require-approval");
  });

  it("should prioritize blocklist over requireApproval", () => {
    const result = evaluateMcpGuardrails(
      { tool: "dangerous", input: {} },
      { ...baseConfig, blockedTools: ["dangerous"], requireApproval: ["dangerous"] },
    );
    expect(result.action).toBe("block");
  });
});

// ── Unit: enforceRowLimit ───────────────────────────────────────────────────

describe("enforceRowLimit", () => {
  it("should truncate array content to maxRows", () => {
    const result = enforceRowLimit({ content: [1, 2, 3, 4, 5], rowCount: 5 }, 3);
    expect(result.content).toEqual([1, 2, 3]);
    expect(result.rowCount).toBe(3);
  });

  it("should pass through non-array content", () => {
    const result = enforceRowLimit({ content: "scalar result", rowCount: 1 }, 3);
    expect(result.content).toBe("scalar result");
  });

  it("should pass through when maxRows is 0", () => {
    const result = enforceRowLimit({ content: [1, 2, 3], rowCount: 3 }, 0);
    expect(result.content).toEqual([1, 2, 3]);
  });

  it("should not truncate when content is within limit", () => {
    const result = enforceRowLimit({ content: [1, 2], rowCount: 2 }, 10);
    expect(result.content).toEqual([1, 2]);
  });
});

// ── Integration: createOracleMcpBridge ────────────────────────────────────────

describe("OracleMcpBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should call transport and return result", async () => {
    const { deps } = makeDeps();
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    const res = await bridge.callTool({ tool: "sql_query", input: { query: "SELECT 1" } });
    expect(res.result).toBeDefined();
    expect(res.result!.content).toEqual([{ id: 1 }]);
    await bridge.close();
  });

  it("should block tool call that fails guardrails", async () => {
    const { deps, metrics: m } = makeDeps();
    const bridge = await createOracleMcpBridge({ ...baseConfig, blockedTools: ["bad_tool"] }, deps);
    const res = await bridge.callTool({ tool: "bad_tool", input: {} });
    expect(res.guardrail?.action).toBe("block");
    expect(res.result).toBeUndefined();
    expect(m.counts["block:bad_tool:oracle-mcp-blocklist"]).toBe(1);
    await bridge.close();
  });

  it("should return require-approval without executing", async () => {
    const { callFn, deps } = makeDeps();
    const bridge = await createOracleMcpBridge(
      { ...baseConfig, requireApproval: ["execute_ddl"] },
      deps,
    );
    const res = await bridge.callTool({ tool: "execute_ddl", input: {} });
    expect(res.guardrail?.action).toBe("require-approval");
    expect(callFn).not.toHaveBeenCalled();
    await bridge.close();
  });

  it("should enforce row limit on results", async () => {
    const { deps } = makeDeps({
      transport: makeMockTransport({
        call: vi.fn(async () => ({
          content: Array.from({ length: 100 }, (_, i) => ({ id: i })),
          rowCount: 100,
        })),
      }),
    });
    const bridge = await createOracleMcpBridge({ ...baseConfig, maxResultRows: 5 }, deps);
    const res = await bridge.callTool({
      tool: "sql_query",
      input: { query: "SELECT * FROM big_table" },
    });
    expect((res.result!.content as unknown[]).length).toBe(5);
    await bridge.close();
  });

  it("should block SQL injection attempts", async () => {
    const { callFn, deps } = makeDeps();
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    const res = await bridge.callTool({
      tool: "sql_query",
      input: { query: "SELECT * FROM users UNION SELECT password FROM admin" },
    });
    expect(res.guardrail?.action).toBe("block");
    expect(callFn).not.toHaveBeenCalled();
    await bridge.close();
  });

  it("should track success metrics", async () => {
    const { deps, metrics: m } = makeDeps();
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    await bridge.callTool({ tool: "sql_query", input: { query: "SELECT 1" } });
    expect(m.counts["sql_query:success"]).toBe(1);
    expect(m.observations.length).toBe(1);
    await bridge.close();
  });

  it("should track error metrics on transport failure", async () => {
    const { deps, metrics: m } = makeDeps({
      transport: makeMockTransport({
        call: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      }),
    });
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    await expect(
      bridge.callTool({ tool: "sql_query", input: { query: "SELECT 1" } }),
    ).rejects.toThrow("connection refused");
    expect(m.counts["sql_query:error"]).toBe(1);
    await bridge.close();
  });

  it("should list tools from transport", async () => {
    const { deps } = makeDeps();
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    const tools = await bridge.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe("sql_query");
    await bridge.close();
  });

  it("should check health via transport ping", async () => {
    const { deps } = makeDeps();
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    const healthy = await bridge.checkHealth();
    expect(healthy).toBe(true);
    await bridge.close();
  });

  it("should report unhealthy when ping fails", async () => {
    const { deps } = makeDeps({
      transport: makeMockTransport({
        ping: vi.fn(async () => false),
      }),
    });
    const bridge = await createOracleMcpBridge(baseConfig, deps);
    const healthy = await bridge.checkHealth();
    expect(healthy).toBe(false);
    await bridge.close();
  });

  it("should resolve auth bearer token", async () => {
    const resolveSecret = vi.fn(async (v: string) => (v === "env://TOKEN" ? "resolved-token" : v));
    const transport = makeMockTransport();
    const m = makeMetrics();
    const bridge = await createOracleMcpBridge(
      {
        ...baseConfig,
        auth: { method: "token", bearerToken: "env://TOKEN" },
      },
      { resolveSecret, transport, metricsOverride: m },
    );
    expect(resolveSecret).toHaveBeenCalledWith("env://TOKEN");
    await bridge.close();
  });

  it("should clean up health timer on close", async () => {
    const closeFn = vi.fn(async () => {});
    const transport = makeMockTransport({ close: closeFn });
    const m = makeMetrics();
    const bridge = await createOracleMcpBridge(
      { ...baseConfig, healthCheckIntervalMs: 10_000 },
      { resolveSecret: async (v) => v, transport, metricsOverride: m },
    );
    await bridge.close();
    expect(closeFn).toHaveBeenCalled();
  });
});
