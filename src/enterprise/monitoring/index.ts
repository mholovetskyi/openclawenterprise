/**
 * Enterprise monitoring subsystem.
 * Enables Prometheus metrics + health probes (/metrics, /healthz, /readyz, /livez).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../../config/config.js";
import { initMetricsRegistry, getMetricsOutput, rebuildMetrics } from "./metrics.js";

export type MonitoringHandle = {
  handleMetricsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  handleHealthRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  shutdown: () => Promise<void>;
};

export async function initMonitoring(cfg: OpenClawConfig): Promise<MonitoringHandle> {
  const monCfg = cfg.enterprise?.monitoring;

  if (monCfg?.enabled !== false) {
    await initMetricsRegistry();
    rebuildMetrics();
  }

  return {
    async handleMetricsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = req.url?.split("?")[0];
      if (url !== "/metrics") return false;
      const body = await getMetricsOutput();
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(body);
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

    shutdown: async () => {},
  };
}
