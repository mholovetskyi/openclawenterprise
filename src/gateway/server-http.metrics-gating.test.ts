// Metrics/livez gating tests: the enterprise /metrics + /livez block must be
// gated on enterprise being enabled (a community install must not spin up or
// serve the metrics registry), and /metrics must require auth (local-direct or
// bearer) when served on the gateway port, while /livez stays unauthenticated
// for Kubernetes liveness probes.
import type { ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";
import { resetEnterpriseMonitoringForTests } from "./server-http.js";
import {
  AUTH_NONE,
  AUTH_TOKEN,
  createRequest,
  createTestGatewayServer,
  dispatchRequest,
} from "./server-http.test-harness.js";
import { withTempConfig } from "./test-temp-config.js";

type Overrides = Parameters<typeof createTestGatewayServer>[0]["overrides"];

// Local response mock that also implements writeHead(), which the enterprise
// monitoring handlers use (the shared harness mock only covers setHeader/end).
function createMonitoringResponse(): {
  res: ServerResponse;
  ended: Promise<void>;
  getBody: () => string;
} {
  let body = "";
  let resolveEnd!: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  const finish = (chunk?: unknown) => {
    body = typeof chunk === "string" ? chunk : chunk == null ? body : JSON.stringify(chunk);
    resolveEnd();
  };
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader: vi.fn(),
    removeHeader: vi.fn(),
    writeHead: vi.fn((code: number) => {
      (res as { statusCode: number }).statusCode = code;
      return res;
    }),
    end: vi.fn((chunk?: unknown) => finish(chunk)),
  } as unknown as ServerResponse;
  return { res, ended, getBody: () => body };
}

async function requestMetrics(params: {
  cfg: unknown;
  resolvedAuth: ResolvedGatewayAuth;
  path: string;
  remoteAddress?: string;
  authorization?: string;
  overrides?: Overrides;
}): Promise<{ statusCode: number; body: string }> {
  let result = { statusCode: 0, body: "" };
  await withTempConfig({
    prefix: "metrics-gating",
    cfg: params.cfg,
    run: async () => {
      resetEnterpriseMonitoringForTests();
      const server = createTestGatewayServer({
        resolvedAuth: params.resolvedAuth,
        overrides: params.overrides,
      });
      const { res, ended, getBody } = createMonitoringResponse();
      await dispatchRequest(
        server,
        createRequest({
          path: params.path,
          remoteAddress: params.remoteAddress,
          authorization: params.authorization,
        }),
        res,
      );
      await Promise.race([
        ended,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        }),
      ]);
      result = { statusCode: res.statusCode, body: getBody() };
    },
  });
  return result;
}

const ENTERPRISE_ON = {
  gateway: { trustedProxies: [] },
  enterprise: { enabled: true, monitoring: { enabled: true } },
};

describe("enterprise /metrics + /livez gating", () => {
  beforeEach(() => {
    resetEnterpriseMonitoringForTests();
  });

  it("does NOT serve /metrics on a community install (enterprise disabled)", async () => {
    const { statusCode, body } = await requestMetrics({
      cfg: { gateway: { trustedProxies: [] } },
      resolvedAuth: AUTH_NONE,
      path: "/metrics",
      remoteAddress: "127.0.0.1",
    });
    // Falls through to native handling — never emits Prometheus output.
    expect(statusCode).toBe(404);
    expect(body).not.toContain("# HELP");
  });

  it("does NOT serve /livez on a community install (enterprise disabled)", async () => {
    const { statusCode } = await requestMetrics({
      cfg: { gateway: { trustedProxies: [] } },
      resolvedAuth: AUTH_NONE,
      path: "/livez",
      remoteAddress: "127.0.0.1",
    });
    expect(statusCode).toBe(404);
  });

  it("does NOT serve /metrics when monitoring is disabled even if enterprise is on", async () => {
    const { statusCode } = await requestMetrics({
      cfg: {
        gateway: { trustedProxies: [] },
        enterprise: { enabled: true, monitoring: { enabled: false } },
      },
      resolvedAuth: AUTH_NONE,
      path: "/metrics",
      remoteAddress: "127.0.0.1",
    });
    expect(statusCode).toBe(404);
  });

  it("serves /metrics to a local-direct caller when enterprise monitoring is enabled", async () => {
    const { statusCode } = await requestMetrics({
      cfg: ENTERPRISE_ON,
      resolvedAuth: AUTH_TOKEN,
      path: "/metrics",
      remoteAddress: "127.0.0.1",
    });
    // 200 = the metrics handler served it (body content depends on prom-client
    // being installed; the point here is that a local-direct caller is admitted).
    expect(statusCode).toBe(200);
  });

  it("rejects an unauthenticated remote /metrics request with 401", async () => {
    const { statusCode, body } = await requestMetrics({
      cfg: ENTERPRISE_ON,
      resolvedAuth: AUTH_TOKEN,
      path: "/metrics",
      remoteAddress: "203.0.113.7",
    });
    expect(statusCode).toBe(401);
    expect(body).not.toContain("# HELP");
  });

  it("serves a remote /metrics request that presents a valid bearer token", async () => {
    const { statusCode } = await requestMetrics({
      cfg: ENTERPRISE_ON,
      resolvedAuth: AUTH_TOKEN,
      path: "/metrics",
      remoteAddress: "203.0.113.7",
      authorization: "Bearer test-token",
    });
    expect(statusCode).toBe(200);
  });

  it("keeps /livez unauthenticated (K8s liveness) when enterprise monitoring is enabled", async () => {
    const { statusCode, body } = await requestMetrics({
      cfg: ENTERPRISE_ON,
      resolvedAuth: AUTH_TOKEN,
      path: "/livez",
      remoteAddress: "203.0.113.7",
    });
    expect(statusCode).toBe(200);
    expect(body).toContain("ok");
  });

  it("does NOT serve /metrics on the gateway port when a dedicated metricsPort is configured", async () => {
    const { statusCode } = await requestMetrics({
      cfg: {
        gateway: { trustedProxies: [] },
        enterprise: { enabled: true, monitoring: { enabled: true, metricsPort: 19999 } },
      },
      resolvedAuth: AUTH_TOKEN,
      // Even a local caller does not get metrics on the gateway port: the
      // dedicated listener on metricsPort is the segmentation boundary.
      path: "/metrics",
      remoteAddress: "127.0.0.1",
    });
    expect(statusCode).toBe(404);
  });
});
