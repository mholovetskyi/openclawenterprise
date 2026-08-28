import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { initMonitoring } from "./index.js";

// Mock the metrics module to avoid real Prometheus registry setup
vi.mock("./metrics.js", () => ({
  initMetricsRegistry: vi.fn(async () => {}),
  getMetricsOutput: vi.fn(async () => "# mock prometheus output\n"),
  rebuildMetrics: vi.fn(() => {}),
}));

function makeRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function makeRequestOnPort(url: string, localPort: number): IncomingMessage {
  return { url, socket: { localPort } } as unknown as IncomingMessage;
}

function makeResponse(): ServerResponse & {
  _body: string;
  _status: number;
  _headers: Record<string, string>;
} {
  const res = {
    _body: "",
    _status: 0,
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      this._status = status;
      if (headers) Object.assign(this._headers, headers);
    },
    end(body?: string) {
      this._body = body ?? "";
    },
  };
  return res as unknown as ServerResponse & {
    _body: string;
    _status: number;
    _headers: Record<string, string>;
  };
}

const cfg = {} as OpenClawConfig;

describe("handleHealthRequest", () => {
  it("/livez returns 200 with status ok", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/livez");
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
  });

  it("/healthz returns 200 with status ok (alias for livez)", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/healthz");
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body).status).toBe("ok");
  });

  it("/readyz returns 200 when all checks pass", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/readyz");
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe("ok");
    expect(body.checks).toBeDefined();
  });

  it("/startupz returns 200 with status ok", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/startupz");
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body).status).toBe("ok");
  });

  it("returns false for unknown health path", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/unknown-path");
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(false);
  });

  it("returns false when url is undefined", async () => {
    const handle = await initMonitoring(cfg);
    const req = { url: undefined } as unknown as IncomingMessage;
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(false);
  });

  it("ignores query string in URL", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/livez?verbose=true");
    const res = makeResponse();
    const handled = await handle.handleHealthRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
  });
});

describe("handleMetricsRequest", () => {
  it("/metrics returns 200 with prometheus text format", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/metrics");
    const res = makeResponse();
    const handled = await handle.handleMetricsRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toContain("text/plain");
  });

  it("returns false for non-metrics path", async () => {
    const handle = await initMonitoring(cfg);
    const req = makeRequest("/livez");
    const res = makeResponse();
    const handled = await handle.handleMetricsRequest(req, res as unknown as ServerResponse);
    expect(handled).toBe(false);
  });

  it("honors a configured metricsPath instead of hardcoding /metrics", async () => {
    const customCfg = {
      enterprise: { monitoring: { metricsPath: "prometheus" } },
    } as unknown as OpenClawConfig;
    const handle = await initMonitoring(customCfg);
    expect(handle.metricsPath).toBe("/prometheus");

    const okReq = makeRequest("/prometheus");
    const okRes = makeResponse();
    expect(await handle.handleMetricsRequest(okReq, okRes as unknown as ServerResponse)).toBe(true);
    expect(okRes._status).toBe(200);

    // The old hardcoded path must no longer be served.
    const oldReq = makeRequest("/metrics");
    const oldRes = makeResponse();
    expect(await handle.handleMetricsRequest(oldReq, oldRes as unknown as ServerResponse)).toBe(
      false,
    );
  });

  it("does not serve metrics on the gateway port when a dedicated metricsPort is set", async () => {
    const segCfg = {
      enterprise: { monitoring: { metricsPort: 9090 } },
    } as unknown as OpenClawConfig;
    const handle = await initMonitoring(segCfg);
    expect(handle.metricsPort).toBe(9090);

    // Request arriving on the client-facing gateway port (e.g. 8080) is declined.
    const gwReq = makeRequestOnPort("/metrics", 8080);
    const gwRes = makeResponse();
    expect(await handle.handleMetricsRequest(gwReq, gwRes as unknown as ServerResponse)).toBe(
      false,
    );

    // Request arriving on the dedicated metrics port is served.
    const metricsReq = makeRequestOnPort("/metrics", 9090);
    const metricsRes = makeResponse();
    expect(
      await handle.handleMetricsRequest(metricsReq, metricsRes as unknown as ServerResponse),
    ).toBe(true);
    expect(metricsRes._status).toBe(200);
  });

  it("startMetricsServer binds a dedicated listener on metricsPort", async () => {
    let listenedPort: number | undefined;
    const fakeServer = {
      listen(port: number, cb: () => void) {
        listenedPort = port;
        cb();
        return this;
      },
      once() {
        return this;
      },
      removeListener() {
        return this;
      },
      unref() {
        return this;
      },
      close(cb: () => void) {
        cb();
      },
    };
    const createServer = vi.fn(() => fakeServer as unknown as import("node:http").Server);
    const segCfg = {
      enterprise: { monitoring: { metricsPort: 9091 } },
    } as unknown as OpenClawConfig;
    const handle = await initMonitoring(segCfg, { createServer });
    await handle.startMetricsServer();
    expect(createServer).toHaveBeenCalledTimes(1);
    expect(listenedPort).toBe(9091);
    // Idempotent: a second call does not bind again.
    await handle.startMetricsServer();
    expect(createServer).toHaveBeenCalledTimes(1);
    await handle.shutdown();
  });

  it("startMetricsServer is a no-op when no metricsPort is configured", async () => {
    const createServer = vi.fn(() => ({}) as unknown as import("node:http").Server);
    const handle = await initMonitoring(cfg, { createServer });
    await handle.startMetricsServer();
    expect(createServer).not.toHaveBeenCalled();
  });
});

describe("shutdown", () => {
  it("resolves without error", async () => {
    const handle = await initMonitoring(cfg);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
