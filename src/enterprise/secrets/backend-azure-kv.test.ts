import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

// ---------------------------------------------------------------------------
// Hoisted mock state for @azure/keyvault-secrets and @azure/identity
// ---------------------------------------------------------------------------
const mockAzureClient = vi.hoisted(() => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  beginDeleteSecret: vi.fn(),
  listPropertiesOfSecrets: vi.fn(),
}));

// Use class syntax — vi.fn(() => ...) throws in Vitest v4 when used with `new`
vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: class {
    getSecret = mockAzureClient.getSecret;
    setSecret = mockAzureClient.setSecret;
    beginDeleteSecret = mockAzureClient.beginDeleteSecret;
    listPropertiesOfSecrets = mockAzureClient.listPropertiesOfSecrets;
    constructor(_vaultUrl: unknown, _credential: unknown) {}
  },
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    constructor() {}
  },
}));

import { createAzureKeyVaultBackend } from "./backend-azure-kv.js";

function makeCfg(overrides?: object): OpenClawConfig {
  return {
    enterprise: {
      secrets: {
        azureKv: {
          vaultUrl: "https://my-vault.vault.azure.net",
          prefix: "openclaw-",
          ...overrides,
        },
      },
    },
  } as unknown as OpenClawConfig;
}

/** Simulate Azure "not found" via statusCode */
function notFound(): Error {
  return Object.assign(new Error("SecretNotFound"), { statusCode: 404 });
}

/** Simulate Azure "not found" via code property */
function notFoundByCode(): Error {
  return Object.assign(new Error("SecretNotFound"), { code: "SecretNotFound" });
}

/** Async iterable helper */
async function* asyncOf<T>(...items: T[]): AsyncIterable<T> {
  yield* items;
}

describe("createAzureKeyVaultBackend — factory validation", () => {
  it("throws when vaultUrl is missing", async () => {
    const cfg = {
      enterprise: { secrets: { azureKv: {} } },
    } as unknown as OpenClawConfig;
    await expect(createAzureKeyVaultBackend(cfg)).rejects.toThrow("vaultUrl is required");
  });

  it("throws when azureKv config block is absent", async () => {
    const cfg = { enterprise: { secrets: {} } } as unknown as OpenClawConfig;
    await expect(createAzureKeyVaultBackend(cfg)).rejects.toThrow("vaultUrl is required");
  });
});

describe("createAzureKeyVaultBackend — operations", () => {
  let backend: Awaited<ReturnType<typeof createAzureKeyVaultBackend>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    backend = await createAzureKeyVaultBackend(makeCfg());
  });

  it("name is 'azure-kv'", () => {
    expect(backend.name).toBe("azure-kv");
  });

  // ── get ──────────────────────────────────────────────────────────────────

  it("get — returns secret value on success", async () => {
    mockAzureClient.getSecret.mockResolvedValueOnce({ value: "s3cret" });
    expect(await backend.get("my-key")).toBe("s3cret");
  });

  it("get — returns null when value is undefined", async () => {
    mockAzureClient.getSecret.mockResolvedValueOnce({ value: undefined });
    expect(await backend.get("my-key")).toBeNull();
  });

  it("get — returns null on statusCode 404", async () => {
    mockAzureClient.getSecret.mockRejectedValueOnce(notFound());
    expect(await backend.get("missing")).toBeNull();
  });

  it("get — returns null on SecretNotFound code", async () => {
    mockAzureClient.getSecret.mockRejectedValueOnce(notFoundByCode());
    expect(await backend.get("missing")).toBeNull();
  });

  it("get — re-throws other errors", async () => {
    mockAzureClient.getSecret.mockRejectedValueOnce(new Error("throttled"));
    await expect(backend.get("key")).rejects.toThrow("throttled");
  });

  it("get — encodes special chars in key name (slash → --2f-)", async () => {
    mockAzureClient.getSecret.mockResolvedValueOnce({ value: "v" });
    await backend.get("sub/key");
    // prefix "openclaw-" + "sub/key" → encodeAzureName encodes "/" as "--2f-"
    const azureName = mockAzureClient.getSecret.mock.calls[0]![0] as string;
    expect(azureName).toContain("--2f-");
  });

  // ── set ──────────────────────────────────────────────────────────────────

  it("set — calls setSecret with encoded name and value", async () => {
    mockAzureClient.setSecret.mockResolvedValueOnce({});
    await backend.set("my-key", "my-value");
    expect(mockAzureClient.setSecret).toHaveBeenCalledWith(
      "openclaw-my-key",
      "my-value",
      expect.objectContaining({ tags: { "managed-by": "openclaw" } }),
    );
  });

  it("set — re-throws errors from setSecret", async () => {
    mockAzureClient.setSecret.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(backend.set("key", "val")).rejects.toThrow("quota exceeded");
  });

  // ── delete ───────────────────────────────────────────────────────────────

  it("delete — begins deletion and polls until done", async () => {
    const pollUntilDone = vi.fn().mockResolvedValue(undefined);
    mockAzureClient.beginDeleteSecret.mockResolvedValueOnce({ pollUntilDone });
    await backend.delete("my-key");
    expect(mockAzureClient.beginDeleteSecret).toHaveBeenCalledWith("openclaw-my-key");
    expect(pollUntilDone).toHaveBeenCalledTimes(1);
  });

  it("delete — treats statusCode 404 as no-op", async () => {
    mockAzureClient.beginDeleteSecret.mockRejectedValueOnce(notFound());
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("delete — treats SecretNotFound code as no-op", async () => {
    mockAzureClient.beginDeleteSecret.mockRejectedValueOnce(notFoundByCode());
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("delete — re-throws other errors", async () => {
    mockAzureClient.beginDeleteSecret.mockRejectedValueOnce(new Error("forbidden"));
    await expect(backend.delete("key")).rejects.toThrow("forbidden");
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it("list — returns keys with prefix stripped", async () => {
    mockAzureClient.listPropertiesOfSecrets.mockReturnValueOnce(
      asyncOf({ name: "openclaw-key-a", enabled: true }, { name: "openclaw-key-b", enabled: true }),
    );
    const keys = await backend.list();
    expect(keys).toEqual(["key-a", "key-b"]);
  });

  it("list — skips secrets with enabled === false", async () => {
    mockAzureClient.listPropertiesOfSecrets.mockReturnValueOnce(
      asyncOf(
        { name: "openclaw-active", enabled: true },
        { name: "openclaw-deleted", enabled: false },
      ),
    );
    expect(await backend.list()).toEqual(["active"]);
  });

  it("list — skips entries with no name", async () => {
    mockAzureClient.listPropertiesOfSecrets.mockReturnValueOnce(
      asyncOf({ name: "openclaw-key-a", enabled: true }, { enabled: true }),
    );
    expect(await backend.list()).toEqual(["key-a"]);
  });

  it("list — filters by keyPrefix when provided", async () => {
    mockAzureClient.listPropertiesOfSecrets.mockReturnValueOnce(
      asyncOf(
        { name: "openclaw-db-host", enabled: true },
        { name: "openclaw-api-key", enabled: true },
      ),
    );
    // The Azure implementation extends SecretBackend.list() with an optional keyPrefix filter.
    const listWithPrefix = backend.list as (keyPrefix?: string) => Promise<string[]>;
    const keys = await listWithPrefix("db-");
    expect(keys).toEqual(["db-host"]);
  });

  it("list — returns empty array when vault is empty", async () => {
    mockAzureClient.listPropertiesOfSecrets.mockReturnValueOnce(asyncOf());
    expect(await backend.list()).toEqual([]);
  });

  // ── exists ───────────────────────────────────────────────────────────────

  it("exists — returns true when getSecret succeeds", async () => {
    mockAzureClient.getSecret.mockResolvedValueOnce({ value: "x" });
    expect(await backend.exists("key")).toBe(true);
  });

  it("exists — returns false when getSecret throws 404", async () => {
    mockAzureClient.getSecret.mockRejectedValueOnce(notFound());
    expect(await backend.exists("key")).toBe(false);
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  it("shutdown — resolves without error", async () => {
    await expect(backend.shutdown()).resolves.toBeUndefined();
  });
});

describe("createAzureKeyVaultBackend — no prefix", () => {
  it("list works without a prefix configured", async () => {
    vi.clearAllMocks();
    const cfg = {
      enterprise: {
        secrets: { azureKv: { vaultUrl: "https://vault.vault.azure.net" } },
      },
    } as unknown as OpenClawConfig;
    const b = await createAzureKeyVaultBackend(cfg);
    mockAzureClient.listPropertiesOfSecrets.mockReturnValueOnce(
      asyncOf({ name: "my-secret", enabled: true }),
    );
    expect(await b.list()).toEqual(["my-secret"]);
  });
});
