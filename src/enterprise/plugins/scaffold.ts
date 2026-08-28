/**
 * Plugin Scaffolding CLI — generates a new plugin project skeleton.
 *
 * Usage:
 *   openclaw plugin scaffold <name> [--capabilities audit-sink,secret-backend,guardrail-rule]
 *
 * Generates:
 *   plugins/<name>/
 *     ├── package.json
 *     ├── tsconfig.json
 *     ├── index.ts
 *     └── index.test.ts
 */

import fs from "node:fs";
import path from "node:path";

export type ScaffoldOptions = {
  name: string;
  capabilities: string[];
  author?: string;
  description?: string;
  outputDir?: string;
};

const VALID_CAPABILITIES = ["audit-sink", "secret-backend", "guardrail-rule"] as const;

export function validateScaffoldOptions(opts: ScaffoldOptions): string[] {
  const errors: string[] = [];

  if (!opts.name || !/^[a-z][a-z0-9-]*$/.test(opts.name)) {
    errors.push('Plugin name must be lowercase alphanumeric with dashes (e.g. "my-plugin")');
  }

  if (opts.capabilities.length === 0) {
    errors.push("At least one capability is required");
  }

  for (const cap of opts.capabilities) {
    if (!VALID_CAPABILITIES.some((valid) => valid === cap)) {
      errors.push(`Invalid capability: "${cap}". Valid: ${VALID_CAPABILITIES.join(", ")}`);
    }
  }

  return errors;
}

function generatePackageJson(opts: ScaffoldOptions): string {
  const pkg = {
    name: `@openclaw/plugin-${opts.name}`,
    version: "0.1.0",
    description: opts.description ?? `OpenClaw ${opts.name} integration plugin`,
    type: "module",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    scripts: {
      build: "tsc",
      dev: "tsc --watch",
      test: "vitest run",
      "test:watch": "vitest",
    },
    keywords: ["openclaw", "plugin", ...opts.capabilities],
    author: opts.author ?? "",
    license: "MIT",
    peerDependencies: {
      "@openclaw/integration-sdk": ">=0.1.0",
    },
    devDependencies: {
      "@openclaw/integration-sdk": "^0.1.0",
      typescript: "^5.7.0",
      vitest: "^3.0.0",
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function generateTsConfig(): string {
  const cfg = {
    compilerOptions: {
      target: "es2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      declaration: true,
      outDir: "dist",
      rootDir: ".",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ["*.ts"],
    exclude: ["node_modules", "dist", "*.test.ts"],
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

function generateVitestConfig(): string {
  return `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    setupFiles: [],
  },
});
`;
}

function generateIndex(opts: ScaffoldOptions): string {
  const caps = opts.capabilities;
  const hasAudit = caps.includes("audit-sink");
  const hasSecrets = caps.includes("secret-backend");
  const hasGuardrail = caps.includes("guardrail-rule");

  const imports: string[] = [
    `import type { PluginLifecycle, PluginContext, PluginExports } from "@openclaw/integration-sdk";`,
  ];

  if (hasAudit) {
    imports.push(
      `import type { AuditEvent } from "@openclaw/integration-sdk";`,
      `import { BaseBatchedAuditSink } from "@openclaw/integration-sdk";`,
    );
  }
  if (hasSecrets) {
    imports.push(`import type { SecretBackend, SecretMetadata } from "@openclaw/integration-sdk";`);
  }
  if (hasGuardrail) {
    imports.push(
      `import type { GuardrailRule, GuardrailContext, GuardrailResult } from "@openclaw/integration-sdk";`,
    );
  }

  let body = `${imports.join("\n")}

`;

  // Audit sink class
  if (hasAudit) {
    body += `// ── Audit Sink ─────────────────────────────────────────────────────────────

class ${pascalCase(opts.name)}AuditSink extends BaseBatchedAuditSink {
  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    // TODO: implement sending events to ${opts.name}
    throw new Error("Not implemented");
  }
}

`;
  }

  // Secret backend
  if (hasSecrets) {
    body += `// ── Secret Backend ─────────────────────────────────────────────────────────

class ${pascalCase(opts.name)}SecretBackend implements SecretBackend {
  readonly name = "${opts.name}";

  async get(_ref: string): Promise<string | null> {
    throw new Error("Not implemented");
  }

  async set(_ref: string, _value: string, _meta?: SecretMetadata): Promise<void> {
    throw new Error("Not implemented");
  }

  async delete(_ref: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async list(): Promise<string[]> {
    throw new Error("Not implemented");
  }

  async exists(ref: string): Promise<boolean> {
    return (await this.get(ref)) !== null;
  }

  async shutdown(): Promise<void> {}
}

`;
  }

  // Guardrail rule
  if (hasGuardrail) {
    body += `// ── Guardrail Rule ─────────────────────────────────────────────────────────

class ${pascalCase(opts.name)}GuardrailRule implements GuardrailRule {
  readonly id = "${opts.name}-guardrail";
  readonly description = "${opts.name} guardrail rule";

  evaluate(_ctx: GuardrailContext): GuardrailResult | null {
    // TODO: implement guardrail logic
    return null;
  }
}

`;
  }

  // Plugin lifecycle
  const capsList = caps.map((c) => `"${c}"`).join(", ");

  body += `// ── Plugin Lifecycle ───────────────────────────────────────────────────────

const plugin: PluginLifecycle = {
  manifest: {
    name: "${opts.name}",
    version: "0.1.0",
    description: "${opts.description ?? `OpenClaw ${opts.name} integration`}",
    capabilities: [${capsList}],
    configSchema: {
      // TODO: define your config schema
    },
  },

  async init(ctx: PluginContext): Promise<PluginExports> {
    ctx.logger.info("Initializing ${opts.name} plugin");

    return {`;

  if (hasAudit) {
    body += `
      auditSinks: [new ${pascalCase(opts.name)}AuditSink(ctx.logger)],`;
  }
  if (hasSecrets) {
    body += `
      secretBackends: [new ${pascalCase(opts.name)}SecretBackend()],`;
  }
  if (hasGuardrail) {
    body += `
      guardrailRules: [new ${pascalCase(opts.name)}GuardrailRule()],`;
  }

  body += `
    };
  },

  async shutdown(): Promise<void> {},
};

export default plugin;
`;

  return body;
}

function generateTestFile(opts: ScaffoldOptions): string {
  const hasAudit = opts.capabilities.includes("audit-sink");
  const hasSecrets = opts.capabilities.includes("secret-backend");
  const hasGuardrail = opts.capabilities.includes("guardrail-rule");

  let body = `import { describe, it, expect } from "vitest";
import { initTestPlugin, buildTestEvent } from "@openclaw/integration-sdk/testing";
import plugin from "./index.js";

describe("${opts.name} plugin", () => {
  it("initializes successfully", async () => {
    const { exports, shutdown } = await initTestPlugin(plugin, {
      config: {},
    });
`;

  if (hasAudit) {
    body += `    expect(exports.auditSinks).toHaveLength(1);\n`;
  }
  if (hasSecrets) {
    body += `    expect(exports.secretBackends).toHaveLength(1);\n`;
  }
  if (hasGuardrail) {
    body += `    expect(exports.guardrailRules).toHaveLength(1);\n`;
  }

  body += `    await shutdown();
  });
`;

  if (hasAudit) {
    body += `
  it("sends audit events", async () => {
    const { exports, shutdown } = await initTestPlugin(plugin);
    const sink = exports.auditSinks![0];
    const event = buildTestEvent({ action: "test.action" });

    // TODO: replace with actual assertions once flushBatch is implemented
    await expect(sink.send(event)).rejects.toThrow("Not implemented");
    await shutdown();
  });
`;
  }

  body += `});
`;

  return body;
}

function pascalCase(s: string): string {
  return s
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// ── Scaffold command ─────────────────────────────────────────────────────────

export function scaffoldPlugin(opts: ScaffoldOptions): { dir: string; files: string[] } {
  const errors = validateScaffoldOptions(opts);
  if (errors.length > 0) {
    throw new Error(`Invalid scaffold options:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const baseDir = opts.outputDir ?? "plugins";
  const pluginDir = path.resolve(baseDir, opts.name);

  if (fs.existsSync(pluginDir)) {
    throw new Error(`Directory already exists: ${pluginDir}`);
  }

  fs.mkdirSync(pluginDir, { recursive: true });

  const files: Array<[string, string]> = [
    ["package.json", generatePackageJson(opts)],
    ["tsconfig.json", generateTsConfig()],
    ["vitest.config.ts", generateVitestConfig()],
    ["index.ts", generateIndex(opts)],
    ["index.test.ts", generateTestFile(opts)],
  ];

  const created: string[] = [];
  for (const [filename, content] of files) {
    const filePath = path.join(pluginDir, filename);
    fs.writeFileSync(filePath, content, "utf8");
    created.push(filePath);
  }

  return { dir: pluginDir, files: created };
}
