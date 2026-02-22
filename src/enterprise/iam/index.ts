/**
 * Enterprise IAM subsystem initialization.
 */

import path from "node:path";
import fs from "node:fs";
import type { OpenClawConfig } from "../../config/config.js";
import { InMemoryRBACStore } from "./rbac/store.js";
import { createSQLiteRBACStore } from "./rbac/store-sqlite.js";
import { RBACEngine } from "./rbac/engine.js";
import { JWTService, generateRS256KeyPair } from "../auth/jwt.js";
import { TokenStore } from "../auth/token-store.js";
import type { RBACStore } from "./rbac/store.js";

export type IAMHandle = {
  rbac: RBACEngine;
  jwt: JWTService;
  store: RBACStore;
  tokens: TokenStore | null;
  shutdown: () => Promise<void>;
};

let handle: IAMHandle | null = null;

export async function initIAM(cfg: OpenClawConfig): Promise<IAMHandle> {
  // Prefer SQLite-backed store when a state directory is available.
  // Falls back to in-memory when better-sqlite3 is not installed or no path configured.
  let store: RBACStore;
  let tokens: TokenStore | null = null;

  const stateDir = cfg.stateDir ?? path.join(process.env["HOME"] ?? "~", ".openclaw");
  const enterpriseDir = path.join(stateDir, "enterprise");

  try {
    fs.mkdirSync(enterpriseDir, { recursive: true });
    const rbacDb = path.join(enterpriseDir, "iam.db");
    store = createSQLiteRBACStore(rbacDb);

    const tokenDb = path.join(enterpriseDir, "tokens.db");
    tokens = new TokenStore(tokenDb);

    // Prune expired tokens on startup, then hourly
    tokens.prune();
    const pruneInterval = setInterval(() => tokens?.prune(), 60 * 60 * 1000);
    pruneInterval.unref?.(); // don't keep process alive
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("better-sqlite3")) {
      // Optional dep not installed — fall back to in-memory with a clear warning
      process.stderr.write(
        "[enterprise/iam] WARNING: better-sqlite3 not installed. " +
          "Using in-memory RBAC store — users and roles will NOT persist across restarts. " +
          "Install with: npm install better-sqlite3\n",
      );
    } else {
      throw err;
    }
    store = new InMemoryRBACStore();
  }

  const jwtAlgorithm = cfg.enterprise?.auth?.jwt?.algorithm ?? "RS256";
  let jwtConfig = cfg.enterprise?.auth?.jwt ?? {};

  if (jwtAlgorithm === "RS256" && !jwtConfig.privateKey) {
    // Persist the key pair so tokens survive restarts
    const keyFile = path.join(enterpriseDir, "jwt-rsa.json");
    if (fs.existsSync(keyFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(keyFile, "utf8")) as {
          privateKey: string;
          publicKey: string;
        };
        jwtConfig = { ...jwtConfig, ...saved, algorithm: "RS256" };
      } catch {
        // Corrupt key file — regenerate
      }
    }
    if (!jwtConfig.privateKey) {
      const kp = generateRS256KeyPair();
      jwtConfig = { ...jwtConfig, ...kp, algorithm: "RS256" };
      try {
        fs.writeFileSync(keyFile, JSON.stringify(kp, null, 2), { mode: 0o600 });
      } catch {
        // Non-fatal — next restart will regenerate but existing tokens won't verify
      }
    }
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

  handle = {
    rbac,
    jwt,
    store,
    tokens,
    shutdown: async () => {
      tokens?.close();
      handle = null;
    },
  };
  return handle;
}

export function getIAMHandle(): IAMHandle | null {
  return handle;
}
