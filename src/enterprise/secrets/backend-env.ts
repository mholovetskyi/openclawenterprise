/**
 * Read-only environment-variable secret backend.
 *
 * Intended for containerized deployments where secrets are injected as
 * environment variables (e.g. via Kubernetes secrets, Docker `--env-file`, or a
 * platform secret manager). This backend performs NO local persistence — it
 * never writes a master key or an on-disk store. Reads resolve against
 * `process.env`; all mutating operations throw because the backend is read-only.
 */

import type { SecretBackend, SecretMetadata } from "./index.js";

const READ_ONLY = 'env secret backend is read-only (backend: "env")';

export function createEnvBackend(): SecretBackend {
  return {
    name: "env",

    async get(ref: string): Promise<string | null> {
      const val = process.env[ref];
      return val === undefined ? null : val;
    },

    async set(_ref: string, _value: string, _meta?: SecretMetadata): Promise<void> {
      throw new Error(`${READ_ONLY}; cannot set secrets`);
    },

    async delete(_ref: string): Promise<void> {
      throw new Error(`${READ_ONLY}; cannot delete secrets`);
    },

    async list(): Promise<string[]> {
      // Do not enumerate the entire process environment — that would leak every
      // variable regardless of whether it is a managed secret.
      return [];
    },

    async exists(ref: string): Promise<boolean> {
      return process.env[ref] !== undefined;
    },

    async shutdown(): Promise<void> {
      // Nothing to release.
    },
  };
}
