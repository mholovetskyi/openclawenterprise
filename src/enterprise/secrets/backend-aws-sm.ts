/**
 * AWS Secrets Manager backend.
 *
 * Config:
 *   enterprise.secrets.backend: aws-sm
 *   enterprise.secrets.awsSm.region: us-east-1
 *   enterprise.secrets.awsSm.prefix: openclaw/   # optional key prefix
 *
 * Auth: uses standard AWS SDK credential chain
 *   (env vars, ~/.aws/credentials, IAM role, etc.)
 */

import type { SecretBackend, SecretMetadata } from "./index.js";

export type AwsSmBackendOptions = {
  region: string;
  prefix?: string;
};

export function createAwsSmBackend(opts: AwsSmBackendOptions): SecretBackend {
  const prefix = opts.prefix ?? "openclaw/";

  // Lazy-load @aws-sdk/client-secrets-manager
  let client: import("@aws-sdk/client-secrets-manager").SecretsManagerClient | null = null;

  async function getClient() {
    if (!client) {
      try {
        const { SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
        client = new SecretsManagerClient({ region: opts.region });
      } catch {
        throw new Error(
          "AWS Secrets Manager backend requires @aws-sdk/client-secrets-manager. " +
            "Run: npm install @aws-sdk/client-secrets-manager",
        );
      }
    }
    return client;
  }

  function secretId(ref: string): string {
    return `${prefix}${ref}`.replace(/\/+/g, "/");
  }

  return {
    name: "aws-sm",

    async get(ref: string): Promise<string | null> {
      const { GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
      const c = await getClient();
      try {
        const res = await c.send(new GetSecretValueCommand({ SecretId: secretId(ref) }));
        return res.SecretString ?? null;
      } catch (err: unknown) {
        const code = (err as { name?: string }).name;
        if (code === "ResourceNotFoundException") {return null;}
        throw err;
      }
    },

    async set(ref: string, value: string, meta?: SecretMetadata): Promise<void> {
      const {
        CreateSecretCommand,
        UpdateSecretCommand,
      } = await import("@aws-sdk/client-secrets-manager");
      const c = await getClient();
      const id = secretId(ref);
      try {
        await c.send(new UpdateSecretCommand({ SecretId: id, SecretString: value }));
      } catch (err: unknown) {
        const code = (err as { name?: string }).name;
        if (code === "ResourceNotFoundException") {
          await c.send(
            new CreateSecretCommand({
              Name: id,
              SecretString: value,
              Description: meta?.description,
            }),
          );
        } else {
          throw err;
        }
      }
    },

    async delete(ref: string): Promise<void> {
      const { DeleteSecretCommand } = await import("@aws-sdk/client-secrets-manager");
      const c = await getClient();
      try {
        await c.send(
          new DeleteSecretCommand({ SecretId: secretId(ref), ForceDeleteWithoutRecovery: true }),
        );
      } catch (err: unknown) {
        const code = (err as { name?: string }).name;
        if (code === "ResourceNotFoundException") {return;}
        throw err;
      }
    },

    async list(): Promise<string[]> {
      const { ListSecretsCommand } = await import("@aws-sdk/client-secrets-manager");
      const c = await getClient();
      const secrets: string[] = [];
      let nextToken: string | undefined;
      do {
        const res = await c.send(
          new ListSecretsCommand({ Filters: [{ Key: "name", Values: [prefix] }], NextToken: nextToken }),
        );
        for (const s of res.SecretList ?? []) {
          if (s.Name) {secrets.push(s.Name.replace(new RegExp(`^${prefix}`), ""));}
        }
        nextToken = res.NextToken;
      } while (nextToken);
      return secrets;
    },

    async exists(ref: string): Promise<boolean> {
      const val = await this.get(ref);
      return val !== null;
    },

    async shutdown(): Promise<void> {
      client?.destroy?.();
      client = null;
    },
  };
}
