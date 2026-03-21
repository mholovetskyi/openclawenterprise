/**
 * HashiCorp Vault secret backend (KV v2 engine).
 *
 * Config:
 *   enterprise.secrets.backend: vault
 *   enterprise.secrets.vault.address: https://vault.company.com
 *   enterprise.secrets.vault.token: ${VAULT_TOKEN}     # or use approle/k8s auth
 *   enterprise.secrets.vault.mount: secret              # KV v2 mount point
 *   enterprise.secrets.vault.prefix: openclaw/          # key prefix
 */

import type { SecretBackend, SecretMetadata } from "./index.js";

export type VaultBackendOptions = {
  address: string;
  token?: string;
  mount?: string;
  prefix?: string;
  /** AppRole auth: role_id + secret_id instead of static token */
  appRole?: { roleId: string; secretId: string };
  /** Kubernetes auth: role + service account JWT */
  k8sAuth?: { role: string; jwtPath?: string };
  namespace?: string;
};

export function createVaultBackend(opts: VaultBackendOptions): SecretBackend {
  const mount = opts.mount ?? "secret";
  const prefix = opts.prefix ?? "openclaw/";
  let token = opts.token ?? "";

  function kvPath(ref: string): string {
    return `${prefix}${ref}`.replace(/\/+/g, "/");
  }

  async function apiUrl(subpath: string): Promise<string> {
    return `${opts.address.replace(/\/$/, "")}/v1/${mount}/data/${subpath}`;
  }

  async function ensureToken(): Promise<string> {
    if (token) {return token;}
    if (opts.appRole) {
      token = await loginAppRole(opts.address, opts.appRole.roleId, opts.appRole.secretId);
    } else if (opts.k8sAuth) {
      token = await loginK8s(opts.address, opts.k8sAuth.role, opts.k8sAuth.jwtPath);
    } else {
      throw new Error("Vault backend: no authentication method configured");
    }
    return token;
  }

  async function vaultFetch(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const tok = await ensureToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Vault-Token": tok,
        ...(opts.namespace ? { "X-Vault-Namespace": opts.namespace } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  }

  return {
    name: "vault",

    async get(ref: string): Promise<string | null> {
      const url = await apiUrl(kvPath(ref));
      const res = await vaultFetch(url, { method: "GET" });
      if (res.status === 404) {return null;}
      if (!res.ok) {throw new Error(`Vault GET ${ref} failed: HTTP ${res.status}`);}
      const data = (res.body as { data?: { data?: Record<string, string> } })?.data?.data;
      return data?.value ?? null;
    },

    async set(ref: string, value: string, _meta?: SecretMetadata): Promise<void> {
      const url = await apiUrl(kvPath(ref));
      const res = await vaultFetch(url, {
        method: "POST",
        body: JSON.stringify({ data: { value } }),
      });
      if (!res.ok) {throw new Error(`Vault SET ${ref} failed: HTTP ${res.status}`);}
    },

    async delete(ref: string): Promise<void> {
      const url = await apiUrl(kvPath(ref));
      const res = await vaultFetch(url, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Vault DELETE ${ref} failed: HTTP ${res.status}`);
      }
    },

    async list(): Promise<string[]> {
      const url = `${opts.address.replace(/\/$/, "")}/v1/${mount}/metadata/${prefix}?list=true`;
      const res = await vaultFetch(url, { method: "GET" });
      if (res.status === 404) {return [];}
      if (!res.ok) {return [];}
      const keys = (res.body as { data?: { keys?: string[] } })?.data?.keys ?? [];
      return keys.map((k) => `${prefix}${k}`.replace(/^\/+/, ""));
    },

    async exists(ref: string): Promise<boolean> {
      const url = await apiUrl(kvPath(ref));
      const res = await vaultFetch(url, { method: "GET" });
      return res.ok;
    },

    async shutdown(): Promise<void> {
      // Optionally revoke the token on shutdown (only for dynamic tokens)
    },
  };
}

async function loginAppRole(
  address: string,
  roleId: string,
  secretId: string,
): Promise<string> {
  const res = await fetch(`${address.replace(/\/$/, "")}/v1/auth/approle/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
  });
  if (!res.ok) {throw new Error(`Vault AppRole login failed: HTTP ${res.status}`);}
  const body = (await res.json()) as { auth?: { client_token?: string } };
  const tok = body?.auth?.client_token;
  if (!tok) {throw new Error("Vault AppRole login: no client_token in response");}
  return tok;
}

async function loginK8s(
  address: string,
  role: string,
  jwtPath = "/var/run/secrets/kubernetes.io/serviceaccount/token",
): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const jwt = readFileSync(jwtPath, "utf8").trim();
  const res = await fetch(`${address.replace(/\/$/, "")}/v1/auth/kubernetes/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, jwt }),
  });
  if (!res.ok) {throw new Error(`Vault K8s login failed: HTTP ${res.status}`);}
  const body = (await res.json()) as { auth?: { client_token?: string } };
  const tok = body?.auth?.client_token;
  if (!tok) {throw new Error("Vault K8s login: no client_token in response");}
  return tok;
}
