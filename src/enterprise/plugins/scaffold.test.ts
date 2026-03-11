import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { scaffoldPlugin, validateScaffoldOptions } from "./scaffold.js";

describe("scaffold", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("validateScaffoldOptions", () => {
    it("accepts valid options", () => {
      const errors = validateScaffoldOptions({
        name: "my-plugin",
        capabilities: ["audit-sink"],
      });
      expect(errors).toHaveLength(0);
    });

    it("rejects invalid name", () => {
      const errors = validateScaffoldOptions({
        name: "My Plugin!",
        capabilities: ["audit-sink"],
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("lowercase");
    });

    it("rejects empty capabilities", () => {
      const errors = validateScaffoldOptions({
        name: "my-plugin",
        capabilities: [],
      });
      expect(errors).toHaveLength(1);
    });

    it("rejects invalid capability", () => {
      const errors = validateScaffoldOptions({
        name: "my-plugin",
        capabilities: ["invalid-cap"],
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("scaffoldPlugin", () => {
    it("creates plugin directory with all files", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const result = scaffoldPlugin({
        name: "test-plugin",
        capabilities: ["audit-sink"],
        outputDir: tmpDir,
      });

      expect(result.files).toHaveLength(5);
      expect(fs.existsSync(path.join(result.dir, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, "tsconfig.json"))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, "vitest.config.ts"))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, "index.ts"))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, "index.test.ts"))).toBe(true);
    });

    it("generates valid package.json", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const result = scaffoldPlugin({
        name: "my-sink",
        capabilities: ["audit-sink"],
        author: "Test Author",
        outputDir: tmpDir,
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(result.dir, "package.json"), "utf8"));
      expect(pkg.name).toBe("@openclaw/plugin-my-sink");
      expect(pkg.author).toBe("Test Author");
      expect(pkg.peerDependencies["@openclaw/integration-sdk"]).toBeDefined();
    });

    it("includes audit sink when capability selected", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const result = scaffoldPlugin({
        name: "my-sink",
        capabilities: ["audit-sink"],
        outputDir: tmpDir,
      });

      const indexContent = fs.readFileSync(path.join(result.dir, "index.ts"), "utf8");
      expect(indexContent).toContain("BaseBatchedAuditSink");
      expect(indexContent).toContain("MySinkAuditSink");
      expect(indexContent).toContain("flushBatch");
    });

    it("includes secret backend when capability selected", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const result = scaffoldPlugin({
        name: "my-vault",
        capabilities: ["secret-backend"],
        outputDir: tmpDir,
      });

      const indexContent = fs.readFileSync(path.join(result.dir, "index.ts"), "utf8");
      expect(indexContent).toContain("SecretBackend");
      expect(indexContent).toContain("MyVaultSecretBackend");
    });

    it("includes guardrail rule when capability selected", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const result = scaffoldPlugin({
        name: "my-guard",
        capabilities: ["guardrail-rule"],
        outputDir: tmpDir,
      });

      const indexContent = fs.readFileSync(path.join(result.dir, "index.ts"), "utf8");
      expect(indexContent).toContain("GuardrailRule");
      expect(indexContent).toContain("MyGuardGuardrailRule");
    });

    it("supports multiple capabilities", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const result = scaffoldPlugin({
        name: "multi",
        capabilities: ["audit-sink", "secret-backend", "guardrail-rule"],
        outputDir: tmpDir,
      });

      const indexContent = fs.readFileSync(path.join(result.dir, "index.ts"), "utf8");
      expect(indexContent).toContain("BaseBatchedAuditSink");
      expect(indexContent).toContain("SecretBackend");
      expect(indexContent).toContain("GuardrailRule");
    });

    it("throws on existing directory", () => {
      tmpDir = fs.mkdtempSync("/tmp/scaffold-test-");
      const pluginDir = path.join(tmpDir, "existing");
      fs.mkdirSync(pluginDir);

      expect(() =>
        scaffoldPlugin({
          name: "existing",
          capabilities: ["audit-sink"],
          outputDir: tmpDir,
        }),
      ).toThrow("already exists");
    });

    it("throws on invalid options", () => {
      expect(() =>
        scaffoldPlugin({
          name: "",
          capabilities: [],
        }),
      ).toThrow("Invalid scaffold options");
    });
  });
});
