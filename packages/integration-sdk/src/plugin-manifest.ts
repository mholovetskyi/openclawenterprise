/**
 * Plugin manifest — declares what a plugin provides and its metadata.
 */

export type PluginCapability = "audit-sink" | "secret-backend" | "guardrail-rule";

export type PluginManifest = {
  /** Unique plugin identifier (e.g. "datadog", "splunk", "snowflake") */
  name: string;
  /** SemVer version string */
  version: string;
  /** Human-readable description */
  description: string;
  /** Author or organization */
  author?: string;
  /** Minimum OpenClaw version required */
  minOpenClawVersion?: string;
  /** Capabilities this plugin provides */
  capabilities: PluginCapability[];
  /** Required configuration keys (validated at load time) */
  configSchema?: Record<string, ConfigFieldSchema>;
};

export type ConfigFieldSchema = {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  /** If true, value may be a secret reference (e.g. env://FOO) */
  secret?: boolean;
};
