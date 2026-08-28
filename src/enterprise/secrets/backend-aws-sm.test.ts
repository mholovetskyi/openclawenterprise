import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must use vi.hoisted so variables are available inside
// the vi.mock factory (which is also hoisted before imports).
// ---------------------------------------------------------------------------
const { mockSend, mockDestroy } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockDestroy: vi.fn(),
}));

// Use class/function constructors — vi.fn(() => ...) triggers a Vitest v4
// error when called with `new` (arrow functions cannot be constructors).
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mockSend;
    destroy = mockDestroy;
    constructor(_opts: unknown) {}
  },
  // Command classes expose their constructor args as own properties
  GetSecretValueCommand: function GetSecretValueCommand(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, { _cmd: "GetSecretValue", ...args });
  },
  CreateSecretCommand: function CreateSecretCommand(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, { _cmd: "CreateSecret", ...args });
  },
  UpdateSecretCommand: function UpdateSecretCommand(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, { _cmd: "UpdateSecret", ...args });
  },
  DeleteSecretCommand: function DeleteSecretCommand(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, { _cmd: "DeleteSecret", ...args });
  },
  ListSecretsCommand: function ListSecretsCommand(
    this: Record<string, unknown>,
    args: Record<string, unknown>,
  ) {
    Object.assign(this, { _cmd: "ListSecrets", ...args });
  },
}));

import { createAwsSmBackend } from "./backend-aws-sm.js";

const OPTS = { region: "us-east-1", prefix: "openclaw/" };

function notFound(): Error {
  return Object.assign(new Error("ResourceNotFoundException"), {
    name: "ResourceNotFoundException",
  });
}

describe("createAwsSmBackend", () => {
  let backend: ReturnType<typeof createAwsSmBackend>;

  beforeEach(() => {
    mockSend.mockReset();
    mockDestroy.mockReset();
    backend = createAwsSmBackend(OPTS);
  });

  it("name is 'aws-sm'", () => {
    expect(backend.name).toBe("aws-sm");
  });

  // ── get ──────────────────────────────────────────────────────────────────

  it("get — returns SecretString on success", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "my-value" });
    expect(await backend.get("my-key")).toBe("my-value");
  });

  it("get — returns null when SecretString is absent", async () => {
    mockSend.mockResolvedValueOnce({});
    expect(await backend.get("my-key")).toBeNull();
  });

  it("get — returns null on ResourceNotFoundException", async () => {
    mockSend.mockRejectedValueOnce(notFound());
    expect(await backend.get("missing")).toBeNull();
  });

  it("get — re-throws unknown errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("network failure"));
    await expect(backend.get("key")).rejects.toThrow("network failure");
  });

  it("get — uses prefixed secret id", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "v" });
    await backend.get("sub/key");
    const cmd = mockSend.mock.calls[0]![0] as { SecretId?: string };
    expect(cmd.SecretId).toBe("openclaw/sub/key");
  });

  // ── set ──────────────────────────────────────────────────────────────────

  it("set — updates existing secret via UpdateSecretCommand", async () => {
    mockSend.mockResolvedValueOnce({});
    await backend.set("my-key", "value");
    const cmd = mockSend.mock.calls[0]![0] as {
      _cmd: string;
      SecretId: string;
      SecretString: string;
    };
    expect(cmd._cmd).toBe("UpdateSecret");
    expect(cmd.SecretId).toBe("openclaw/my-key");
    expect(cmd.SecretString).toBe("value");
  });

  it("set — creates new secret when Update throws ResourceNotFoundException", async () => {
    mockSend.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({});
    await backend.set("new-key", "value");
    const createCmd = mockSend.mock.calls[1]![0] as { _cmd: string; Name: string };
    expect(createCmd._cmd).toBe("CreateSecret");
    expect(createCmd.Name).toBe("openclaw/new-key");
  });

  it("set — passes description from metadata on create", async () => {
    mockSend.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({});
    await backend.set("key", "val", { description: "my desc" });
    const createCmd = mockSend.mock.calls[1]![0] as { Description?: string };
    expect(createCmd.Description).toBe("my desc");
  });

  it("set — re-throws non-ResourceNotFoundException from Update", async () => {
    mockSend.mockRejectedValueOnce(new Error("access denied"));
    await expect(backend.set("key", "val")).rejects.toThrow("access denied");
  });

  // ── delete ───────────────────────────────────────────────────────────────

  it("delete — sends DeleteSecretCommand with ForceDeleteWithoutRecovery", async () => {
    mockSend.mockResolvedValueOnce({});
    await backend.delete("my-key");
    const cmd = mockSend.mock.calls[0]![0] as {
      _cmd: string;
      SecretId: string;
      ForceDeleteWithoutRecovery: boolean;
    };
    expect(cmd._cmd).toBe("DeleteSecret");
    expect(cmd.SecretId).toBe("openclaw/my-key");
    expect(cmd.ForceDeleteWithoutRecovery).toBe(true);
  });

  it("delete — treats ResourceNotFoundException as no-op", async () => {
    mockSend.mockRejectedValueOnce(notFound());
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("delete — re-throws other errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("permission denied"));
    await expect(backend.delete("key")).rejects.toThrow("permission denied");
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it("list — returns keys with prefix stripped", async () => {
    mockSend.mockResolvedValueOnce({
      SecretList: [{ Name: "openclaw/key-a" }, { Name: "openclaw/key-b" }],
    });
    const keys = await backend.list();
    expect(keys).toEqual(["key-a", "key-b"]);
  });

  it("list — handles paginated results via NextToken", async () => {
    mockSend
      .mockResolvedValueOnce({
        SecretList: [{ Name: "openclaw/key-a" }],
        NextToken: "page2",
      })
      .mockResolvedValueOnce({
        SecretList: [{ Name: "openclaw/key-b" }],
      });
    const keys = await backend.list();
    expect(keys).toEqual(["key-a", "key-b"]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("list — returns empty array when SecretList is empty", async () => {
    mockSend.mockResolvedValueOnce({ SecretList: [] });
    expect(await backend.list()).toEqual([]);
  });

  it("list — skips entries without a Name", async () => {
    mockSend.mockResolvedValueOnce({
      SecretList: [{ Name: "openclaw/key-a" }, {}],
    });
    expect(await backend.list()).toEqual(["key-a"]);
  });

  // ── exists ───────────────────────────────────────────────────────────────

  it("exists — returns true when get returns a value", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "v" });
    expect(await backend.exists("key")).toBe(true);
  });

  it("exists — returns false when get returns null", async () => {
    mockSend.mockRejectedValueOnce(notFound());
    expect(await backend.exists("key")).toBe(false);
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  it("shutdown — calls destroy on the client and nulls it", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "v" });
    await backend.get("key"); // prime the client
    await backend.shutdown();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("shutdown — resolves even if no request was ever made", async () => {
    await expect(backend.shutdown()).resolves.toBeUndefined();
  });
});
