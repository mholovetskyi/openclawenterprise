/**
 * Enterprise audit subsystem initialization.
 */

import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { setAuditStorage, setAuditEnabled } from "./logger.js";
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

  setAuditStorage(storage);
  setAuditEnabled(true);

  return {
    storage,
    shutdown: async () => {
      setAuditEnabled(false);
      await storage.shutdown();
    },
  };
}
