/**
 * Enhanced Static Analysis Security Testing (SAST) for skills.
 * Extends the built-in skill-scanner with enterprise-grade rules.
 */

import type { SkillScanFinding, SkillScanSummary } from "../../../skills/security/scanner.js";

// ── Additional enterprise scan rules ──────────────────────────────────────────

export type EnterpriseSkillScanRule = {
  id: string;
  severity: "info" | "warn" | "critical";
  message: string;
  pattern: RegExp;
  description: string;
  cwe?: string;   // CWE reference
  owasp?: string; // OWASP category
};

export const ENTERPRISE_SCAN_RULES: EnterpriseSkillScanRule[] = [
  // Credential harvesting
  {
    id: "cred-harvest-env",
    severity: "critical",
    message: "Potential credential harvesting via environment variable enumeration",
    pattern: /process\.env\b(?!\.(NODE_|npm_|PATH|HOME|USER|SHELL))/g,
    description: "Skill enumerates potentially sensitive environment variables",
    cwe: "CWE-522",
  },
  {
    id: "cred-harvest-exfil",
    severity: "critical",
    message: "Potential credential exfiltration via HTTP",
    pattern: /fetch\s*\(.*\$\{?(API_KEY|SECRET|TOKEN|PASSWORD|PASS|KEY)\b/gi,
    description: "Skill may be sending credentials to external endpoints",
    cwe: "CWE-319",
    owasp: "A02:2021",
  },

  // Reverse shells
  {
    id: "reverse-shell-tcp",
    severity: "critical",
    message: "Reverse shell pattern detected (TCP)",
    pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp|0>&1\s*2>&1|\/dev\/tcp\/[0-9]/g,
    description: "Skill contains reverse shell TCP redirect pattern",
    cwe: "CWE-78",
  },
  {
    id: "reverse-shell-nc",
    severity: "critical",
    message: "Netcat reverse shell pattern detected",
    pattern: /nc(?:at)?\s+(?:-e|-c)\s+(?:\/bin\/(?:bash|sh)|cmd)/gi,
    description: "Skill uses netcat with shell execution flag",
    cwe: "CWE-78",
  },

  // Persistence mechanisms
  {
    id: "persistence-crontab",
    severity: "warn",
    message: "Crontab modification detected",
    pattern: /crontab\s+-[lie]|\/etc\/cron\./g,
    description: "Skill modifies cron jobs — verify this is intentional",
    cwe: "CWE-829",
  },
  {
    id: "persistence-autostart",
    severity: "warn",
    message: "System autostart modification detected",
    pattern: /LaunchAgents|LaunchDaemons|\.service\s+enable|systemctl\s+enable/g,
    description: "Skill modifies system autostart entries",
  },

  // Code injection
  {
    id: "code-injection-vm",
    severity: "critical",
    message: "Dynamic code execution via vm module",
    pattern: /require\s*\(\s*['"]vm['"]\s*\).*\.runInNewContext|new\s+Function\s*\(/g,
    description: "Skill uses vm.runInNewContext or new Function() for dynamic execution",
    cwe: "CWE-94",
  },
  {
    id: "code-injection-eval",
    severity: "critical",
    message: "eval() detected",
    pattern: /\beval\s*\(/g,
    description: "Skill uses eval() which can execute arbitrary code",
    cwe: "CWE-95",
    owasp: "A03:2021",
  },

  // Prototype pollution
  {
    id: "prototype-pollution",
    severity: "warn",
    message: "Potential prototype pollution",
    pattern: /__proto__|constructor\s*\[|prototype\s*\[/g,
    description: "Skill accesses __proto__ or prototype, potential pollution vector",
    cwe: "CWE-1321",
  },

  // Deserialization
  {
    id: "unsafe-deserialization",
    severity: "critical",
    message: "Unsafe deserialization detected",
    pattern: /serialize-javascript|node-serialize|\.deserialize\s*\(/g,
    description: "Skill uses potentially unsafe deserialization",
    cwe: "CWE-502",
    owasp: "A08:2021",
  },

  // Path traversal
  {
    id: "path-traversal",
    severity: "warn",
    message: "Potential path traversal",
    pattern: /\.\.\//g,
    description: "Skill uses relative path traversal — verify paths are sanitized",
    cwe: "CWE-22",
    owasp: "A01:2021",
  },

  // Supply chain
  {
    id: "package-install-script",
    severity: "warn",
    message: "Package installation with scripts enabled",
    pattern: /npm\s+install(?!\s+--ignore-scripts)|pnpm\s+add(?!\s+--ignore-scripts)/g,
    description: "Skill installs packages without --ignore-scripts flag",
  },
  {
    id: "curl-pipe-bash",
    severity: "critical",
    message: "curl|bash pattern detected",
    pattern: /curl\b.*\|\s*(?:sudo\s+)?(?:ba)?sh\b/g,
    description: "Skill downloads and executes remote scripts — supply chain risk",
    cwe: "CWE-494",
  },
];

export type EnterpriseSkillScanResult = {
  base: SkillScanSummary;
  enterprise: {
    critical: number;
    warn: number;
    info: number;
    findings: Array<
      SkillScanFinding & { cwe?: string; owasp?: string; description: string }
    >;
  };
  riskScore: number; // 0-100
  recommendation: "approve" | "review" | "reject";
};

/**
 * Run enterprise SAST on a skill directory.
 */
export async function runEnterpriseScan(
  skillDir: string,
): Promise<EnterpriseSkillScanResult> {
  // Run base scanner first
  const { scanDirectoryWithSummary } = await import("../../../skills/security/scanner.js");
  const base = await scanDirectoryWithSummary(skillDir);

  const enterpriseFindings: EnterpriseSkillScanResult["enterprise"]["findings"] = [];

  // Run enterprise rules
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join, extname } = await import("node:path");

  function walkFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          results.push(...walkFiles(full));
        } else if (entry.isFile()) {
          results.push(full);
        }
      }
    } catch { /* ignore */ }
    return results;
  }

  const scriptExts = new Set([".js", ".ts", ".mjs", ".cjs", ".sh", ".bash"]);
  for (const file of walkFiles(skillDir)) {
    if (!scriptExts.has(extname(file).toLowerCase())) continue;
    let content: string;
    try { content = readFileSync(file, "utf8"); } catch { continue; }

    const lines = content.split("\n");
    for (const rule of ENTERPRISE_SCAN_RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.slice(0, match.index);
        const lineNum = beforeMatch.split("\n").length;
        enterpriseFindings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file,
          line: lineNum,
          message: rule.message,
          evidence: lines[lineNum - 1]?.trim() ?? "",
          cwe: rule.cwe,
          owasp: rule.owasp,
          description: rule.description,
        });
        if (!rule.pattern.global) break;
      }
    }
  }

  const critical = base.critical + enterpriseFindings.filter((f) => f.severity === "critical").length;
  const warn = base.warn + enterpriseFindings.filter((f) => f.severity === "warn").length;
  const info = base.info + enterpriseFindings.filter((f) => f.severity === "info").length;

  // Risk score: 0-100
  const riskScore = Math.min(100, critical * 40 + warn * 10 + info * 2);

  const recommendation: EnterpriseSkillScanResult["recommendation"] =
    critical > 0 ? "reject" : warn > 2 ? "review" : "approve";

  return {
    base,
    enterprise: { critical, warn, info, findings: enterpriseFindings },
    riskScore,
    recommendation,
  };
}
