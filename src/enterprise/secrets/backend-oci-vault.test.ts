import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOciVaultBackend, type OciVaultBackendOptions } from "./backend-oci-vault.js";

// ── Mock OCI clients ────────────────────────────────────────────────────────────

function makeMockClients() {
  return {
    vaultsClient: {
      createSecret: vi.fn(),
      updateSecret: vi.fn(),
      scheduleSecretDeletion: vi.fn(),
      listSecrets: vi.fn(),
      getSecret: vi.fn(),
    },
    secretsClient: {
      getSecretBundle: vi.fn(),
    },
  };
}

const OPTS: OciVaultBackendOptions = {
  tenancyId: "ocid1.tenancy.oc1..aaa",
  userId: "ocid1.user.oc1..bbb",
  fingerprint: "aa:bb:cc",
  privateKey: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
  region: "us-ashburn-1",
  compartmentId: "ocid1.compartment.oc1..ccc",
  vaultId: "ocid1.vault.oc1.iad.ddd",
  keyId: "ocid1.key.oc1.iad.eee",
  prefix: "openclaw/",
};

function serviceError(statusCode: number, serviceCode: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, serviceCode });
}

describe("createOciVaultBackend", () => {
  let mocks: ReturnType<typeof makeMockClients>;
  let backend: ReturnType<typeof createOciVaultBackend>;

  beforeEach(() => {
    mocks = makeMockClients();
    backend = createOciVaultBackend(OPTS, {
      vaultsClient: mocks.vaultsClient,
      secretsClient: mocks.secretsClient,
    });
  });

  it("name is 'oci-vault'", () => {
    expect(backend.name).toBe("oci-vault");
  });

  // ── get ──────────────────────────────────────────────────────────────────

  it("get — returns decoded secret value on success", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/my-key", id: "ocid1.secret.xxx", lifecycleState: "ACTIVE" }],
    });
    mocks.secretsClient.getSecretBundle.mockResolvedValueOnce({
      secretBundle: {
        secretBundleContent: {
          content: Buffer.from("my-value").toString("base64"),
          contentType: "BASE64",
        },
      },
    });

    expect(await backend.get("my-key")).toBe("my-value");
  });

  it("get — returns null when secret not found in list", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({ items: [] });
    expect(await backend.get("missing")).toBeNull();
  });

  it("get — returns null on 404 from getSecretBundle", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/key", id: "ocid1.secret.xxx", lifecycleState: "ACTIVE" }],
    });
    mocks.secretsClient.getSecretBundle.mockRejectedValueOnce(
      serviceError(404, "SecretNotFound", "not found"),
    );
    expect(await backend.get("key")).toBeNull();
  });

  it("get — uses OCID directly without prefix when ref starts with ocid1.", async () => {
    const ocid = "ocid1.vaultsecret.oc1.iad.abc123";
    mocks.secretsClient.getSecretBundle.mockResolvedValueOnce({
      secretBundle: {
        secretBundleContent: {
          content: Buffer.from("secret-val").toString("base64"),
          contentType: "BASE64",
        },
      },
    });

    expect(await backend.get(ocid)).toBe("secret-val");
    expect(mocks.secretsClient.getSecretBundle).toHaveBeenCalledWith({ secretId: ocid });
    expect(mocks.vaultsClient.listSecrets).not.toHaveBeenCalled();
  });

  it("get — base64 decodes secret content", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/b64", id: "ocid1.secret.xxx", lifecycleState: "ACTIVE" }],
    });
    const jsonValue = JSON.stringify({ key: "value" });
    mocks.secretsClient.getSecretBundle.mockResolvedValueOnce({
      secretBundle: {
        secretBundleContent: {
          content: Buffer.from(jsonValue).toString("base64"),
          contentType: "BASE64",
        },
      },
    });

    expect(await backend.get("b64")).toBe(jsonValue);
  });

  it("get — throws SecretBackendError on 403", async () => {
    mocks.vaultsClient.listSecrets.mockRejectedValueOnce(
      serviceError(403, "NotAuthenticated", "access denied"),
    );
    await expect(backend.get("key")).rejects.toThrow("OCI permission denied");
  });

  // ── set ──────────────────────────────────────────────────────────────────

  it("set — creates a new secret", async () => {
    mocks.vaultsClient.createSecret.mockResolvedValueOnce({
      secret: { id: "ocid1.secret.new" },
    });
    await backend.set("new-key", "new-value");
    expect(mocks.vaultsClient.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        createSecretDetails: expect.objectContaining({
          secretName: "openclaw/new-key",
          compartmentId: OPTS.compartmentId,
          vaultId: OPTS.vaultId,
        }),
      }),
    );
  });

  it("set — updates existing secret when create returns 409", async () => {
    mocks.vaultsClient.createSecret.mockRejectedValueOnce(
      serviceError(409, "SecretAlreadyExists", "already exists"),
    );
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/existing", id: "ocid1.secret.xxx" }],
    });
    mocks.vaultsClient.updateSecret.mockResolvedValueOnce({});

    await backend.set("existing", "updated-value");
    expect(mocks.vaultsClient.updateSecret).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "ocid1.secret.xxx" }),
    );
  });

  it("set — passes description from metadata", async () => {
    mocks.vaultsClient.createSecret.mockResolvedValueOnce({
      secret: { id: "ocid1.secret.new" },
    });
    await backend.set("key", "val", { description: "test desc" });
    const call = mocks.vaultsClient.createSecret.mock.calls[0]![0] as Record<string, unknown>;
    const details = call.createSecretDetails as Record<string, unknown>;
    expect(details.description).toBe("test desc");
  });

  it("set — re-throws non-409 errors", async () => {
    mocks.vaultsClient.createSecret.mockRejectedValueOnce(
      serviceError(500, "InternalError", "server error"),
    );
    await expect(backend.set("key", "val")).rejects.toThrow("OCI Vault error");
  });

  // ── delete ───────────────────────────────────────────────────────────────

  it("delete — schedules secret for deletion", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/del-key", id: "ocid1.secret.del" }],
    });
    mocks.vaultsClient.scheduleSecretDeletion.mockResolvedValueOnce({});

    await backend.delete("del-key");
    expect(mocks.vaultsClient.scheduleSecretDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "ocid1.secret.del" }),
    );
  });

  it("delete — treats missing secret as no-op", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({ items: [] });
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("delete — treats 404 during deletion as no-op", async () => {
    mocks.vaultsClient.listSecrets.mockRejectedValueOnce(
      serviceError(404, "NotFound", "not found"),
    );
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it("list — returns secret names with prefix stripped", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [
        { secretName: "openclaw/key-a", id: "a", lifecycleState: "ACTIVE" },
        { secretName: "openclaw/key-b", id: "b", lifecycleState: "ACTIVE" },
      ],
    });
    expect(await backend.list()).toEqual(["key-a", "key-b"]);
  });

  it("list — handles paginated results", async () => {
    mocks.vaultsClient.listSecrets
      .mockResolvedValueOnce({
        items: [{ secretName: "openclaw/key-a", id: "a", lifecycleState: "ACTIVE" }],
        opcNextPage: "page2",
      })
      .mockResolvedValueOnce({
        items: [{ secretName: "openclaw/key-b", id: "b", lifecycleState: "ACTIVE" }],
      });

    expect(await backend.list()).toEqual(["key-a", "key-b"]);
    expect(mocks.vaultsClient.listSecrets).toHaveBeenCalledTimes(2);
  });

  it("list — filters out non-ACTIVE secrets", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [
        { secretName: "openclaw/active", id: "a", lifecycleState: "ACTIVE" },
        { secretName: "openclaw/deleting", id: "b", lifecycleState: "DELETING" },
      ],
    });
    expect(await backend.list()).toEqual(["active"]);
  });

  it("list — filters out secrets without the prefix", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [
        { secretName: "openclaw/mine", id: "a", lifecycleState: "ACTIVE" },
        { secretName: "other/foreign", id: "b", lifecycleState: "ACTIVE" },
      ],
    });
    expect(await backend.list()).toEqual(["mine"]);
  });

  // ── exists ───────────────────────────────────────────────────────────────

  it("exists — returns true when secret found", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/key", id: "ocid1.secret.xxx", lifecycleState: "ACTIVE" }],
    });
    mocks.secretsClient.getSecretBundle.mockResolvedValueOnce({
      secretBundle: {
        secretBundleContent: {
          content: Buffer.from("v").toString("base64"),
          contentType: "BASE64",
        },
      },
    });
    expect(await backend.exists("key")).toBe(true);
  });

  it("exists — returns false when secret not found", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({ items: [] });
    expect(await backend.exists("missing")).toBe(false);
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  it("shutdown — resolves cleanly", async () => {
    await expect(backend.shutdown()).resolves.toBeUndefined();
  });

  // ── error mapping ────────────────────────────────────────────────────────

  it("maps 401 to permission error", async () => {
    mocks.vaultsClient.listSecrets.mockRejectedValueOnce(
      serviceError(401, "NotAuthenticated", "invalid credentials"),
    );
    await expect(backend.get("key")).rejects.toThrow("OCI permission denied");
  });

  it("maps 429 to backend error with code", async () => {
    mocks.vaultsClient.listSecrets.mockRejectedValueOnce(
      serviceError(429, "TooManyRequests", "rate limited"),
    );
    await expect(backend.get("key")).rejects.toThrow("OCI Vault error");
  });

  // ── missing oci-sdk ──────────────────────────────────────────────────────

  it("throws clear error when oci-sdk is not installed", async () => {
    const backend = createOciVaultBackend(OPTS, {
      sdkLoader: async () => {
        throw new Error("Cannot find module 'oci-sdk'");
      },
    });
    await expect(backend.get("key")).rejects.toThrow("Cannot find module 'oci-sdk'");
  });

  // ── prefix handling ──────────────────────────────────────────────────────

  it("resolves prefix-shorthand: oci-vault://my-secret -> openclaw/my-secret", async () => {
    mocks.vaultsClient.listSecrets.mockResolvedValueOnce({
      items: [{ secretName: "openclaw/my-secret", id: "s1", lifecycleState: "ACTIVE" }],
    });
    mocks.secretsClient.getSecretBundle.mockResolvedValueOnce({
      secretBundle: {
        secretBundleContent: {
          content: Buffer.from("val").toString("base64"),
          contentType: "BASE64",
        },
      },
    });

    await backend.get("my-secret");
    const listCall = mocks.vaultsClient.listSecrets.mock.calls[0]![0] as Record<string, unknown>;
    expect(listCall.name).toBe("openclaw/my-secret");
  });
});
