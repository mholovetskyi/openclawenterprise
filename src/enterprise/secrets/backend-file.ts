/**
 * Encrypted file-based secret backend.
 * Stores secrets in ~/.openclaw/secrets.enc (AES-256-GCM).
 * Master key is stored in the OS keychain when available.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { encrypt, decrypt, type EncryptedBlob } from "./encryption.js";
import type { SecretBackend, SecretMetadata } from "./index.js";

type SecretsStore = {
  version: 1;
  secrets: Record<string, { blob: EncryptedBlob; meta: SecretMetadata }>;
};

export type FileBackendOptions = {
  storePath: string;
  key: Buffer;
};

export function createFileBackend(opts: FileBackendOptions): SecretBackend {
  const { storePath, key } = opts;

  function load(): SecretsStore {
    if (!fs.existsSync(storePath)) {
      return { version: 1, secrets: {} };
    }
    const raw = fs.readFileSync(storePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // A corrupt/truncated store must NOT be silently replaced with an empty
      // store — the next write would then clobber every intact secret. Preserve
      // the unreadable file for recovery and fail loudly instead.
      const aside = `${storePath}.corrupt.${Date.now()}`;
      try {
        fs.renameSync(storePath, aside);
      } catch {
        /* best-effort: if we cannot move it aside, still refuse to proceed */
      }
      throw new Error(
        `Secret store at ${storePath} is corrupt and could not be parsed as JSON; ` +
          `moved aside to ${aside}. Refusing to overwrite to avoid data loss.`,
        { cause: err },
      );
    }
    // SAFETY: reading two optional properties off the JSON.parse result to validate it; every field is optional so the cast asserts nothing beyond `unknown`, and the object/null guards below gate every read.
    const shape = parsed as { version?: unknown; secrets?: unknown };
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      shape.version !== 1 ||
      typeof shape.secrets !== "object" ||
      shape.secrets === null
    ) {
      const aside = `${storePath}.corrupt.${Date.now()}`;
      try {
        fs.renameSync(storePath, aside);
      } catch {
        /* best-effort */
      }
      throw new Error(
        `Secret store at ${storePath} has an unrecognized shape or version; ` +
          `moved aside to ${aside}. Refusing to overwrite to avoid data loss.`,
      );
    }
    // SAFETY: validated above — parsed is a non-null object with version === 1 and a non-null secrets object, matching the SecretsStore shape.
    return parsed as SecretsStore;
  }

  function save(store: SecretsStore): void {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${storePath}.tmp.${randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, storePath);
    try {
      fs.chmodSync(storePath, 0o600);
    } catch {
      /* non-fatal */
    }
  }

  return {
    name: "file",

    async get(ref: string): Promise<string | null> {
      const store = load();
      const entry = store.secrets[ref];
      if (!entry) return null;
      return decrypt(entry.blob, key);
    },

    async set(ref: string, value: string, meta?: SecretMetadata): Promise<void> {
      const store = load();
      store.secrets[ref] = {
        blob: encrypt(value, key),
        meta: {
          ...meta,
          createdAt: meta?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      save(store);
    },

    async delete(ref: string): Promise<void> {
      const store = load();
      delete store.secrets[ref];
      save(store);
    },

    async list(): Promise<string[]> {
      const store = load();
      return Object.keys(store.secrets);
    },

    async exists(ref: string): Promise<boolean> {
      const store = load();
      return ref in store.secrets;
    },

    async shutdown(): Promise<void> {
      // No persistent connections to close
    },
  };
}
