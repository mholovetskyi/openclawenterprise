/**
 * Encrypted file-based secret backend.
 * Stores secrets in ~/.openclaw/secrets.enc (AES-256-GCM).
 * Master key is stored in the OS keychain when available.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
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
    try {
      return JSON.parse(fs.readFileSync(storePath, "utf8")) as SecretsStore;
    } catch {
      return { version: 1, secrets: {} };
    }
  }

  function save(store: SecretsStore): void {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
    const tmp = `${storePath}.tmp.${randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, storePath);
    try { fs.chmodSync(storePath, 0o600); } catch { /* non-fatal */ }
  }

  return {
    name: "file",

    async get(ref: string): Promise<string | null> {
      const store = load();
      const entry = store.secrets[ref];
      if (!entry) {return null;}
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
