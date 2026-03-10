# Deploying OpenClaw Enterprise as a Foundry Compute Module

This guide covers building, pushing, and running OpenClaw Enterprise inside Palantir Foundry's Compute Module infrastructure.

## Prerequisites

- Palantir Foundry enrollment with Compute Modules enabled
- Docker installed locally (Docker Desktop or Docker Engine)
- Foundry Artifact Repository created for container images
- Network access to push images to Foundry's container registry
- An LLM provider API key (Anthropic or OpenAI)

## 1. Build the Container Image

The `Dockerfile.foundry` produces an image that meets all Compute Module requirements:

- `linux/amd64` platform
- Non-root numeric user (UID 5000)
- `/bin/sh` available
- Port 3284 (within allowed range 1024–65535)

```bash
docker build --platform linux/amd64 \
  -f Dockerfile.foundry \
  -t openclaw-enterprise:v1.0.0 .
```

**Always use explicit version tags** — Foundry does not allow `:latest`.

## 2. Push to Foundry Artifact Repository

Tag the image with your Foundry Artifact Registry URL:

```bash
# Replace with your Foundry artifact registry URL
docker tag openclaw-enterprise:v1.0.0 \
  <your-foundry-registry>/openclaw-enterprise:v1.0.0

docker push <your-foundry-registry>/openclaw-enterprise:v1.0.0
```

Refer to your Foundry Artifact Repository documentation for registry authentication details. Typically this involves `docker login` with a Foundry service user token.

## 3. Create the Compute Module

In the Foundry UI:

1. Navigate to **Compute Modules** in the left sidebar
2. Click **Create Compute Module**
3. Select **Container** as the module type
4. Choose your pushed image (`openclaw-enterprise:v1.0.0`)
5. **Execution mode**: Select **Functions with Application permissions** (recommended for most use cases)
6. **Container configuration**:
   - Port: `3284`
   - Health check path: `/healthz`
   - Memory: 512 MB minimum, 1 GB recommended
   - CPU: 0.5 cores minimum, 1 core recommended

## 4. Configure Sources (External Access)

Foundry's zero-trust networking blocks all external access by default. You must configure **Data Connection sources** for each external endpoint OpenClaw needs to reach:

### Required sources

| Source name   | Endpoint                    | Purpose                            |
| ------------- | --------------------------- | ---------------------------------- |
| Anthropic API | `https://api.anthropic.com` | LLM inference (if using Anthropic) |
| OpenAI API    | `https://api.openai.com`    | LLM inference (if using OpenAI)    |

### Optional sources (depends on your configuration)

| Source name         | Endpoint                                        | Purpose           |
| ------------------- | ----------------------------------------------- | ----------------- |
| HashiCorp Vault     | `https://vault.yourcompany.com`                 | Secret management |
| AWS Secrets Manager | `https://secretsmanager.<region>.amazonaws.com` | Secret management |
| NVIDIA NIM          | `https://integrate.api.nvidia.com`              | NIM inference     |

For each source:

1. Navigate to **Data Connection** in the left sidebar
2. Click **Create source**
3. Select **REST API** as the type
4. Enter the endpoint URL
5. Configure authentication (API key header or OAuth)
6. Link the source to your Compute Module

## 5. Set Environment Variables

Configure environment variables in the Compute Module's **Source configuration**:

| Variable                 | Required                 | Description                           |
| ------------------------ | ------------------------ | ------------------------------------- |
| `PALANTIR_STACK_URL`     | Yes (for audit sink)     | Your Foundry stack URL                |
| `PALANTIR_CLIENT_ID`     | Yes (for audit sink)     | Developer Console app client ID       |
| `PALANTIR_CLIENT_SECRET` | Yes (for audit sink)     | OAuth client secret                   |
| `OPENCLAW_MASTER_KEY`    | Recommended              | Base64-encoded 32-byte encryption key |
| `ANTHROPIC_API_KEY`      | Yes (if using Anthropic) | Anthropic API key                     |
| `OPENAI_API_KEY`         | Yes (if using OpenAI)    | OpenAI API key                        |

Sensitive values should be stored as **secrets** in the Compute Module source configuration, not as plaintext environment variables.

## 6. Start and Verify

1. Click **Start** on the Compute Module
2. Wait for the health check to pass (green status indicator)
3. Check the container logs for startup messages
4. Verify the health endpoint:

```bash
# From within Foundry's network, or via a configured source
curl http://<compute-module-host>:3284/healthz
```

Expected response:

```json
{ "status": "ok" }
```

## 7. Send a Test Message

Once the Compute Module is running, send a test message through the OpenClaw API:

```bash
curl -X POST http://<compute-module-host>:3284/api/v1/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"message": "Hello from Foundry!"}'
```

## Troubleshooting

### Image push fails

- Verify you are authenticated to the Foundry Artifact Registry
- Ensure the image is built for `linux/amd64` (not `arm64`)
- Check that the image tag is not `:latest`

### Compute Module fails to start

- Check container logs for startup errors
- Verify all required environment variables are set
- Ensure the port (3284) is not conflicting with reserved ports (8945, 8946)

### External API calls fail

- Foundry blocks all external traffic by default
- Create Data Connection sources for each external endpoint
- Verify the source is linked to the Compute Module

### Health check fails

- The `/healthz` endpoint should respond within 5 seconds
- Check if the Node.js process started successfully in logs
- Verify memory allocation is sufficient (minimum 512 MB)

### Audit events not appearing in Foundry

- Verify the streaming dataset exists and the service user has write permissions
- Check that `PALANTIR_CLIENT_ID` and `PALANTIR_CLIENT_SECRET` are correct
- Look for `[palantir-sink]` log messages for specific error details
