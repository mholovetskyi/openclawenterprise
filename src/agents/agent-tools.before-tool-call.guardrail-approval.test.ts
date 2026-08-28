import { describe, it, expect, afterEach } from "vitest";
import {
  GuardrailEngine,
  setGuardrailEngine,
  type GuardrailRule,
} from "../enterprise/security/guardrails.js";
import { runBeforeToolCallHook } from "./agent-tools.before-tool-call.policy.js";

// Tool-agnostic rules (no `match.tool`) so they fire regardless of how the
// policy layer normalizes the tool name (e.g. bash -> exec).
const requireApprovalRule: GuardrailRule = {
  id: "needs-approval",
  description: "requires approval",
  match: { commandPattern: /rm\s+-rf\s+\// },
  action: "require-approval",
};

const blockRule: GuardrailRule = {
  id: "hard-block",
  description: "blocked",
  match: { commandPattern: /DROP\s+TABLE/i },
  action: "block",
};

describe("before_tool_call enterprise guardrail: require-approval", () => {
  afterEach(() => {
    // Restore default singleton so sibling tests are unaffected.
    setGuardrailEngine(new GuardrailEngine());
  });

  it("does NOT silently allow a require-approval rule — it fails closed (veto)", async () => {
    setGuardrailEngine(new GuardrailEngine([requireApprovalRule]));
    const outcome = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "rm -rf /" },
    });
    expect(outcome.blocked).toBe(true);
    expect(outcome).toMatchObject({ kind: "veto" });
  });

  it("a require-approval rule does not fall through to allow the tool call", async () => {
    setGuardrailEngine(new GuardrailEngine([requireApprovalRule]));
    const outcome = await runBeforeToolCallHook({
      toolName: "shell",
      params: { command: "please rm -rf / now" },
    });
    expect(outcome.blocked).toBe(true);
  });

  it("still blocks a 'block' rule and allows an unmatched call", async () => {
    setGuardrailEngine(new GuardrailEngine([requireApprovalRule, blockRule]));
    const blocked = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "DROP TABLE users" },
    });
    expect(blocked.blocked).toBe(true);

    const allowed = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "echo hello" },
    });
    expect(allowed.blocked).toBe(false);
  });
});
