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

// ── Minimal structural types for @aws-sdk/client-secrets-manager ─────────────
// The package is an optional dependency (zero-dep policy for enterprise
// backends): it is lazy-loaded at runtime, and these local interfaces cover
// only the pieces this backend uses so the file typechecks without it.

type SmCommand<Output> = {
  /** Phantom field carrying the command's output type; never set at runtime. */
  readonly _smOutput?: Output;
};

type SecretsManagerClient = {
  send<Output>(command: SmCommand<Output>): Promise<Output>;
  destroy?(): void;
};

type GetSecretValueOutput = { SecretString?: string };

type ListSecretsOutput = {
  SecretList?: Array<{ Name?: string }>;
  NextToken?: string;
};

type AwsSmModule = {
  SecretsManagerClient: new (config: { region: string }) => SecretsManagerClient;
  GetSecretValueCommand: new (input: { SecretId: string }) => SmCommand<GetSecretValueOutput>;
  CreateSecretCommand: new (input: {
    Name: string;
    SecretString: string;
    Description?: string;
  }) => SmCommand<unknown>;
  UpdateSecretCommand: new (input: {
    SecretId: string;
    SecretString: string;
  }) => SmCommand<unknown>;
  DeleteSecretCommand: new (input: {
    SecretId: string;
    ForceDeleteWithoutRecovery?: boolean;
  }) => SmCommand<unknown>;
  ListSecretsCommand: new (input: {
    Filters?: Array<{ Key: string; Values: string[] }>;
    NextToken?: string;
  }) => SmCommand<ListSecretsOutput>;
};

// Widened to `string` so the compiler does not try to resolve the optional
// package's type declarations at the dynamic import sites below.
const AWS_SM_MODULE: string = "@aws-sdk/client-secrets-manager";

export function createAwsSmBackend(opts: AwsSmBackendOptions): SecretBackend {
  const prefix = opts.prefix ?? "openclaw/";

  // Lazy-load @aws-sdk/client-secrets-manager
  let client: SecretsManagerClient | null = null;

  async function getModule(): Promise<AwsSmModule> {
    try {
      return (await import(AWS_SM_MODULE)) as AwsSmModule;
    } catch {
      throw new Error(
        "AWS Secrets Manager backend requires @aws-sdk/client-secrets-manager. " +
          "Run: npm install @aws-sdk/client-secrets-manager",
      );
    }
  }

  async function getClient(): Promise<SecretsManagerClient> {
    if (!client) {
      const { SecretsManagerClient } = await getModule();
      client = new SecretsManagerClient({ region: opts.region });
    }
    return client;
  }

  function secretId(ref: string): string {
    return `${prefix}${ref}`.replace(/\/+/g, "/");
  }

  return {
    name: "aws-sm",

    async get(ref: string): Promise<string | null> {
      const { GetSecretValueCommand } = await getModule();
      const c = await getClient();
      try {
        const res = await c.send(new GetSecretValueCommand({ SecretId: secretId(ref) }));
        return res.SecretString ?? null;
      } catch (err: unknown) {
        const code = (err as { name?: string }).name;
        if (code === "ResourceNotFoundException") return null;
        throw err;
      }
    },

    async set(ref: string, value: string, meta?: SecretMetadata): Promise<void> {
      const { CreateSecretCommand, UpdateSecretCommand } = await getModule();
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
      const { DeleteSecretCommand } = await getModule();
      const c = await getClient();
      try {
        await c.send(
          new DeleteSecretCommand({ SecretId: secretId(ref), ForceDeleteWithoutRecovery: true }),
        );
      } catch (err: unknown) {
        const code = (err as { name?: string }).name;
        if (code === "ResourceNotFoundException") return;
        throw err;
      }
    },

    async list(): Promise<string[]> {
      const { ListSecretsCommand } = await getModule();
      const c = await getClient();
      const secrets: string[] = [];
      let nextToken: string | undefined;
      do {
        const res = await c.send(
          new ListSecretsCommand({
            Filters: [{ Key: "name", Values: [prefix] }],
            NextToken: nextToken,
          }),
        );
        for (const s of res.SecretList ?? []) {
          if (s.Name) secrets.push(s.Name.replace(new RegExp(`^${prefix}`), ""));
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
