/**
 * Enterprise monitoring subsystem.
 * Enables Prometheus metrics + health probes (/metrics, /healthz, /readyz, /livez).
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../../config/config.js";
import { initMetricsRegistry, getMetricsOutput, rebuildMetrics } from "./metrics.js";

export type MonitoringHandle = {
  /** Resolved metrics path (default "/metrics"). */
  readonly metricsPath: string;
  /** Dedicated metrics port, when configured (otherwise served on the gateway port). */
  readonly metricsPort: number | undefined;
  handleMetricsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  handleHealthRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /**
   * Bind a dedicated HTTP listener on `metricsPort` (no-op when unset or already
   * bound) so metrics are served off the client-facing gateway port. Must be
   * called at most once per process — see the integration note in
   * initEnterprise wiring. Safe to await; resolves once listening (or immediately
   * when there is no dedicated port).
   */
  startMetricsServer(): Promise<void>;
  shutdown: () => Promise<void>;
};

export type MonitoringDeps = {
  /** Injectable http.createServer, for tests. Defaults to node:http createServer. */
  createServer?: (listener: (req: IncomingMessage, res: ServerResponse) => void) => Server;
};

/** Normalize a configured metrics path to a leading-slash, query-free form. */
function normalizeMetricsPath(raw: string | undefined): string {
  if (!raw || raw.trim() === "") return "/metrics";
  const trimmed = raw.trim().split("?")[0]!;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function initMonitoring(
  cfg: OpenClawConfig,
  deps: MonitoringDeps = {},
): Promise<MonitoringHandle> {
  const monCfg = cfg.enterprise?.monitoring;
  const enabled = monCfg?.enabled !== false;

  if (enabled) {
    await initMetricsRegistry();
    rebuildMetrics();
  }

  const metricsPath = normalizeMetricsPath(monCfg?.metricsPath);
  const metricsPort = monCfg?.metricsPort;

  let metricsServer: Server | null = null;

  async function writeMetrics(res: ServerResponse): Promise<void> {
    const body = await getMetricsOutput();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(body);
  }

  return {
    metricsPath,
    metricsPort,

    async handleMetricsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      if (!enabled) return false;
      const url = req.url?.split("?")[0];
      if (url !== metricsPath) return false;

      // Network segmentation: when the operator configured a dedicated
      // `metricsPort`, metrics must NOT be served on the client-facing gateway
      // port (that is the whole point of firewalling the metrics port). This
      // handler is invoked from the gateway listener, so decline unless the
      // request actually arrived on the dedicated port. The dedicated listener
      // bound by startMetricsServer serves metrics on `metricsPort` itself.
      if (metricsPort !== undefined) {
        const localPort = req.socket?.localPort;
        if (localPort !== metricsPort) return false;
      }

      await writeMetrics(res);
      return true;
    },

    async handleHealthRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = req.url?.split("?")[0];
      if (!url) return false;

      // Liveness: is the process alive?
      if (url === "/livez" || url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
        return true;
      }

      // Readiness: are all dependencies ready?
      if (url === "/readyz") {
        const checks: Record<string, string> = { process: "ok" };
        const allOk = Object.values(checks).every((v) => v === "ok");
        res.writeHead(allOk ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: allOk ? "ok" : "degraded",
            checks,
            timestamp: new Date().toISOString(),
          }),
        );
        return true;
      }

      // Startup: one-time check
      if (url === "/startupz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
        return true;
      }

      return false;
    },

    async startMetricsServer(): Promise<void> {
      if (!enabled || metricsPort === undefined || metricsServer) return;
      const createServer = deps.createServer ?? (await import("node:http")).createServer;
      const server = createServer((req, res) => {
        const url = req.url?.split("?")[0];
        if (url === metricsPath) {
          void writeMetrics(res).catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
      });
      metricsServer = server;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(metricsPort, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      // Do not keep the process alive solely for the metrics listener.
      server.unref?.();
    },

    shutdown: async () => {
      const server = metricsServer;
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        metricsServer = null;
      }
    },
  };
}
