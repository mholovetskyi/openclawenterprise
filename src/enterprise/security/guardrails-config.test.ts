import { describe, it, expect } from "vitest";
import {
  buildGuardrailRulesFromConfig,
  GuardrailEngine,
  DEFAULT_GUARDRAIL_RULES,
} from "./guardrails.js";

describe("buildGuardrailRulesFromConfig", () => {
  it("compiles a tool-input rule to a commandPattern and it gates via the engine", () => {
    const { rules, errors } = buildGuardrailRulesFromConfig([
      {
        id: "block-internal-tool",
        description: "block secret tool arg",
        pattern: "internal-secret",
        action: "block",
        scope: "tool-input",
      },
    ]);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.match.commandPattern).toBeInstanceOf(RegExp);

    const engine = new GuardrailEngine([...DEFAULT_GUARDRAIL_RULES, ...rules]);
    const result = engine.evaluate({ tool: "any", input: { x: "internal-secret" } });
    expect(result.action).toBe("block");
    expect(result.triggered.some((t) => t.rule.id === "block-internal-tool")).toBe(true);
  });

  it("maps tool-output and message scopes to outputPattern", () => {
    const { rules } = buildGuardrailRulesFromConfig([
      { id: "out", pattern: "exfil", action: "warn", scope: "tool-output" },
      { id: "msg", pattern: "leak", action: "warn", scope: "message" },
    ]);
    expect(rules[0]!.match.outputPattern).toBeInstanceOf(RegExp);
    expect(rules[1]!.match.outputPattern).toBeInstanceOf(RegExp);
  });

  it("fails closed on an invalid regex: drops the rule and reports the error", () => {
    const { rules, errors } = buildGuardrailRulesFromConfig([
      { id: "bad", pattern: "([unterminated", action: "block", scope: "tool-input" },
    ]);
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe("bad");
  });

  it("refuses a rule with no pattern rather than installing a matchless (always-fire) rule", () => {
    const { rules, errors } = buildGuardrailRulesFromConfig([
      { id: "no-pattern", action: "block" },
    ]);
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe("no-pattern");
  });

  it("returns empty for undefined config", () => {
    expect(buildGuardrailRulesFromConfig(undefined)).toEqual({ rules: [], errors: [] });
  });
});
