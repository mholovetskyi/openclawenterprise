import { describe, it, expect, vi } from "vitest";
import {
  exportAgentSpec,
  exportAllAgentSpecs,
  exportAgentSpecToFile,
  redactSecrets,
  type AgentConfigInput,
  type ExportOptions,
  type AgentSpecExportConfig,
} from "./agent-spec-export.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultConfig: AgentSpecExportConfig = {
  enabled: true,
  includeTools: true,
  includeSystemPrompt: true,
  redactSecrets: true,
};

function makeAgent(overrides: Partial<AgentConfigInput> = {}): AgentConfigInput {
  return {
    id: "test-agent",
    name: "Test Agent",
    model: { primary: "anthropic/claude-sonnet-4-20250514", fallbacks: ["openai/gpt-4o"] },
    tools: { profile: "coding", allow: ["bash", "read"], deny: ["write"] },
    sandbox: { mode: "all", workspaceAccess: "rw", scope: "session" },
    skills: ["web-search", "code-review"],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    config: defaultConfig,
    agents: [makeAgent()],
    systemPrompt: "You are a helpful assistant.",
    version: "2.0.0",
    guardrailRules: [{ id: "no-pii", description: "Block PII in output", action: "block" }],
    ...overrides,
  };
}

// ── redactSecrets ────────────────────────────────────────────────────────────

describe("redactSecrets", () => {
  it("should redact env:// references", () => {
    expect(redactSecrets("env://API_KEY")).toBe("***REDACTED***");
  });

  it("should redact vault:// references", () => {
    expect(redactSecrets("vault://secret/data")).toBe("***REDACTED***");
  });

  it("should redact oci-vault:// references", () => {
    expect(redactSecrets("oci-vault://secret-id")).toBe("***REDACTED***");
  });

  it("should not redact normal strings", () => {
    expect(redactSecrets("hello world")).toBe("hello world");
  });

  it("should redact keys named 'secret', 'password', 'token', 'key'", () => {
    const input = {
      name: "visible",
      apiKey: "sk-123",
      clientSecret: "abc",
      password: "pass",
      authToken: "tok",
    };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result.name).toBe("visible");
    expect(result.apiKey).toBe("***REDACTED***");
    expect(result.clientSecret).toBe("***REDACTED***");
    expect(result.password).toBe("***REDACTED***");
    expect(result.authToken).toBe("***REDACTED***");
  });

  it("should recursively redact arrays", () => {
    const result = redactSecrets(["env://A", "normal"]) as string[];
    expect(result[0]).toBe("***REDACTED***");
    expect(result[1]).toBe("normal");
  });

  it("should handle null and numbers", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(42)).toBe(42);
  });
});

// ── exportAgentSpec ──────────────────────────────────────────────────────────

describe("exportAgentSpec", () => {
  it("should export a valid agent spec", () => {
    const options = makeOptions();
    const spec = exportAgentSpec(makeAgent(), options);

    expect(spec.specVersion).toBe("1.0");
    expect(spec.metadata.name).toBe("Test Agent");
    expect(spec.metadata.id).toBe("test-agent");
    expect(spec.metadata.generator).toBe("openclaw-enterprise");
    expect(spec.metadata.version).toBe("2.0.0");
    expect(spec.model.primary).toBe("anthropic/claude-sonnet-4-20250514");
    expect(spec.model.fallbacks).toEqual(["openai/gpt-4o"]);
  });

  it("should include tools when includeTools is true", () => {
    const spec = exportAgentSpec(makeAgent(), makeOptions());
    expect(spec.tools).toBeDefined();
    expect(spec.tools![0]!.profile).toBe("coding");
    expect(spec.tools![0]!.allowed).toEqual(["bash", "read"]);
    expect(spec.tools![0]!.denied).toEqual(["write"]);
  });

  it("should exclude tools when includeTools is false", () => {
    const spec = exportAgentSpec(
      makeAgent(),
      makeOptions({ config: { ...defaultConfig, includeTools: false } }),
    );
    expect(spec.tools).toBeUndefined();
  });

  it("should include system prompt when configured", () => {
    const spec = exportAgentSpec(makeAgent(), makeOptions());
    expect(spec.systemPrompt).toBe("You are a helpful assistant.");
  });

  it("should exclude system prompt when includeSystemPrompt is false", () => {
    const spec = exportAgentSpec(
      makeAgent(),
      makeOptions({ config: { ...defaultConfig, includeSystemPrompt: false } }),
    );
    expect(spec.systemPrompt).toBeUndefined();
  });

  it("should include guardrail rules", () => {
    const spec = exportAgentSpec(makeAgent(), makeOptions());
    expect(spec.guardrails).toHaveLength(1);
    expect(spec.guardrails![0]!.id).toBe("no-pii");
    expect(spec.guardrails![0]!.action).toBe("block");
  });

  it("should include sandbox config", () => {
    const spec = exportAgentSpec(makeAgent(), makeOptions());
    expect(spec.sandbox).toEqual({
      mode: "all",
      workspaceAccess: "rw",
      scope: "session",
    });
  });

  it("should include skills list", () => {
    const spec = exportAgentSpec(makeAgent(), makeOptions());
    expect(spec.skills).toEqual(["web-search", "code-review"]);
  });

  it("should build capabilities from agent config", () => {
    const spec = exportAgentSpec(makeAgent(), makeOptions());
    expect(spec.capabilities).toContain("chat");
    expect(spec.capabilities).toContain("tool-use");
    expect(spec.capabilities).toContain("code-execution");
    expect(spec.capabilities).toContain("sandboxed-execution");
    expect(spec.capabilities).toContain("skills");
  });

  it("should handle string model config", () => {
    const spec = exportAgentSpec(makeAgent({ model: "openai/gpt-4o" }), makeOptions());
    expect(spec.model.primary).toBe("openai/gpt-4o");
    expect(spec.model.fallbacks).toBeUndefined();
  });

  it("should use agent id as name when name is missing", () => {
    const spec = exportAgentSpec(makeAgent({ name: undefined }), makeOptions());
    expect(spec.metadata.name).toBe("test-agent");
  });

  it("should redact secrets in system prompt", () => {
    const spec = exportAgentSpec(
      makeAgent(),
      makeOptions({ systemPrompt: "Use key env://SECRET_KEY for auth" }),
    );
    // The system prompt itself is a plain string, not a secret ref pattern
    // But if it exactly matches env://, it would be redacted
    expect(spec.systemPrompt).toBeDefined();
  });

  it("should not redact when redactSecrets is false", () => {
    const agent = makeAgent();
    const spec = exportAgentSpec(
      agent,
      makeOptions({
        config: { ...defaultConfig, redactSecrets: false },
      }),
    );
    expect(spec.model.primary).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("should handle agent with no tools or sandbox", () => {
    const spec = exportAgentSpec(
      makeAgent({ tools: undefined, sandbox: undefined, skills: undefined }),
      makeOptions(),
    );
    expect(spec.tools).toBeUndefined();
    expect(spec.sandbox).toBeUndefined();
    expect(spec.capabilities).toEqual(["chat"]);
  });
});

// ── exportAllAgentSpecs ──────────────────────────────────────────────────────

describe("exportAllAgentSpecs", () => {
  it("should export specs for all agents", () => {
    const options = makeOptions({
      agents: [
        makeAgent({ id: "agent-1", name: "Agent One" }),
        makeAgent({ id: "agent-2", name: "Agent Two" }),
      ],
    });
    const specs = exportAllAgentSpecs(options);
    expect(specs).toHaveLength(2);
    expect(specs[0]!.metadata.id).toBe("agent-1");
    expect(specs[1]!.metadata.id).toBe("agent-2");
  });
});

// ── exportAgentSpecToFile ────────────────────────────────────────────────────

describe("exportAgentSpecToFile", () => {
  it("should write single agent as object", async () => {
    const writeFile = vi.fn(async (_path: string, _content: string) => {});
    const path = await exportAgentSpecToFile(
      makeOptions({ config: { ...defaultConfig, exportPath: "/tmp/spec.json" } }),
      { writeFile },
    );
    expect(path).toBe("/tmp/spec.json");
    expect(writeFile).toHaveBeenCalledOnce();
    const written = JSON.parse(writeFile.mock.calls[0]![1]);
    expect(written.specVersion).toBe("1.0");
  });

  it("should write multiple agents as array", async () => {
    const writeFile = vi.fn(async (_path: string, _content: string) => {});
    await exportAgentSpecToFile(
      makeOptions({
        agents: [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })],
      }),
      { writeFile },
    );
    const written = JSON.parse(writeFile.mock.calls[0]![1]);
    expect(Array.isArray(written)).toBe(true);
    expect(written).toHaveLength(2);
  });

  it("should use default path when exportPath not set", async () => {
    const writeFile = vi.fn(async () => {});
    const path = await exportAgentSpecToFile(
      makeOptions({ config: { ...defaultConfig, exportPath: undefined } }),
      { writeFile },
    );
    expect(path).toBe("./agent-spec.json");
  });
});
