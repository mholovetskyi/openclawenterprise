import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

// ---------------------------------------------------------------------------
// Hoisted mock state for @google-cloud/secret-manager
// ---------------------------------------------------------------------------
const mockGCPClient = vi.hoisted(() => ({
  accessSecretVersion: vi.fn(),
  createSecret: vi.fn(),
  addSecretVersion: vi.fn(),
  deleteSecret: vi.fn(),
  listSecretsAsync: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
}));

// Use class syntax — vi.fn(() => ...) throws in Vitest v4 when used with `new`
vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = mockGCPClient.accessSecretVersion;
    createSecret = mockGCPClient.createSecret;
    addSecretVersion = mockGCPClient.addSecretVersion;
    deleteSecret = mockGCPClient.deleteSecret;
    listSecretsAsync = mockGCPClient.listSecretsAsync;
    close = mockGCPClient.close;
    constructor() {}
  },
}));

import { createGCPSecretManagerBackend } from "./backend-gcp-sm.js";

function makeCfg(overrides?: object): OpenClawConfig {
  return {
    enterprise: {
      secrets: {
        gcpSm: { projectId: "my-project", prefix: "openclaw/", ...overrides },
      },
    },
  } as unknown as OpenClawConfig;
}

/** gRPC NOT_FOUND status code */
function notFound(): Error {
  return Object.assign(new Error("NOT_FOUND"), { code: 5 });
}

/** gRPC ALREADY_EXISTS status code */
function alreadyExists(): Error {
  return Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
}

/** Async iterable helper */
async function* asyncOf<T>(...items: T[]): AsyncIterable<T> {
  yield* items;
}

describe("createGCPSecretManagerBackend — factory validation", () => {
  it("throws when projectId is missing", async () => {
    const cfg = { enterprise: { secrets: { gcpSm: {} } } } as unknown as OpenClawConfig;
    await expect(createGCPSecretManagerBackend(cfg)).rejects.toThrow("projectId is required");
  });

  it("throws when gcpSm config block is absent", async () => {
    const cfg = { enterprise: { secrets: {} } } as unknown as OpenClawConfig;
    await expect(createGCPSecretManagerBackend(cfg)).rejects.toThrow("projectId is required");
  });
});

describe("createGCPSecretManagerBackend — operations", () => {
  let backend: Awaited<ReturnType<typeof createGCPSecretManagerBackend>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGCPClient.close.mockResolvedValue(undefined);
    backend = await createGCPSecretManagerBackend(makeCfg());
  });

  it("name is 'gcp-sm'", () => {
    expect(backend.name).toBe("gcp-sm");
  });

  // ── get ──────────────────────────────────────────────────────────────────

  it("get — returns value from Buffer payload", async () => {
    mockGCPClient.accessSecretVersion.mockResolvedValueOnce([
      { payload: { data: Buffer.from("secret-value", "utf8") } },
    ]);
    expect(await backend.get("my-key")).toBe("secret-value");
  });

  it("get — returns value from string payload", async () => {
    mockGCPClient.accessSecretVersion.mockResolvedValueOnce([
      { payload: { data: "string-value" } },
    ]);
    expect(await backend.get("my-key")).toBe("string-value");
  });

  it("get — returns null on NOT_FOUND (gRPC code 5)", async () => {
    mockGCPClient.accessSecretVersion.mockRejectedValueOnce(notFound());
    expect(await backend.get("missing")).toBeNull();
  });

  it("get — returns null when payload data is absent", async () => {
    mockGCPClient.accessSecretVersion.mockResolvedValueOnce([{ payload: {} }]);
    expect(await backend.get("key")).toBeNull();
  });

  it("get — re-throws non-NOT_FOUND errors", async () => {
    mockGCPClient.accessSecretVersion.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(backend.get("key")).rejects.toThrow("quota exceeded");
  });

  it("get — builds correct version resource name", async () => {
    mockGCPClient.accessSecretVersion.mockResolvedValueOnce([
      { payload: { data: Buffer.from("v") } },
    ]);
    await backend.get("my-key");
    const call = mockGCPClient.accessSecretVersion.mock.calls[0]![0] as { name: string };
    expect(call.name).toContain("projects/my-project/secrets/");
    expect(call.name).toContain("/versions/latest");
  });

  // ── set ──────────────────────────────────────────────────────────────────

  it("set — creates secret then adds version", async () => {
    mockGCPClient.createSecret.mockResolvedValueOnce([{}]);
    mockGCPClient.addSecretVersion.mockResolvedValueOnce([{}]);
    await backend.set("new-key", "value");
    expect(mockGCPClient.createSecret).toHaveBeenCalledTimes(1);
    expect(mockGCPClient.addSecretVersion).toHaveBeenCalledTimes(1);
    const addCall = mockGCPClient.addSecretVersion.mock.calls[0]![0] as {
      payload: { data: Buffer };
    };
    expect(Buffer.from(addCall.payload.data).toString("utf8")).toBe("value");
  });

  it("set — skips create when secret already exists (code 6)", async () => {
    mockGCPClient.createSecret.mockRejectedValueOnce(alreadyExists());
    mockGCPClient.addSecretVersion.mockResolvedValueOnce([{}]);
    await expect(backend.set("existing-key", "value")).resolves.toBeUndefined();
    expect(mockGCPClient.addSecretVersion).toHaveBeenCalledTimes(1);
  });

  it("set — re-throws create errors that are not ALREADY_EXISTS", async () => {
    mockGCPClient.createSecret.mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { code: 7 }),
    );
    await expect(backend.set("key", "val")).rejects.toThrow("permission denied");
  });

  // ── delete ───────────────────────────────────────────────────────────────

  it("delete — deletes the secret by resource name", async () => {
    mockGCPClient.deleteSecret.mockResolvedValueOnce([{}]);
    await backend.delete("my-key");
    const call = mockGCPClient.deleteSecret.mock.calls[0]![0] as { name: string };
    expect(call.name).toContain("projects/my-project/secrets/");
  });

  it("delete — treats NOT_FOUND as no-op", async () => {
    mockGCPClient.deleteSecret.mockRejectedValueOnce(notFound());
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("delete — re-throws other errors", async () => {
    mockGCPClient.deleteSecret.mockRejectedValueOnce(new Error("permission denied"));
    await expect(backend.delete("key")).rejects.toThrow("permission denied");
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it("list — returns keys with GCP encoding and prefix stripped", async () => {
    // encodeSecretId("openclaw/key-a") = "openclaw_x2f_key-a"
    mockGCPClient.listSecretsAsync.mockReturnValueOnce(
      asyncOf(
        { name: "projects/my-project/secrets/openclaw_x2f_key-a" },
        { name: "projects/my-project/secrets/openclaw_x2f_key-b" },
      ),
    );
    const keys = await backend.list();
    expect(keys).toEqual(["key-a", "key-b"]);
  });

  it("list — returns empty array when no secrets exist", async () => {
    mockGCPClient.listSecretsAsync.mockReturnValueOnce(asyncOf());
    expect(await backend.list()).toEqual([]);
  });

  it("list — skips entries without a name", async () => {
    mockGCPClient.listSecretsAsync.mockReturnValueOnce(
      asyncOf({ name: "projects/my-project/secrets/openclaw_x2f_key-a" }, {}),
    );
    expect(await backend.list()).toEqual(["key-a"]);
  });

  // ── exists ───────────────────────────────────────────────────────────────

  it("exists — returns true when accessSecretVersion succeeds", async () => {
    mockGCPClient.accessSecretVersion.mockResolvedValueOnce([
      { payload: { data: Buffer.from("x") } },
    ]);
    expect(await backend.exists("key")).toBe(true);
  });

  it("exists — returns false on NOT_FOUND", async () => {
    mockGCPClient.accessSecretVersion.mockRejectedValueOnce(notFound());
    expect(await backend.exists("key")).toBe(false);
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  it("shutdown — calls client.close()", async () => {
    await backend.shutdown();
    expect(mockGCPClient.close).toHaveBeenCalledTimes(1);
  });
});

describe("createGCPSecretManagerBackend — no prefix", () => {
  it("list works without a prefix configured", async () => {
    vi.clearAllMocks();
    mockGCPClient.close.mockResolvedValue(undefined);
    const cfg = {
      enterprise: { secrets: { gcpSm: { projectId: "proj" } } },
    } as unknown as OpenClawConfig;
    const b = await createGCPSecretManagerBackend(cfg);
    mockGCPClient.listSecretsAsync.mockReturnValueOnce(
      asyncOf({ name: "projects/proj/secrets/my-secret" }),
    );
    const keys = await b.list();
    expect(keys).toEqual(["my-secret"]);
  });
});
