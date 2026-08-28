import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVaultBackend } from "./backend-vault.js";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const BASE = {
  address: "http://vault:8200",
  token: "test-token",
  mount: "secret",
  prefix: "openclaw/",
};

describe("createVaultBackend — token auth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let backend: ReturnType<typeof createVaultBackend>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    backend = createVaultBackend(BASE);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("name is 'vault'", () => {
    expect(backend.name).toBe("vault");
  });

  it("get — returns value on success", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "s3cret" } } }));
    expect(await backend.get("my-key")).toBe("s3cret");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://vault:8200/v1/secret/data/openclaw/my-key",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("get — returns null on 404", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, {}));
    expect(await backend.get("missing")).toBeNull();
  });

  it("get — throws on non-404 error", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, {}));
    await expect(backend.get("key")).rejects.toThrow("HTTP 500");
  });

  it("get — returns null when the KV map is empty", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: {} } }));
    expect(await backend.get("key")).toBeNull();
  });

  it("get — returns the full KV map as JSON for multi-field secrets", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, { data: { data: { api_key: "sk-123", org: "acme" } } }),
    );
    const raw = await backend.get("openai");
    // Multi-field secrets are returned as JSON so resolveSecretValue's
    // `#field` extraction can index them (the documented vault://path#field).
    expect(JSON.parse(raw as string)).toEqual({ api_key: "sk-123", org: "acme" });
  });

  it("get — returns the full map as JSON for a single non-'value' field", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: { api_key: "sk-only" } } }));
    const raw = await backend.get("openai");
    expect(JSON.parse(raw as string)).toEqual({ api_key: "sk-only" });
  });

  it("set — posts JSON body to KV v2 data path", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, {}));
    await backend.set("my-key", "val");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://vault:8200/v1/secret/data/openclaw/my-key");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ data: { value: "val" } }));
  });

  it("set — throws on error response", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(403, {}));
    await expect(backend.set("key", "val")).rejects.toThrow("HTTP 403");
  });

  it("delete — sends DELETE to data path", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, {}));
    await backend.delete("my-key");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://vault:8200/v1/secret/data/openclaw/my-key",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("delete — treats 404 as no-op", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, {}));
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("delete — throws on non-404 error", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, {}));
    await expect(backend.delete("key")).rejects.toThrow("HTTP 500");
  });

  it("list — returns keys prefixed correctly", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { keys: ["key-a", "key-b"] } }));
    const keys = await backend.list();
    expect(keys).toContain("openclaw/key-a");
    expect(keys).toContain("openclaw/key-b");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/metadata/");
    expect(url).toContain("?list=true");
  });

  it("list — returns empty array on 404", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, {}));
    expect(await backend.list()).toEqual([]);
  });

  it("list — returns empty array on server error", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, {}));
    expect(await backend.list()).toEqual([]);
  });

  it("exists — returns true on 200 OK", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "x" } } }));
    expect(await backend.exists("key")).toBe(true);
  });

  it("exists — returns false on 404", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, {}));
    expect(await backend.exists("key")).toBe(false);
  });

  it("sends X-Vault-Token on every request", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "x" } } }));
    await backend.get("key");
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers["X-Vault-Token"]).toBe("test-token");
  });

  it("sends X-Vault-Namespace when namespace is configured", async () => {
    const nsBackend = createVaultBackend({
      ...BASE,
      namespace: "my-ns",
    });
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "x" } } }));
    await nsBackend.get("key");
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers["X-Vault-Namespace"]).toBe("my-ns");
  });

  it("does not send X-Vault-Namespace when not configured", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "x" } } }));
    await backend.get("key");
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers["X-Vault-Namespace"]).toBeUndefined();
  });

  it("shutdown resolves without error", async () => {
    await expect(backend.shutdown()).resolves.toBeUndefined();
  });
});

describe("createVaultBackend — AppRole auth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("logs in via AppRole and uses the returned client_token", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { auth: { client_token: "dynamic-tok" } }))
      .mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "val" } } }));

    const backend = createVaultBackend({
      address: "http://vault:8200",
      appRole: { roleId: "role-123", secretId: "secret-456" },
    });

    const result = await backend.get("key");
    expect(result).toBe("val");
    expect(fetchMock.mock.calls[0]![0]).toContain("approle/login");
    const init = fetchMock.mock.calls[1]![1] as { headers: Record<string, string> };
    expect(init.headers["X-Vault-Token"]).toBe("dynamic-tok");
  });

  it("caches the token across subsequent requests", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { auth: { client_token: "tok" } }))
      .mockResolvedValue(fakeResponse(200, { data: { data: { value: "v" } } }));

    const backend = createVaultBackend({
      address: "http://vault:8200",
      appRole: { roleId: "r", secretId: "s" },
    });

    await backend.get("key");
    await backend.get("key");
    // Only one AppRole login call despite two requests
    const loginCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("approle/login"),
    );
    expect(loginCalls).toHaveLength(1);
  });

  it("throws when AppRole login returns HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(403, {}));
    const backend = createVaultBackend({
      address: "http://vault:8200",
      appRole: { roleId: "bad", secretId: "bad" },
    });
    await expect(backend.get("key")).rejects.toThrow("AppRole login failed");
  });

  it("throws when AppRole login response has no client_token", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { auth: {} }));
    const backend = createVaultBackend({
      address: "http://vault:8200",
      appRole: { roleId: "r", secretId: "s" },
    });
    await expect(backend.get("key")).rejects.toThrow("no client_token");
  });
});

describe("createVaultBackend — Kubernetes auth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let tmpDir: string;
  let tokenPath: string;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-k8s-"));
    tokenPath = path.join(tmpDir, "sa-token");
    fs.writeFileSync(tokenPath, "jwt-token\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("reads the custom SA token path and logs in at the custom mount path", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { auth: { client_token: "k8s-tok" } }))
      .mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "v" } } }));

    const backend = createVaultBackend({
      address: "http://vault:8200",
      k8sAuth: { role: "my-role", jwtPath: tokenPath, mountPath: "k8s-prod" },
    });

    expect(await backend.get("key")).toBe("v");
    // Login hits the custom mount path, not the hardcoded "kubernetes",
    // and carries the JWT read from the custom SA token path.
    expect(fetchMock.mock.calls[0]![0]).toBe("http://vault:8200/v1/auth/k8s-prod/login");
    const loginInit = fetchMock.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(loginInit.body)).toEqual({ role: "my-role", jwt: "jwt-token" });
    const getInit = fetchMock.mock.calls[1]![1] as { headers: Record<string, string> };
    expect(getInit.headers["X-Vault-Token"]).toBe("k8s-tok");
  });

  it("defaults the mount path to 'kubernetes' when mountPath is unset", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, { auth: { client_token: "k8s-tok" } }))
      .mockResolvedValueOnce(fakeResponse(200, { data: { data: { value: "v" } } }));

    const backend = createVaultBackend({
      address: "http://vault:8200",
      authMethod: "kubernetes",
      k8sAuth: { role: "r", jwtPath: tokenPath },
    });

    await backend.get("key");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://vault:8200/v1/auth/kubernetes/login");
  });
});

describe("createVaultBackend — no auth configured", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws when no token, appRole, or k8sAuth is provided", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const backend = createVaultBackend({ address: "http://vault:8200" });
    await expect(backend.get("key")).rejects.toThrow("no authentication method");
  });
});
