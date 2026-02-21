/**
 * Enterprise audit subsystem initialization.
 */

import path from "node:path";
import os from "node:os";
import type { OpenClawConfig } from "../../config/config.js";
import { setAuditStorage, setAuditEnabled } from "./logger.js";
import type { AuditStorage } from "./storage/sqlite.js";

export type AuditHandle = {
  storage: AuditStorage;
  shutdown: () => Promise<void>;
};

export async function initAudit(cfg: OpenClawConfig): Promise<AuditHandle> {
  const auditCfg = cfg.enterprise?.audit;
  const backendType = auditCfg?.storage ?? "sqlite";

  let storage: AuditStorage;

  switch (backendType) {
    case "sqlite":
    default: {
      const { createSQLiteAuditStorage } = await import("./storage/sqlite.js");
      const dbPath =
        auditCfg?.sqlitePath ??
        path.join(os.homedir(), ".openclaw", "audit.db");
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
