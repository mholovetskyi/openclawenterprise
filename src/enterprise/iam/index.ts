/**
 * Enterprise IAM subsystem initialization.
 */

import type { OpenClawConfig } from "../../config/config.js";
import { InMemoryRBACStore } from "./rbac/store.js";
import { RBACEngine } from "./rbac/engine.js";
import { JWTService, generateRS256KeyPair } from "../auth/jwt.js";
import type { RBACStore } from "./rbac/store.js";

export type IAMHandle = {
  rbac: RBACEngine;
  jwt: JWTService;
  store: RBACStore;
  shutdown: () => Promise<void>;
};

let handle: IAMHandle | null = null;

export async function initIAM(cfg: OpenClawConfig): Promise<IAMHandle> {
  const store = new InMemoryRBACStore();

  const jwtAlgorithm = cfg.enterprise?.auth?.jwt?.algorithm ?? "RS256";
  let jwtConfig = cfg.enterprise?.auth?.jwt ?? {};

  if (jwtAlgorithm === "RS256" && !jwtConfig.privateKey) {
    // Auto-generate RS256 key pair (persisted to state dir in production)
    const kp = generateRS256KeyPair();
    jwtConfig = { ...jwtConfig, ...kp, algorithm: "RS256" };
  }

  const jwt = new JWTService({
    algorithm: jwtAlgorithm as "RS256" | "HS256",
    ...jwtConfig,
    accessTokenTtlMs: cfg.enterprise?.auth?.jwt?.accessTokenTtlMs ?? 900_000,
    refreshTokenTtlMs: cfg.enterprise?.auth?.jwt?.refreshTokenTtlMs ?? 604_800_000,
    issuer: cfg.enterprise?.auth?.jwt?.issuer ?? "openclaw",
    audience: cfg.enterprise?.auth?.jwt?.audience ?? "openclaw",
  });

  const rbac = new RBACEngine(store);

  handle = { rbac, jwt, store, shutdown: async () => { handle = null; } };
  return handle;
}

export function getIAMHandle(): IAMHandle | null {
  return handle;
}
