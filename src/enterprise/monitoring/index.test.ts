import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { initMonitoring } from "./index.js";
import type { OpenClawConfig } from "../../config/config.js";

// Mock the metrics module to avoid real Prometheus registry setup
vi.mock("./metrics.js", () => ({
  initMetricsRegistry: vi.fn(async () => {}),
  getMetricsOutput: vi.fn(async () => "# mock prometheus output\n"),
  rebuildMetrics: vi.fn(() => {}),
}));

function makeRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function makeResponse(): ServerResponse & { _body: string; _status: number; _headers: Record<string, string> } {
  const res = {
    _body: "",
    _status: 0,
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      this._status = status;
      if (headers) {Object.assign(this._headers, headers);}
    },
    end(body?: string) {
      this._body = body ?? "";
    },
  };
  return res as unknown as ServerResponse & { _body: string; _status: number; _headers: Record<string, string> };
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
});

describe("shutdown", () => {
  it("resolves without error", async () => {
    const handle = await initMonitoring(cfg);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
