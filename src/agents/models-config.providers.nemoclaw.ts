/**
 * Enterprise NemoClaw provider (fork extension).
 *
 * NemoClaw is the enterprise-branded NVIDIA-hosted provider: Nemotron models
 * served from integrate.api.nvidia.com, keyed by NEMOCLAW_API_KEY with a
 * fallback to the NVIDIA credential. The sandbox/runtime side lives in
 * src/enterprise/nvidia/nemoclaw-provider.ts; this module only contributes
 * the implicit model-provider catalog entry.
 */
import type { AuthProfileStore } from "./auth-profiles/types.js";
import {
  resolveApiKeyFromProfiles,
  resolveEnvApiKeyVarName,
  type ProviderConfig,
} from "./models-config.providers.secret-helpers.js";

const NEMOCLAW_BASE_URL = "https://integrate.api.nvidia.com/v1";

const NEMOCLAW_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/** Builds the static NemoClaw provider catalog (no credentials attached). */
export function buildNemoClawProvider(): ProviderConfig {
  return {
    baseUrl: NEMOCLAW_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "nvidia/nemotron-3-super-120b-a12b",
        name: "NemoClaw Nemotron 3 Super 120B",
        reasoning: true,
        input: ["text"],
        cost: NEMOCLAW_DEFAULT_COST,
        contextWindow: 131072,
        maxTokens: 32768,
      },
      {
        id: "nvidia/nemotron-3-nano-30b-a3b",
        name: "NemoClaw Nemotron 3 Nano 30B",
        reasoning: true,
        input: ["text"],
        cost: NEMOCLAW_DEFAULT_COST,
        contextWindow: 1048576,
        maxTokens: 32768,
      },
      {
        id: "nvidia/llama-3.3-nemotron-super-49b-v1",
        name: "NemoClaw Nemotron 3 Super 49B",
        reasoning: true,
        input: ["text"],
        cost: NEMOCLAW_DEFAULT_COST,
        contextWindow: 131072,
        maxTokens: 32768,
      },
    ],
  };
}

/**
 * Resolves the implicit NemoClaw provider entry when credentials exist.
 * Credential precedence: NEMOCLAW_API_KEY env, nemoclaw auth profiles, then
 * the NVIDIA credential as a fallback (NemoClaw rides the NVIDIA endpoint).
 * Values follow upstream's marker convention (env-var name, not secret value).
 */
export function resolveNemoClawImplicitProvider(params: {
  env?: NodeJS.ProcessEnv;
  getAuthStore?: () => AuthProfileStore;
}): ProviderConfig | undefined {
  const env = params.env ?? process.env;
  const apiKey =
    resolveEnvApiKeyVarName("nemoclaw", env) ??
    resolveNemoClawProfileApiKey(env, params.getAuthStore) ??
    resolveEnvApiKeyVarName("nvidia", env);
  if (!apiKey) {
    return undefined;
  }
  return { ...buildNemoClawProvider(), apiKey };
}

function resolveNemoClawProfileApiKey(
  env: NodeJS.ProcessEnv,
  getAuthStore: (() => AuthProfileStore) | undefined,
): string | undefined {
  if (!getAuthStore) {
    return undefined;
  }
  try {
    return resolveApiKeyFromProfiles({ provider: "nemoclaw", store: getAuthStore(), env })?.apiKey;
  } catch {
    return undefined;
  }
}
