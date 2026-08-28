/**
 * Enterprise IAM subsystem initialization.
 */

import fs from "node:fs";
import path from "node:path";
import { parseDurationMs } from "../../cli/parse-duration.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { JWTService, generateRS256KeyPair } from "../auth/jwt.js";
import { TokenStore } from "../auth/token-store.js";
import { RBACEngine } from "./rbac/engine.js";
import { createSQLiteRBACStore } from "./rbac/store-sqlite.js";
import { InMemoryRBACStore } from "./rbac/store.js";
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

  const stateDir = resolveStateDir();
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

  const jwtCfg = cfg.enterprise?.iam?.jwt ?? {};
  const jwtAlgorithm = jwtCfg.algorithm ?? "RS256";

  let privateKey: string | undefined;
  let publicKey: string | undefined;

  if (jwtAlgorithm === "RS256") {
    // Key material lives in PEM files (documented default: <state>/enterprise/iam/*.pem),
    // overridable via iam.jwt.privateKeyPath / publicKeyPath. Auto-generated and
    // persisted on first start so issued tokens survive restarts.
    const iamDir = path.join(enterpriseDir, "iam");
    const privateKeyPath = jwtCfg.privateKeyPath ?? path.join(iamDir, "private.pem");
    const publicKeyPath = jwtCfg.publicKeyPath ?? path.join(iamDir, "public.pem");

    // Use readFileSync directly (no existsSync pre-check) to avoid a TOCTOU
    // race condition where a symlink could be swapped between the check and use.
    try {
      privateKey = fs.readFileSync(privateKeyPath, "utf8");
      publicKey = fs.readFileSync(publicKeyPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Files exist but are unreadable — warn and regenerate.
        process.stderr.write(
          "[enterprise/iam] WARNING: JWT key files unreadable, regenerating key pair. " +
            "Existing issued tokens will not verify after restart.\n",
        );
      }
      // ENOENT = first start; any other error = corrupt. Either way, generate fresh pair.
      privateKey = undefined;
      publicKey = undefined;
    }

    if (!privateKey || !publicKey) {
      const kp = generateRS256KeyPair();
      privateKey = kp.privateKey;
      publicKey = kp.publicKey;
      try {
        fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
        fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });
        fs.writeFileSync(privateKeyPath, kp.privateKey, { mode: 0o600 });
        fs.writeFileSync(publicKeyPath, kp.publicKey, { mode: 0o644 });
      } catch {
        // Non-fatal — next restart will regenerate but existing tokens won't verify
      }
    }
  }

  const jwt = new JWTService({
    algorithm: jwtAlgorithm,
    ...(jwtCfg.secret ? { secret: jwtCfg.secret } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(publicKey ? { publicKey } : {}),
    accessTokenTtlMs: jwtCfg.expiresIn ? parseDurationMs(jwtCfg.expiresIn) : 900_000,
    refreshTokenTtlMs: jwtCfg.refreshExpiresIn
      ? parseDurationMs(jwtCfg.refreshExpiresIn)
      : 604_800_000,
    issuer: jwtCfg.issuer ?? "openclaw",
    audience: "openclaw",
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
