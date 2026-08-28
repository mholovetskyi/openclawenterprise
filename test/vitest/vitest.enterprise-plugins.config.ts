// Vitest enterprise plugins config wires the repo-root `plugins/` test shard
// (OpenClaw Enterprise reference integrations: datadog, snowflake, splunk).
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createEnterprisePluginsVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["plugins/**/*.test.ts"], {
    dir: "plugins",
    env,
    fileParallelism: false,
    isolate: false,
    name: "enterprise-plugins",
    passWithNoTests: true,
  });
}

export default createEnterprisePluginsVitestConfig();
