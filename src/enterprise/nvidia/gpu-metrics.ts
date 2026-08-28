/**
 * NVIDIA GPU metrics collection via nvidia-smi.
 *
 * Polls GPU utilization, memory, temperature, and power metrics on a configurable
 * interval and exports them as Prometheus gauges. Silently disables itself when
 * nvidia-smi is not available — zero overhead when disabled.
 *
 * Activation: enterprise.nvidia.gpuMetrics.enabled: true
 */

import { exec as cpExec } from "node:child_process";
import type { OpenClawConfig } from "../../config/config.js";
import type { NvidiaGpuMetricsConfig } from "../../config/types.enterprise.js";
import { auditLogSync } from "../audit/logger.js";
import { metrics } from "../monitoring/metrics.js";

export type ExecResult = { stdout: string; stderr: string };
export type ExecFn = (cmd: string, opts?: { timeout?: number }) => Promise<ExecResult>;

function defaultExecAsync(cmd: string, opts?: { timeout?: number }): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    cpExec(cmd, opts ?? {}, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export type GpuMetricsDeps = {
  /** Custom exec implementation — defaults to child_process.exec wrapper. */
  exec?: ExecFn;
};

// ── Types ────────────────────────────────────────────────────────────────────

export type GpuState = {
  index: number;
  name: string;
  gpuUtilization: number;
  memoryUtilization: number;
  memoryTotal: number;
  memoryUsed: number;
  memoryFree: number;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  fanSpeed: number;
  pstate: string;
};

export type GpuMetricsHandle = {
  getGpuStates(): GpuState[];
  isAvailable(): boolean;
  shutdown(): Promise<void>;
};

// ── Constants ────────────────────────────────────────────────────────────────

const NVIDIA_SMI_QUERY =
  "index,name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit,fan.speed,pstate";

const NVIDIA_SMI_CMD = `nvidia-smi --query-gpu=${NVIDIA_SMI_QUERY} --format=csv,noheader,nounits`;

const MB_TO_BYTES = 1024 * 1024;

// ── GPU Audit Actions ────────────────────────────────────────────────────────

export const GPU_AUDIT_ACTIONS = {
  GPU_THRESHOLD_EXCEEDED: "nvidia.gpu.threshold_exceeded",
} as const;

// ── Implementation ───────────────────────────────────────────────────────────

let globalHandle: GpuMetricsHandle | null = null;

export function getGpuMetricsHandle(): GpuMetricsHandle | null {
  return globalHandle;
}

export async function initGpuMetrics(
  cfg: OpenClawConfig,
  deps: GpuMetricsDeps = {},
): Promise<GpuMetricsHandle> {
  const execImpl: ExecFn = deps.exec ?? defaultExecAsync;
  const gpuCfg = cfg.enterprise?.nvidia?.gpuMetrics;

  if (!gpuCfg?.enabled) {
    const noop = createNoopHandle();
    globalHandle = noop;
    return noop;
  }

  let available = false;
  let gpuStates: GpuState[] = [];
  let warned = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Check if nvidia-smi exists
  try {
    await execImpl("nvidia-smi --version", { timeout: 5000 });
    available = true;
  } catch {
    if (!warned) {
      process.stderr.write(
        "[openclaw] nvidia-smi not found — GPU metrics disabled. " +
          "Install NVIDIA drivers to enable GPU monitoring.\n",
      );
      warned = true;
    }
    const noop = createNoopHandle();
    globalHandle = noop;
    return noop;
  }

  async function poll(): Promise<void> {
    try {
      const { stdout } = await execImpl(NVIDIA_SMI_CMD, { timeout: 10000 });
      gpuStates = parseNvidiaSmiOutput(stdout);
      updateMetrics(gpuStates);
      checkThresholds(gpuStates, gpuCfg);
    } catch (err) {
      // Non-fatal: log and continue
      if (!warned) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[openclaw] nvidia-smi query failed: ${detail}\n`);
        warned = true;
      }
    }
  }

  // Initial poll
  await poll();

  // Periodic poll
  const interval = gpuCfg.pollIntervalMs ?? 15000;
  pollTimer = setInterval(() => {
    poll().catch(() => {});
  }, interval);
  if (pollTimer.unref) pollTimer.unref();

  const handle: GpuMetricsHandle = {
    getGpuStates: () => [...gpuStates],
    isAvailable: () => available,
    shutdown: async () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      globalHandle = null;
    },
  };

  globalHandle = handle;
  return handle;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parseNvidiaSmiOutput(stdout: string): GpuState[] {
  const lines = stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const states: GpuState[] = [];

  for (const line of lines) {
    const parts = line.split(",").map((s) => s.trim());
    const [
      index,
      name,
      gpuUtilization,
      memoryUtilization,
      memoryTotal,
      memoryUsed,
      memoryFree,
      temperature,
      powerDraw,
      powerLimit,
      fanSpeed,
      pstate,
    ] = parts;
    // Skip malformed rows that do not carry all 12 queried fields.
    if (
      index === undefined ||
      name === undefined ||
      gpuUtilization === undefined ||
      memoryUtilization === undefined ||
      memoryTotal === undefined ||
      memoryUsed === undefined ||
      memoryFree === undefined ||
      temperature === undefined ||
      powerDraw === undefined ||
      powerLimit === undefined ||
      fanSpeed === undefined ||
      pstate === undefined
    ) {
      continue;
    }

    const state: GpuState = {
      index: parseFloat(index) || 0,
      name: name || "Unknown",
      gpuUtilization: parseFloat(gpuUtilization) || 0,
      memoryUtilization: parseFloat(memoryUtilization) || 0,
      memoryTotal: parseFloat(memoryTotal) || 0,
      memoryUsed: parseFloat(memoryUsed) || 0,
      memoryFree: parseFloat(memoryFree) || 0,
      temperature: parseFloat(temperature) || 0,
      powerDraw: parseFloat(powerDraw) || 0,
      powerLimit: parseFloat(powerLimit) || 0,
      fanSpeed: parseFloat(fanSpeed) || 0,
      pstate: pstate || "P0",
    };

    states.push(state);
  }

  return states;
}

// ── Metrics update ───────────────────────────────────────────────────────────

function updateMetrics(states: GpuState[]): void {
  for (const gpu of states) {
    const labels = {
      gpu_index: String(gpu.index),
      gpu_name: gpu.name,
    };

    metrics.gpuUtilization.set(labels, gpu.gpuUtilization);
    metrics.gpuMemoryUsed.set(labels, gpu.memoryUsed * MB_TO_BYTES);
    metrics.gpuMemoryTotal.set(labels, gpu.memoryTotal * MB_TO_BYTES);
    metrics.gpuTemperature.set(labels, gpu.temperature);
    metrics.gpuPowerDraw.set(labels, gpu.powerDraw);
    metrics.gpuPowerLimit.set(labels, gpu.powerLimit);
  }
}

// ── Threshold checking ───────────────────────────────────────────────────────

function checkThresholds(states: GpuState[], gpuCfg: NvidiaGpuMetricsConfig | undefined): void {
  const thresholds = gpuCfg?.alertThresholds;
  if (!thresholds) return;

  for (const gpu of states) {
    if (thresholds.gpuUtilization !== undefined && gpu.gpuUtilization > thresholds.gpuUtilization) {
      emitThresholdEvent(
        gpu.index,
        "gpuUtilization",
        gpu.gpuUtilization,
        thresholds.gpuUtilization,
      );
    }
    if (
      thresholds.memoryUtilization !== undefined &&
      gpu.memoryUtilization > thresholds.memoryUtilization
    ) {
      emitThresholdEvent(
        gpu.index,
        "memoryUtilization",
        gpu.memoryUtilization,
        thresholds.memoryUtilization,
      );
    }
    if (thresholds.temperature !== undefined && gpu.temperature > thresholds.temperature) {
      emitThresholdEvent(gpu.index, "temperature", gpu.temperature, thresholds.temperature);
    }
    if (thresholds.powerDraw !== undefined && gpu.powerLimit > 0) {
      const powerPercent = (gpu.powerDraw / gpu.powerLimit) * 100;
      if (powerPercent > thresholds.powerDraw) {
        emitThresholdEvent(gpu.index, "powerDraw", powerPercent, thresholds.powerDraw);
      }
    }
  }
}

function emitThresholdEvent(
  gpuIndex: number,
  metricName: string,
  currentValue: number,
  threshold: number,
): void {
  auditLogSync({
    action: GPU_AUDIT_ACTIONS.GPU_THRESHOLD_EXCEEDED,
    category: "system",
    actor: { type: "system", id: "gpu-metrics" },
    outcome: "success",
    metadata: {
      gpuIndex,
      metricName,
      currentValue,
      threshold,
    },
  });
}

// ── Noop ─────────────────────────────────────────────────────────────────────

function createNoopHandle(): GpuMetricsHandle {
  return {
    getGpuStates: () => [],
    isAvailable: () => false,
    shutdown: async () => {},
  };
}
