import chalk from "chalk";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import type { loadConfig } from "../config/config.js";
import { getResolvedLoggerSettings } from "../logging.js";

const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "localhost"]);

function isExposedBindHost(host: string): boolean {
  return !LOOPBACK_ADDRS.has(host) && host !== "";
}

export function logGatewayStartup(params: {
  cfg: ReturnType<typeof loadConfig>;
  bindHost: string;
  bindHosts?: string[];
  port: number;
  tlsEnabled?: boolean;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
  };
  isNixMode: boolean;
}) {
  const { provider: agentProvider, model: agentModel } = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const modelRef = `${agentProvider}/${agentModel}`;
  params.log.info(`agent model: ${modelRef}`, {
    consoleMessage: `agent model: ${chalk.whiteBright(modelRef)}`,
  });
  const scheme = params.tlsEnabled ? "wss" : "ws";
  const formatHost = (host: string) => (host.includes(":") ? `[${host}]` : host);
  const hosts =
    params.bindHosts && params.bindHosts.length > 0 ? params.bindHosts : [params.bindHost];
  const primaryHost = hosts[0] ?? params.bindHost;
  params.log.info(
    `listening on ${scheme}://${formatHost(primaryHost)}:${params.port} (PID ${process.pid})`,
  );
  for (const host of hosts.slice(1)) {
    params.log.info(`listening on ${scheme}://${formatHost(host)}:${params.port}`);
  }
  params.log.info(`log file: ${getResolvedLoggerSettings().file}`);
  if (params.isNixMode) {
    params.log.info("gateway: running in Nix mode (config managed externally)");
  }

  // Emit security warning when the gateway is exposed on non-loopback interfaces
  if (isExposedBindHost(params.bindHost)) {
    const warn = params.log.warn ?? params.log.info;
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "  ⚠️  SECURITY WARNING: Gateway exposed on non-loopback interface",
      `  Bound to: ${params.bindHost}:${params.port}`,
      "  This gateway is reachable from the network.",
      "  Ensure a firewall or identity-aware proxy is in place.",
      "  Recommended: set gateway.bind=loopback for local use.",
      "  See: https://github.com/openclaw/openclaw/blob/main/docs/enterprise/security.md",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    const raw = lines.join("\n");
    warn(raw, {
      consoleMessage: chalk.yellow(raw),
    });
  }

  // Warn when auth mode is "none" — only acceptable on loopback
  const authMode = params.cfg.gateway?.auth?.mode;
  if (authMode === "none") {
    const warn = params.log.warn ?? params.log.info;
    warn('gateway auth mode is "none" — no authentication required for connections', {
      consoleMessage: chalk.yellow(
        '⚠️  gateway auth mode is "none" — all connections are accepted without credentials',
      ),
    });
  }
}
