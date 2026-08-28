/**
 * Oracle Autonomous Database MCP bridge — connects OpenClaw Enterprise to
 * Oracle's MCP-compatible SQL endpoint via SSE transport.
 *
 * Library-only: this bridge is NOT auto-activated from config. `initEnterprise`
 * does not read `enterprise.oracle`, so `mcp.enabled: true` in config.yaml does
 * not construct it. Invoke it programmatically via `createOracleMcpBridge(...)`,
 * passing an `OracleMcpBridgeConfig`.
 *
 * Guardrail rules enforce:
 *   - Tool allowlist / blocklist
 *   - SQL injection pattern detection
 *   - Approval-required tools
 *   - Row limit enforcement
 *
 * Health monitoring pings the MCP endpoint at configurable intervals.
 */

import type { Counter, Gauge, Histogram } from "../monitoring/metrics.js";

// ── Config ─────────────────────────────────────────────────────────────────────

export type OracleMcpBridgeConfig = {
  enabled?: boolean;
  endpoint: string;
  auth?: {
    method?: "oci-api-key" | "token";
    tenancyId?: string;
    userId?: string;
    fingerprint?: string;
    privateKey?: string;
    region?: string;
    bearerToken?: string;
  };
  allowedTools?: string[];
  blockedTools?: string[];
  requireApproval?: string[];
  maxResultRows?: number;
  queryTimeout?: number;
  healthCheckIntervalMs?: number;
};

// ── Types ──────────────────────────────────────────────────────────────────────

export type McpToolCall = {
  tool: string;
  input: Record<string, unknown>;
};

export type McpToolResult = {
  content: unknown;
  rowCount?: number;
};

export type McpGuardrailAction = "allow" | "block" | "require-approval";

export type McpGuardrailResult = {
  action: McpGuardrailAction;
  reason?: string;
  ruleId?: string;
};

export type OracleMcpBridgeMetrics = {
  toolCalls: Counter;
  toolLatency: Histogram;
  guardrailBlocks: Counter;
  healthStatus: Gauge;
};

export type OracleMcpBridgeDeps = {
  resolveSecret: (value: string) => Promise<string>;
  metricsOverride?: OracleMcpBridgeMetrics;
  /** Override for SSE transport (testing). */
  transport?: McpTransport;
};

export type McpTransport = {
  call(
    tool: string,
    input: Record<string, unknown>,
    opts?: { timeout?: number },
  ): Promise<McpToolResult>;
  listTools(): Promise<Array<{ name: string; description?: string }>>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

// ── SQL injection patterns ─────────────────────────────────────────────────────

const SQL_INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp; description: string }> = [
  {
    id: "sqli-union-select",
    pattern: /\bUNION\s+(?:ALL\s+)?SELECT\b/i,
    description: "UNION-based injection",
  },
  {
    id: "sqli-comment-sequence",
    pattern: /(['"])\s*;\s*--/,
    description: "Comment-terminated injection",
  },
  {
    id: "sqli-stacked-query",
    pattern: /;\s*(?:DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE)\s/i,
    description: "Stacked query injection",
  },
  {
    id: "sqli-always-true",
    pattern: /\bOR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    description: "Always-true condition injection",
  },
  {
    id: "sqli-oracle-specific",
    pattern: /\bUTL_HTTP\b|\bDBMS_LDAP\b|\bDBMS_PIPE\b/i,
    description: "Oracle-specific dangerous package invocation",
  },
];

// ── Guardrail evaluation ───────────────────────────────────────────────────────

export function evaluateMcpGuardrails(
  call: McpToolCall,
  config: OracleMcpBridgeConfig,
): McpGuardrailResult {
  // 1. Blocklist check
  if (config.blockedTools?.includes(call.tool)) {
    return {
      action: "block",
      reason: `Tool "${call.tool}" is blocked by policy`,
      ruleId: "oracle-mcp-blocklist",
    };
  }

  // 2. Allowlist check (if specified, only listed tools are permitted)
  if (config.allowedTools && config.allowedTools.length > 0) {
    if (!config.allowedTools.includes(call.tool)) {
      return {
        action: "block",
        reason: `Tool "${call.tool}" is not in the allow list`,
        ruleId: "oracle-mcp-allowlist",
      };
    }
  }

  // 3. SQL injection detection on all string input values
  const inputStr = JSON.stringify(call.input);
  for (const p of SQL_INJECTION_PATTERNS) {
    p.pattern.lastIndex = 0;
    if (p.pattern.test(inputStr)) {
      return {
        action: "block",
        reason: `SQL injection detected: ${p.description}`,
        ruleId: p.id,
      };
    }
  }

  // 4. Approval-required check
  if (config.requireApproval?.includes(call.tool)) {
    return {
      action: "require-approval",
      reason: `Tool "${call.tool}" requires approval`,
      ruleId: "oracle-mcp-require-approval",
    };
  }

  return { action: "allow" };
}

// ── Row limit enforcement ──────────────────────────────────────────────────────

export function enforceRowLimit(result: McpToolResult, maxRows: number): McpToolResult {
  if (maxRows <= 0) {
    return result;
  }
  if (Array.isArray(result.content)) {
    const truncated = result.content.slice(0, maxRows);
    return {
      content: truncated,
      rowCount: truncated.length,
    };
  }
  return result;
}

// ── Noop metrics ───────────────────────────────────────────────────────────────

function noopMetrics(): OracleMcpBridgeMetrics {
  return {
    toolCalls: { inc() {} },
    toolLatency: { observe() {}, startTimer: () => () => {} },
    guardrailBlocks: { inc() {} },
    healthStatus: { set() {}, inc() {}, dec() {} },
  };
}

// ── Bridge ─────────────────────────────────────────────────────────────────────

export type OracleMcpBridge = {
  callTool(call: McpToolCall): Promise<{ result?: McpToolResult; guardrail?: McpGuardrailResult }>;
  listTools(): Promise<Array<{ name: string; description?: string }>>;
  checkHealth(): Promise<boolean>;
  close(): Promise<void>;
};

export async function createOracleMcpBridge(
  config: OracleMcpBridgeConfig,
  deps: OracleMcpBridgeDeps,
): Promise<OracleMcpBridge> {
  const endpoint = await deps.resolveSecret(config.endpoint);
  const queryTimeout = config.queryTimeout ?? 30_000;
  const maxResultRows = config.maxResultRows ?? 1000;
  const healthCheckMs = config.healthCheckIntervalMs ?? 60_000;

  const m = deps.metricsOverride ?? noopMetrics();

  // Resolve auth secrets
  let authHeaders: Record<string, string> = {};
  if (config.auth) {
    if (config.auth.method === "token" && config.auth.bearerToken) {
      const token = await deps.resolveSecret(config.auth.bearerToken);
      authHeaders = { Authorization: `Bearer ${token}` };
    }
    // oci-api-key auth would add OCI request signing — left to the transport layer
  }

  // Get transport
  const transport = deps.transport ?? createDefaultTransport(endpoint, authHeaders, queryTimeout);

  // Health check interval
  let healthTimer: NodeJS.Timeout | null = null;
  let healthy = false;

  async function runHealthCheck(): Promise<boolean> {
    try {
      healthy = await transport.ping();
      m.healthStatus.set({ bridge: "oracle-mcp" }, healthy ? 1 : 0);
      return healthy;
    } catch {
      healthy = false;
      m.healthStatus.set({ bridge: "oracle-mcp" }, 0);
      return false;
    }
  }

  // Initial health check
  await runHealthCheck();

  if (healthCheckMs > 0) {
    healthTimer = setInterval(runHealthCheck, healthCheckMs);
    healthTimer.unref?.();
  }

  return {
    async callTool(call: McpToolCall) {
      // Guardrail check
      const guardrail = evaluateMcpGuardrails(call, config);
      if (guardrail.action === "block") {
        m.guardrailBlocks.inc({ tool: call.tool, rule: guardrail.ruleId ?? "unknown" });
        m.toolCalls.inc({ tool: call.tool, status: "blocked" });
        return { guardrail };
      }
      if (guardrail.action === "require-approval") {
        m.toolCalls.inc({ tool: call.tool, status: "approval-required" });
        return { guardrail };
      }

      // Execute tool call
      const start = Date.now();
      try {
        let result = await transport.call(call.tool, call.input, { timeout: queryTimeout });
        result = enforceRowLimit(result, maxResultRows);
        const elapsed = (Date.now() - start) / 1000;
        m.toolLatency.observe({ tool: call.tool }, elapsed);
        m.toolCalls.inc({ tool: call.tool, status: "success" });
        return { result };
      } catch (err) {
        m.toolCalls.inc({ tool: call.tool, status: "error" });
        throw err;
      }
    },

    async listTools() {
      return transport.listTools();
    },

    async checkHealth() {
      return runHealthCheck();
    },

    async close() {
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }
      await transport.close();
    },
  };
}

// ── Default transport (fetch-based SSE) ────────────────────────────────────────

function createDefaultTransport(
  endpoint: string,
  headers: Record<string, string>,
  timeout: number,
): McpTransport {
  return {
    async call(tool, input, opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts?.timeout ?? timeout);
      try {
        const res = await fetch(`${endpoint}/tools/${encodeURIComponent(tool)}/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`MCP call failed: ${res.status} ${res.statusText}`);
        }
        // SAFETY: reached only after res.ok, so the body is the MCP server's tool-call response for this endpoint, which returns the McpToolResult JSON shape.
        return (await res.json()) as McpToolResult;
      } finally {
        clearTimeout(timer);
      }
    },
    async listTools() {
      const res = await fetch(`${endpoint}/tools`, {
        headers: { ...headers },
      });
      if (!res.ok) {
        throw new Error(`MCP listTools failed: ${res.status}`);
      }
      // SAFETY: reached only after res.ok, so the body is the MCP server's tool listing, an array of tool descriptors each carrying a string `name` and optional description.
      return (await res.json()) as Array<{ name: string; description?: string }>;
    },
    async ping() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(`${endpoint}/health`, {
          headers: { ...headers },
          signal: controller.signal,
        });
        clearTimeout(timer);
        return res.ok;
      } catch {
        return false;
      }
    },
    async close() {
      // No persistent connection to close for fetch-based transport
    },
  };
}
