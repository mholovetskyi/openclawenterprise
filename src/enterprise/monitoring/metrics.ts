/**
 * Prometheus metrics registry — zero overhead when disabled.
 *
 * Lazily imports prom-client so it adds no startup cost unless monitoring is enabled.
 */

// ── Metric type definitions ────────────────────────────────────────────────────

export type Counter = {
  inc(labels?: Record<string, string>, value?: number): void;
};
export type Gauge = {
  set(labels: Record<string, string>, value: number): void;
  inc(labels?: Record<string, string>): void;
  dec(labels?: Record<string, string>): void;
};
export type Histogram = {
  observe(labels: Record<string, string>, value: number): void;
  startTimer(labels?: Record<string, string>): () => void;
};

// ── Noop implementations (used when monitoring disabled) ────────────────────────

const noopCounter: Counter = { inc: () => {} };
const noopGauge: Gauge = { set: () => {}, inc: () => {}, dec: () => {} };
const noopHistogram: Histogram = {
  observe: () => {},
  startTimer: () => () => {},
};

// ── Minimal structural types for prom-client ───────────────────────────────────
// prom-client is an optional dependency (zero-dep policy for enterprise
// backends): it is lazy-loaded at runtime, and these local interfaces cover
// only the pieces this module uses so the file typechecks without it.

type PromMetricOptions = {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
};

type PromCounterInstance = {
  inc(value?: number): void;
  labels(labels: Record<string, string>): { inc(value?: number): void };
};

type PromGaugeInstance = {
  inc(value?: number): void;
  dec(value?: number): void;
  labels(labels: Record<string, string>): {
    set(value: number): void;
    inc(value?: number): void;
    dec(value?: number): void;
  };
};

type PromHistogramInstance = {
  startTimer(labels?: Record<string, string>): () => number;
  labels(labels: Record<string, string>): { observe(value: number): void };
};

type PromClientModule = {
  collectDefaultMetrics(opts?: { prefix?: string }): void;
  register: { metrics(): Promise<string> };
  Counter: new (opts: PromMetricOptions) => PromCounterInstance;
  Gauge: new (opts: PromMetricOptions) => PromGaugeInstance;
  Histogram: new (opts: PromMetricOptions) => PromHistogramInstance;
};

// Widened to `string` so the compiler does not try to resolve the optional
// package's type declarations at the dynamic import site below.
const PROM_CLIENT_MODULE: string = "prom-client";

// ── Registry singleton ─────────────────────────────────────────────────────────

let promClient: PromClientModule | null = null;
let registryEnabled = false;

export async function initMetricsRegistry(): Promise<void> {
  try {
    const mod = (await import(PROM_CLIENT_MODULE)) as PromClientModule;
    promClient = mod;
    mod.collectDefaultMetrics({ prefix: "openclaw_node_" });
    registryEnabled = true;
  } catch {
    process.stderr.write(
      "[openclaw] prom-client not installed — Prometheus metrics disabled. " +
        "Run: npm install prom-client\n",
    );
  }
}

export async function getMetricsOutput(): Promise<string> {
  if (!promClient) {
    return "";
  }
  return promClient.register.metrics();
}

export function isMetricsEnabled(): boolean {
  return registryEnabled;
}

// ── Metric factories ───────────────────────────────────────────────────────────

function makeCounter(name: string, help: string, labelNames: string[]): Counter {
  if (!promClient) {
    return noopCounter;
  }
  const c = new promClient.Counter({ name, help, labelNames });
  return {
    inc(labels?: Record<string, string>, value = 1) {
      if (labels) {
        c.labels(labels).inc(value);
      } else {
        c.inc(value);
      }
    },
  };
}

function makeGauge(name: string, help: string, labelNames: string[]): Gauge {
  if (!promClient) {
    return noopGauge;
  }
  const g = new promClient.Gauge({ name, help, labelNames });
  return {
    set(labels, value) {
      g.labels(labels).set(value);
    },
    inc(labels) {
      if (labels) {
        g.labels(labels).inc();
      } else {
        g.inc();
      }
    },
    dec(labels) {
      if (labels) {
        g.labels(labels).dec();
      } else {
        g.dec();
      }
    },
  };
}

function makeHistogram(
  name: string,
  help: string,
  labelNames: string[],
  buckets?: number[],
): Histogram {
  if (!promClient) {
    return noopHistogram;
  }
  const h = new promClient.Histogram({
    name,
    help,
    labelNames,
    buckets: buckets ?? [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  });
  return {
    observe(labels, value) {
      h.labels(labels).observe(value);
    },
    startTimer(labels) {
      const end = h.startTimer(labels);
      return end;
    },
  };
}

// ── Declared metrics ───────────────────────────────────────────────────────────

export let metrics = buildMetrics();

function buildMetrics() {
  return {
    // Gateway
    gatewayConnections: makeCounter(
      "openclaw_gateway_connections_total",
      "Total WebSocket connections",
      ["channel", "status"],
    ),
    gatewayRequests: makeCounter(
      "openclaw_gateway_requests_total",
      "Total gateway RPC method calls",
      ["method", "status"],
    ),
    gatewayRequestDuration: makeHistogram(
      "openclaw_gateway_request_duration_seconds",
      "Gateway RPC method call duration",
      ["method"],
    ),

    // Agents
    agentRuns: makeCounter("openclaw_agent_runs_total", "Total agent runs", [
      "agent_id",
      "model",
      "status",
    ]),
    agentRunDuration: makeHistogram(
      "openclaw_agent_run_duration_seconds",
      "Agent run duration",
      ["agent_id"],
      [1, 5, 10, 30, 60, 120, 300, 600],
    ),
    agentTokens: makeCounter("openclaw_agent_tokens_total", "Total LLM tokens", [
      "agent_id",
      "direction",
      "model",
    ]),
    agentCostUsd: makeCounter("openclaw_agent_cost_usd_total", "Estimated LLM cost in USD", [
      "agent_id",
      "model",
    ]),

    // Skills
    skillExecutions: makeCounter("openclaw_skill_executions_total", "Total skill executions", [
      "skill",
      "status",
    ]),
    skillInstalls: makeCounter("openclaw_skill_installs_total", "Total skill installations", [
      "skill",
      "method",
    ]),

    // Auth & Security
    authAttempts: makeCounter("openclaw_auth_attempts_total", "Total authentication attempts", [
      "method",
      "result",
    ]),
    authRateLimited: makeCounter(
      "openclaw_auth_rate_limited_total",
      "Total rate-limited auth attempts",
      ["ip"],
    ),
    injectionDetected: makeCounter(
      "openclaw_injection_detected_total",
      "Total prompt injection patterns detected",
      ["pattern", "source"],
    ),

    // Sandbox
    sandboxContainers: makeGauge(
      "openclaw_sandbox_containers_active",
      "Active sandbox containers",
      ["isolation", "agent_id"],
    ),
    sandboxMemoryMb: makeGauge(
      "openclaw_sandbox_memory_mb",
      "Sandbox container memory usage in MB",
      ["container_name"],
    ),

    // Audit
    auditEvents: makeCounter("openclaw_audit_events_total", "Total audit events written", [
      "category",
      "action",
      "outcome",
    ]),
    auditStorageErrors: makeCounter(
      "openclaw_audit_storage_errors_total",
      "Audit storage write errors",
      ["backend"],
    ),

    // Channels
    channelMessages: makeCounter(
      "openclaw_channel_messages_total",
      "Total messages processed per channel",
      ["channel", "direction"],
    ),
    channelErrors: makeCounter("openclaw_channel_errors_total", "Total channel errors", [
      "channel",
      "error_type",
    ]),

    // NVIDIA NIM
    nimRequests: makeCounter("openclaw_nim_requests_total", "Total NIM inference requests", [
      "model",
      "status",
    ]),
    nimLatency: makeHistogram(
      "openclaw_nim_latency_seconds",
      "NIM inference request latency",
      ["model"],
      [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    ),
    nimTokens: makeCounter("openclaw_nim_tokens_total", "Total NIM tokens consumed", [
      "model",
      "direction",
    ]),
    nimHealthStatus: makeGauge(
      "openclaw_nim_health_status",
      "NIM endpoint health (0=unhealthy, 1=healthy)",
      ["endpoint"],
    ),

    // NVIDIA NemoClaw
    nemoClawRequests: makeCounter(
      "openclaw_nemoclaw_requests_total",
      "Total NemoClaw inference requests",
      ["model", "status", "profile"],
    ),
    nemoClawLatency: makeHistogram(
      "openclaw_nemoclaw_latency_seconds",
      "NemoClaw inference request latency",
      ["model"],
      [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    ),
    nemoClawTokens: makeCounter(
      "openclaw_nemoclaw_tokens_total",
      "Total NemoClaw tokens consumed",
      ["model", "direction"],
    ),
    nemoClawHealthStatus: makeGauge(
      "openclaw_nemoclaw_health_status",
      "NemoClaw endpoint health (0=unhealthy, 1=healthy)",
      ["endpoint"],
    ),
    nemoClawSandboxEgress: makeCounter(
      "openclaw_nemoclaw_sandbox_egress_total",
      "NemoClaw sandbox egress events",
      ["action"],
    ),

    // NVIDIA GPU
    gpuUtilization: makeGauge(
      "openclaw_nvidia_gpu_utilization_percent",
      "GPU utilization percentage",
      ["gpu_index", "gpu_name"],
    ),
    gpuMemoryUsed: makeGauge("openclaw_nvidia_gpu_memory_used_bytes", "GPU memory used in bytes", [
      "gpu_index",
      "gpu_name",
    ]),
    gpuMemoryTotal: makeGauge(
      "openclaw_nvidia_gpu_memory_total_bytes",
      "GPU total memory in bytes",
      ["gpu_index", "gpu_name"],
    ),
    gpuTemperature: makeGauge(
      "openclaw_nvidia_gpu_temperature_celsius",
      "GPU temperature in Celsius",
      ["gpu_index", "gpu_name"],
    ),
    gpuPowerDraw: makeGauge("openclaw_nvidia_gpu_power_watts", "GPU power draw in watts", [
      "gpu_index",
      "gpu_name",
    ]),
    gpuPowerLimit: makeGauge("openclaw_nvidia_gpu_power_limit_watts", "GPU power limit in watts", [
      "gpu_index",
      "gpu_name",
    ]),
  };
}

/**
 * Re-initialize metrics after promClient is available (call after initMetricsRegistry).
 */
export function rebuildMetrics(): void {
  metrics = buildMetrics();
}
