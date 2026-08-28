/**
 * Oracle Agent Spec JSON export — exports OpenClaw agent configurations
 * in Oracle's Agent Spec format for interoperability with Oracle AI services.
 *
 * Activation in config:
 *   enterprise:
 *     oracle:
 *       agentSpec:
 *         enabled: true
 *         exportPath: ./agent-spec.json
 *         includeTools: true
 *         includeSystemPrompt: false
 *         redactSecrets: true
 *
 * The Agent Spec format is a JSON document that describes an AI agent's
 * capabilities, tools, model configuration, and metadata in a portable,
 * vendor-neutral schema.
 */

// ── Config ─────────────────────────────────────────────────────────────────────

export type AgentSpecExportConfig = {
  enabled?: boolean;
  exportPath?: string;
  includeTools?: boolean;
  includeSystemPrompt?: boolean;
  redactSecrets?: boolean;
};

// ── Agent Spec schema ──────────────────────────────────────────────────────────

export type AgentSpec = {
  specVersion: "1.0";
  metadata: {
    name: string;
    id: string;
    description?: string;
    version?: string;
    createdAt: string;
    generator: string;
  };
  model: {
    primary: string;
    fallbacks?: string[];
  };
  capabilities?: string[];
  tools?: AgentSpecTool[];
  systemPrompt?: string;
  guardrails?: AgentSpecGuardrail[];
  sandbox?: {
    mode: string;
    workspaceAccess?: string;
    scope?: string;
  };
  skills?: string[];
};

export type AgentSpecTool = {
  name: string;
  profile?: string;
  allowed?: string[];
  denied?: string[];
};

export type AgentSpecGuardrail = {
  id: string;
  description: string;
  action: string;
};

// ── Input types (simplified from OpenClaw config) ──────────────────────────────

export type AgentConfigInput = {
  id: string;
  name?: string;
  model?:
    | string
    | {
        primary?: string;
        fallbacks?: string[];
      };
  skills?: string[];
  tools?: {
    profile?: string;
    allow?: string[];
    deny?: string[];
  };
  sandbox?: {
    mode?: string;
    workspaceAccess?: string;
    scope?: string;
  };
};

export type GuardrailRuleInput = {
  id: string;
  description: string;
  action: string;
};

export type ExportOptions = {
  config: AgentSpecExportConfig;
  agents: AgentConfigInput[];
  guardrailRules?: GuardrailRuleInput[];
  systemPrompt?: string;
  version?: string;
};

// ── Secret redaction ───────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /^env:\/\//,
  /^vault:\/\//,
  /^aws-sm:\/\//,
  /^gcp-sm:\/\//,
  /^azure-kv:\/\//,
  /^oci-vault:\/\//,
];

export function redactSecrets(obj: unknown): unknown {
  if (typeof obj === "string") {
    for (const p of SECRET_PATTERNS) {
      if (p.test(obj)) {
        return "***REDACTED***";
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactSecrets);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact keys that look like secrets
      if (/(?:secret|password|token|key|credential)/i.test(key) && typeof value === "string") {
        result[key] = "***REDACTED***";
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result;
  }
  return obj;
}

// ── Export function ─────────────────────────────────────────────────────────────

export function exportAgentSpec(agentInput: AgentConfigInput, options: ExportOptions): AgentSpec {
  const { config } = options;
  const shouldRedact = config.redactSecrets !== false;

  // Resolve model
  let primary = "default";
  let fallbacks: string[] | undefined;
  if (typeof agentInput.model === "string") {
    primary = agentInput.model;
  } else if (agentInput.model) {
    primary = agentInput.model.primary ?? "default";
    fallbacks = agentInput.model.fallbacks;
  }

  // Build tools section
  let tools: AgentSpecTool[] | undefined;
  if (config.includeTools !== false && agentInput.tools) {
    tools = [
      {
        name: agentInput.tools.profile ?? "default",
        profile: agentInput.tools.profile,
        allowed: agentInput.tools.allow,
        denied: agentInput.tools.deny,
      },
    ];
  }

  // Build guardrails
  let guardrails: AgentSpecGuardrail[] | undefined;
  if (options.guardrailRules && options.guardrailRules.length > 0) {
    guardrails = options.guardrailRules.map((r) => ({
      id: r.id,
      description: r.description,
      action: r.action,
    }));
  }

  // Build sandbox
  let sandbox: AgentSpec["sandbox"];
  if (agentInput.sandbox) {
    sandbox = {
      mode: agentInput.sandbox.mode ?? "off",
      workspaceAccess: agentInput.sandbox.workspaceAccess,
      scope: agentInput.sandbox.scope,
    };
  }

  // System prompt
  let systemPrompt: string | undefined;
  if (config.includeSystemPrompt && options.systemPrompt) {
    if (shouldRedact) {
      // SAFETY: options.systemPrompt is a string (truthy-guarded) and redactSecrets maps a string to a string (original or "***REDACTED***"), never another shape.
      systemPrompt = redactSecrets(options.systemPrompt) as string;
    } else {
      systemPrompt = options.systemPrompt;
    }
  }

  const spec: AgentSpec = {
    specVersion: "1.0",
    metadata: {
      name: agentInput.name ?? agentInput.id,
      id: agentInput.id,
      version: options.version ?? "1.0.0",
      createdAt: new Date().toISOString(),
      generator: "openclaw-enterprise",
    },
    model: { primary, fallbacks },
    capabilities: buildCapabilities(agentInput),
    tools,
    systemPrompt,
    guardrails,
    sandbox,
    skills: agentInput.skills,
  };

  if (shouldRedact) {
    // SAFETY: redactSecrets deep-clones structurally, preserving every object key and array position and only replacing secret-looking string values with a string marker, so a valid AgentSpec maps to a value that still satisfies AgentSpec.
    return redactSecrets(spec) as AgentSpec;
  }

  return spec;
}

function buildCapabilities(agent: AgentConfigInput): string[] {
  const caps: string[] = ["chat"];
  if (agent.tools) {
    caps.push("tool-use");
    if (agent.tools.profile === "coding" || agent.tools.profile === "full") {
      caps.push("code-execution");
    }
  }
  if (agent.sandbox) {
    caps.push("sandboxed-execution");
  }
  if (agent.skills && agent.skills.length > 0) {
    caps.push("skills");
  }
  return caps;
}

// ── Batch export ───────────────────────────────────────────────────────────────

export function exportAllAgentSpecs(options: ExportOptions): AgentSpec[] {
  return options.agents.map((agent) => exportAgentSpec(agent, options));
}

// ── File export ────────────────────────────────────────────────────────────────

export type AgentSpecExportDeps = {
  writeFile: (path: string, content: string) => Promise<void>;
};

export async function exportAgentSpecToFile(
  options: ExportOptions,
  deps: AgentSpecExportDeps,
): Promise<string> {
  const specs = exportAllAgentSpecs(options);
  const output = specs.length === 1 ? specs[0] : specs;
  const json = JSON.stringify(output, null, 2);
  const path = options.config.exportPath ?? "./agent-spec.json";
  await deps.writeFile(path, json);
  return path;
}
