/**
 * Enterprise audit subsystem initialization.
 */

import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { AuditSinkConfig } from "../../config/types.enterprise.js";
import { setAuditStorage, setAuditEnabled, seedAuditChain, setAuditSinks } from "./logger.js";
import type { AuditSink } from "./sinks/syslog.js";
import type { AuditStorage } from "./storage/sqlite.js";

export type AuditHandle = {
  storage: AuditStorage;
  shutdown: () => Promise<void>;
};

export async function initAudit(cfg: OpenClawConfig): Promise<AuditHandle> {
  const auditCfg = cfg.enterprise?.audit;
  const storageCfg = auditCfg?.storage;
  const driver = storageCfg?.driver ?? "sqlite";

  let storage: AuditStorage;

  switch (driver) {
    case "postgresql": {
      const url = storageCfg?.url;
      if (!url) {
        throw new Error('enterprise.audit.storage.url is required when driver is "postgresql"');
      }
      const { createPostgresAuditStorage } = await import("./storage/postgres.js");
      const { resolveSecretValue } = await import("../secrets/index.js");
      storage = await createPostgresAuditStorage({
        connectionString: await resolveSecretValue(url),
      });
      break;
    }
    case "sqlite":
    default: {
      const { createSQLiteAuditStorage } = await import("./storage/sqlite.js");
      const dbPath = storageCfg?.path ?? path.join(os.homedir(), ".openclaw", "audit.db");
      storage = await createSQLiteAuditStorage(dbPath);
      break;
    }
  }

  // Seed the in-memory chain head from persisted storage BEFORE enabling writes,
  // so the hash chain continues across restarts instead of forking (the first
  // post-restart event otherwise carries previousHash=undefined while prior
  // events exist, which reads as tampering/truncation).
  if (storage.getHead) {
    seedAuditChain(await storage.getHead());
  } else {
    const hash = await storage.getLastHash();
    seedAuditChain(hash === undefined ? undefined : { hash, seq: 0 });
  }

  // Construct any configured external sinks and register them so auditLog fans
  // each event out to every sink after a successful storage append.
  const sinks = await buildSinks(auditCfg?.sinks ?? []);

  setAuditStorage(storage);
  setAuditSinks(sinks);
  setAuditEnabled(true);

  return {
    storage,
    shutdown: async () => {
      setAuditEnabled(false);
      setAuditSinks([]);
      await Promise.all(
        sinks.map(async (s) => {
          try {
            await s.close();
          } catch (err) {
            process.stderr.write(`[audit] Sink close failed: ${err}\n`);
          }
        }),
      );
      await storage.shutdown();
    },
  };
}

/**
 * Build the configured audit sinks. A sink that fails to construct (e.g. a
 * missing optional SDK package) is surfaced loudly to stderr — an unmet SIEM /
 * compliance-forwarding control must never fail silently — and the remaining
 * sinks still initialize.
 */
async function buildSinks(configs: AuditSinkConfig[]): Promise<AuditSink[]> {
  const sinks: AuditSink[] = [];
  for (const sinkCfg of configs) {
    try {
      sinks.push(await buildSink(sinkCfg));
    } catch (err) {
      process.stderr.write(
        `[audit] FAILED to initialize configured '${sinkCfg.type}' audit sink: ${err}. ` +
          `Audit events will NOT be forwarded to this destination.\n`,
      );
    }
  }
  return sinks;
}

async function buildSink(sinkCfg: AuditSinkConfig): Promise<AuditSink> {
  switch (sinkCfg.type) {
    case "syslog": {
      const { createSyslogSink } = await import("./sinks/syslog.js");
      return createSyslogSink(sinkCfg);
    }
    case "webhook": {
      const { createWebhookSink } = await import("./sinks/syslog.js");
      return createWebhookSink(sinkCfg);
    }
    case "palantir-foundry": {
      const { createPalantirSink } = await import("./sinks/palantir.js");
      const { resolveSecretValue } = await import("../secrets/index.js");
      return createPalantirSink(sinkCfg, { resolveSecret: resolveSecretValue });
    }
    case "oci-streaming": {
      const { createOciStreamingSink } = await import("./sinks/oci-streaming.js");
      const { resolveSecretValue } = await import("../secrets/index.js");
      return createOciStreamingSink(sinkCfg, { resolveSecret: resolveSecretValue });
    }
    default: {
      // Exhaustiveness guard — a new sink type must be handled here.
      const _exhaustive: never = sinkCfg;
      throw new Error(`unknown audit sink type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
