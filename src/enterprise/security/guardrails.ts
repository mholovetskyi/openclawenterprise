/**
 * Runtime guardrail engine — classify and gate agent actions.
 *
 * Actions are classified as: allow | warn | block | require-approval
 * Configurable via config.enterprise.guardrails.rules
 */

export type GuardrailAction = "allow" | "warn" | "block" | "require-approval";

export type GuardrailRule = {
  id: string;
  description: string;
  /** Match criteria */
  match: {
    tool?: string | RegExp;
    commandPattern?: RegExp;
    outputPattern?: RegExp;
  };
  action: GuardrailAction;
  message?: string;
};

export type GuardrailContext = {
  tool: string;
  input?: unknown;
  output?: string;
  agentId?: string;
  sessionKey?: string;
  tenantId?: string;
};

export type GuardrailResult = {
  action: GuardrailAction;
  /** Triggered rules */
  triggered: Array<{ rule: GuardrailRule; reason: string }>;
};

// ── Default rules ──────────────────────────────────────────────────────────────

export const DEFAULT_GUARDRAIL_RULES: GuardrailRule[] = [
  // Block credential harvesting patterns in bash
  {
    id: "bash-credential-harvest",
    description: "Block commands that exfiltrate credentials",
    match: {
      tool: "bash",
      commandPattern:
        /\bcat\b.*(credentials|\.env|api[_-]key|secret|password|token)|\bcurl\b.*-d.*\$\{?(API_KEY|SECRET|TOKEN|PASS)/gi,
    },
    action: "block",
    message: "Blocked: command pattern resembles credential exfiltration",
  },
  // Warn on reverse shell patterns
  {
    id: "bash-reverse-shell",
    description: "Block reverse shell patterns",
    match: {
      tool: "bash",
      commandPattern:
        /bash\s+-i\s+>&\s+\/dev\/tcp|nc\s+-e\s+\/bin\/|python.*socket.*connect|perl.*socket.*connect/gi,
    },
    action: "block",
    message: "Blocked: command pattern resembles reverse shell",
  },
  // Warn on mass deletion
  {
    id: "bash-mass-delete",
    description: "Require approval for mass deletion commands",
    match: {
      tool: "bash",
      commandPattern: /rm\s+-rf\s+\/|rm\s+--no-preserve-root|DROP\s+TABLE|TRUNCATE\s+TABLE/gi,
    },
    action: "require-approval",
    message: "Requires approval: destructive mass deletion command",
  },
  // Block PII in outputs going to external channels
  {
    id: "output-ssn",
    description: "Block SSN in outputs",
    match: {
      outputPattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/,
    },
    action: "warn",
    message: "Warning: output may contain SSN",
  },
  {
    id: "output-credit-card",
    description: "Block credit card numbers in outputs",
    match: {
      outputPattern:
        /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11})\b/,
    },
    action: "block",
    message: "Blocked: output contains potential credit card number",
  },
];

// ── Engine ─────────────────────────────────────────────────────────────────────

export class GuardrailEngine {
  private rules: GuardrailRule[];

  constructor(rules: GuardrailRule[] = DEFAULT_GUARDRAIL_RULES) {
    this.rules = rules;
  }

  /**
   * Evaluate guardrail rules against an action context.
   * Returns the most restrictive action from all triggered rules.
   */
  evaluate(ctx: GuardrailContext): GuardrailResult {
    const triggered: GuardrailResult["triggered"] = [];
    const inputStr = ctx.input ? JSON.stringify(ctx.input) : "";
    const outputStr = ctx.output ?? "";

    for (const rule of this.rules) {
      // Tool match
      if (rule.match.tool !== undefined) {
        const toolMatch =
          typeof rule.match.tool === "string"
            ? ctx.tool === rule.match.tool
            : rule.match.tool.test(ctx.tool);
        if (!toolMatch) continue;
      }

      // Command/input pattern match
      if (rule.match.commandPattern) {
        rule.match.commandPattern.lastIndex = 0;
        if (!rule.match.commandPattern.test(inputStr)) continue;
      }

      // Output pattern match
      if (rule.match.outputPattern) {
        rule.match.outputPattern.lastIndex = 0;
        if (!rule.match.outputPattern.test(outputStr)) continue;
      }

      triggered.push({
        rule,
        reason: rule.message ?? `Rule "${rule.id}" triggered`,
      });
    }

    // Pick most restrictive action
    const ACTION_PRIORITY: Record<GuardrailAction, number> = {
      allow: 0,
      warn: 1,
      "require-approval": 2,
      block: 3,
    };

    let action: GuardrailAction = "allow";
    for (const { rule } of triggered) {
      if (ACTION_PRIORITY[rule.action] > ACTION_PRIORITY[action]) {
        action = rule.action;
      }
    }

    return { action, triggered };
  }

  addRule(rule: GuardrailRule): void {
    this.rules.push(rule);
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }
}

// ── Config → engine rule compilation ────────────────────────────────────────

/** Shape of a guardrail rule declared in enterprise.guardrails.rules. */
export type GuardrailConfigRule = {
  id: string;
  description?: string;
  pattern?: string;
  action: GuardrailAction;
  scope?: "tool-input" | "tool-output" | "message";
};

/**
 * Compile config-declared guardrail rules into engine {@link GuardrailRule}s.
 *
 * Fails closed: a rule whose `pattern` does not compile, or that declares no
 * pattern at all, is dropped AND reported in `errors` — it is never installed
 * as a matchless rule (which the engine would treat as an always-fire rule,
 * silently blocking or allowing every tool call). Callers must surface/act on
 * `errors` rather than ignore them.
 *
 * Scope mapping: "tool-input" -> match.commandPattern; "tool-output" and
 * "message" -> match.outputPattern (the engine has no distinct message scope).
 */
export function buildGuardrailRulesFromConfig(
  configRules: readonly GuardrailConfigRule[] | undefined,
): { rules: GuardrailRule[]; errors: Array<{ id: string; error: string }> } {
  const rules: GuardrailRule[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const cfg of configRules ?? []) {
    if (cfg.pattern === undefined || cfg.pattern === "") {
      errors.push({
        id: cfg.id,
        error: "guardrail rule has no pattern; refusing to install a matchless rule",
      });
      continue;
    }
    let compiled: RegExp;
    try {
      compiled = new RegExp(cfg.pattern, "gi");
    } catch (err) {
      errors.push({ id: cfg.id, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const scope = cfg.scope ?? "tool-input";
    const match: GuardrailRule["match"] =
      scope === "tool-input" ? { commandPattern: compiled } : { outputPattern: compiled };

    rules.push({
      id: cfg.id,
      description: cfg.description ?? cfg.id,
      match,
      action: cfg.action,
    });
  }

  return { rules, errors };
}

// Singleton for convenience
let globalEngine: GuardrailEngine | null = null;

export function getGuardrailEngine(): GuardrailEngine {
  if (!globalEngine) {
    globalEngine = new GuardrailEngine();
  }
  return globalEngine;
}

export function setGuardrailEngine(engine: GuardrailEngine): void {
  globalEngine = engine;
}
