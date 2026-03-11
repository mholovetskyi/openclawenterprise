# @openclaw/integration-sdk

Enterprise Integration SDK for building custom OpenClaw plugins.

## Overview

This SDK provides the interfaces, base classes, and testing utilities needed to build integration plugins for OpenClaw Enterprise. Plugins can extend OpenClaw with:

- **Audit Sinks** — Forward audit events to external logging/SIEM platforms
- **Secret Backends** — Pluggable secret storage (databases, vaults, cloud KMS)
- **Guardrail Rules** — Custom runtime safety rules for agent actions

## Installation

```bash
npm install @openclaw/integration-sdk
```

## Quick Start

```typescript
import type {
  PluginLifecycle,
  PluginContext,
  PluginExports,
  AuditEvent,
} from "@openclaw/integration-sdk";
import { BaseBatchedAuditSink } from "@openclaw/integration-sdk";

// 1. Create an audit sink using the batching base class
class MyAuditSink extends BaseBatchedAuditSink {
  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    await fetch("https://my-logging-service/ingest", {
      method: "POST",
      body: JSON.stringify(events),
    });
  }
}

// 2. Define the plugin lifecycle
const plugin: PluginLifecycle = {
  manifest: {
    name: "my-plugin",
    version: "1.0.0",
    description: "My custom integration",
    capabilities: ["audit-sink"],
    configSchema: {
      apiKey: { type: "string", required: true, secret: true },
    },
  },

  async init(ctx: PluginContext): Promise<PluginExports> {
    const apiKey = await ctx.resolveSecret(ctx.config.apiKey as string);
    ctx.logger.info("Plugin initialized");

    return {
      auditSinks: [new MyAuditSink(ctx.logger, { batchSize: 50 })],
    };
  },

  async shutdown() {},
};

export default plugin;
```

## Extension Points

### AuditSink

Receives audit events and forwards them to external systems. Use `BaseBatchedAuditSink` to get automatic batching, retry with exponential backoff, and buffer management.

```typescript
class MyAuditSink extends BaseBatchedAuditSink {
  constructor(logger: PluginLogger, opts?: BatchedAuditSinkOptions) {
    super(logger, {
      batchSize: 100, // Max events per batch
      flushIntervalMs: 5000, // Timer-based flush
      retryAttempts: 3, // Retries on failure
      retryBackoffMs: 1000, // Exponential backoff base
      maxBufferSize: 10000, // Drop oldest when full
      ...opts,
    });
  }

  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    // Send events to your backend
  }
}
```

### SecretBackend

Pluggable secret storage. Implement the `SecretBackend` interface:

```typescript
class MySecretBackend implements SecretBackend {
  readonly name = "my-backend";
  async get(ref: string): Promise<string | null> {
    /* ... */
  }
  async set(ref: string, value: string, meta?: SecretMetadata): Promise<void> {
    /* ... */
  }
  async delete(ref: string): Promise<void> {
    /* ... */
  }
  async list(): Promise<string[]> {
    /* ... */
  }
  async exists(ref: string): Promise<boolean> {
    /* ... */
  }
  async shutdown(): Promise<void> {
    /* ... */
  }
}
```

### GuardrailRule

Custom runtime safety rules that evaluate agent actions:

```typescript
class MyGuardrailRule implements GuardrailRule {
  readonly id = "my-rule";
  readonly description = "Block dangerous patterns";

  evaluate(ctx: GuardrailContext): GuardrailResult | null {
    if (ctx.tool === "bash" && /dangerous-pattern/.test(String(ctx.input))) {
      return { action: "block", reason: "Blocked by my-rule" };
    }
    return null; // No match
  }
}
```

## Plugin Manifest

Every plugin must declare a manifest:

```typescript
const manifest: PluginManifest = {
  name: "my-plugin", // Unique identifier
  version: "1.0.0", // SemVer
  description: "Description",
  author: "Your Name",
  capabilities: ["audit-sink", "secret-backend", "guardrail-rule"],
  configSchema: {
    apiKey: {
      type: "string",
      required: true,
      secret: true, // May contain secret references
      description: "API key",
    },
    batchSize: {
      type: "number",
      default: 100,
      description: "Events per batch",
    },
  },
};
```

## Testing

Import testing utilities from `@openclaw/integration-sdk/testing`:

```typescript
import {
  initTestPlugin,
  buildTestEvent,
  buildTestEvents,
  createTestContext,
  createCollectorSink,
  createMemorySecretBackend,
  assertRuleAction,
  buildTestGuardrailContext,
} from "@openclaw/integration-sdk/testing";

// Initialize your plugin in a test environment
const { exports, ctx, shutdown } = await initTestPlugin(myPlugin, {
  config: { apiKey: "env://API_KEY" },
  secrets: { API_KEY: "test-key" },
});

// Build test events
const event = buildTestEvent({ action: "test.action", category: "auth" });
const events = buildTestEvents(100, { outcome: "success" });

// Test guardrail rules
await assertRuleAction(myRule, buildTestGuardrailContext({ tool: "bash" }), "block");

// Clean up
await shutdown();
```

## Scaffolding

Generate a new plugin skeleton using the CLI:

```bash
openclaw plugin scaffold my-plugin --capabilities audit-sink,guardrail-rule
```

## Reference Integrations

See the `plugins/` directory for complete examples:

- **datadog** — Audit sink + guardrail rule + health check
- **splunk** — Audit sink via HTTP Event Collector
- **snowflake** — Audit sink + secret backend

## License

MIT
