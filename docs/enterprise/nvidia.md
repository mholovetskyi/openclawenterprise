# NVIDIA AI infrastructure integration

OpenClaw Enterprise integrates natively with NVIDIA's agentic AI stack — NIM inference microservices, Nemotron 3 model family (including the new Nemotron 3 Super 120B), and GPU monitoring. Run enterprise-hardened AI agents on NVIDIA hardware with full observability, access control, and cost governance.

## Overview

The NVIDIA integration provides four capabilities:

1. **NIM Model Provider** — Use Nemotron 3 models via NVIDIA NIM (hosted or self-hosted) as a first-class model provider
2. **GPU Monitoring** — Collect GPU utilization, memory, temperature, and power metrics via `nvidia-smi` and export to Prometheus
3. **Guardrail Rules** — Enforce thinking budgets, token cost limits, and RBAC-based model routing for Nemotron models
4. **Kubernetes Sidecar** — Deploy NIM inference containers alongside OpenClaw in the same pod

### Relationship to NemoClaw / NeMo / NIM

- **NIM** (NVIDIA Inference Microservices) provides OpenAI-compatible API endpoints for NVIDIA models. OpenClaw uses NIM as its inference backend.
- **NeMo** is NVIDIA's framework for training and customizing LLMs. Models trained with NeMo are served via NIM.
- **NemoClaw** is NVIDIA's upcoming enterprise AI agent platform. OpenClaw Enterprise integrates with the same NVIDIA stack that NemoClaw targets, providing compatibility before NemoClaw ships.

## NIM Model Provider

### Configuration

```yaml
enterprise:
  enabled: true
  nvidia:
    nim:
      enabled: true
      endpoint: "https://integrate.api.nvidia.com/v1"
      apiKey: env://NIM_API_KEY
      defaultModel: "nvidia/nemotron-3-nano-30b-a3b"
      models:
        - id: "nvidia/nemotron-3-nano-30b-a3b"
          displayName: "Nemotron 3 Nano 30B"
          contextWindow: 1048576
          maxOutputTokens: 32768
          capabilities: [chat, tool-calling, reasoning]
          thinkingBudget: configurable
        - id: "nvidia/nemotron-3-super-120b-a12b"
          displayName: "Nemotron 3 Super 120B"
          contextWindow: 1048576
          maxOutputTokens: 32768
          capabilities: [chat, tool-calling, reasoning, multi-agent, agentic-reasoning]
          thinkingBudget: configurable
        - id: "nvidia/llama-3.3-nemotron-super-49b-v1"
          displayName: "Nemotron 3 Super 49B"
          contextWindow: 131072
          maxOutputTokens: 32768
          capabilities: [chat, tool-calling, reasoning, multi-agent]
        - id: "nvidia/llama-3.1-nemotron-nano-8b-v1"
          displayName: "Nemotron Nano 8B"
          contextWindow: 131072
          maxOutputTokens: 32768
          capabilities: [chat, tool-calling]
      healthCheck:
        enabled: true
        intervalMs: 30000
        endpoint: "/v1/models"
      retry:
        maxRetries: 3
        backoffMs: 1000
        maxBackoffMs: 30000
```

### API key via secret references

The `apiKey` field supports all secret reference schemes:

```yaml
# Environment variable
apiKey: env://NIM_API_KEY

# HashiCorp Vault
apiKey: vault://secret/nvidia/nim#api_key

# AWS Secrets Manager
apiKey: aws-sm://nvidia/nim-api-key

# GCP Secret Manager
apiKey: gcp-sm://projects/my-project/secrets/nim-api-key

# Azure Key Vault
apiKey: azure-kv://nim-api-key
```

### Self-hosted vs NVIDIA-hosted

**NVIDIA-hosted** (default): Use `https://integrate.api.nvidia.com/v1` with an API key from NVIDIA. No GPU hardware required.

**Self-hosted**: Point to your own NIM container endpoint. When using the Kubernetes sidecar, set `endpoint: "http://localhost:8000/v1"`.

```yaml
# Self-hosted NIM
enterprise:
  nvidia:
    nim:
      enabled: true
      endpoint: "http://localhost:8000/v1"
      # No API key needed for local NIM
```

### Model capability matrix

| Model                 | Params (Total/Active) | Context     | Max Output | Thinking            | Tool Calling | Multi-Agent | Agentic Reasoning |
| --------------------- | --------------------- | ----------- | ---------- | ------------------- | ------------ | ----------- | ----------------- |
| Nemotron 3 Super 120B | 120B / 12B            | 1M tokens   | 32K        | Configurable budget | Yes          | Yes         | Yes               |
| Nemotron 3 Nano 30B   | 31.6B / 3.6B          | 1M tokens   | 32K        | Configurable budget | Yes          | No          | No                |
| Nemotron 3 Super 49B  | 49B                   | 128K tokens | 32K        | No                  | Yes          | Yes         | No                |
| Nemotron Nano 8B      | 8B                    | 128K tokens | 32K        | No                  | Yes          | No          | No                |

### Nemotron 3 Super 120B

The flagship model in the Nemotron 3 family. Uses a hybrid Mamba-Transformer architecture with Latent Mixture-of-Experts (LatentMoE), activating only 12B of its 120B parameters per token for maximum efficiency. Supports Multi-Token Prediction (MTP) for up to 3x faster inference on reasoning tasks, and delivers up to 5x higher throughput than the previous Nemotron Super generation.

Key features:

- **1M token context window** — retain full workflow state for complex agentic pipelines
- **Agentic reasoning** — purpose-built for multi-step tool use and autonomous agent workflows
- **NVFP4 quantization** — trained natively in 4-bit precision on Blackwell architecture
- **Configurable thinking budget** — control reasoning depth vs. latency tradeoff

```yaml
enterprise:
  nvidia:
    nim:
      defaultModel: "nvidia/nemotron-3-super-120b-a12b"
```

### Thinking budget (Nemotron 3 Nano and Super)

Nemotron 3 Nano 30B and Nemotron 3 Super 120B support a configurable thinking budget — a parameter that controls how many tokens the model spends on internal reasoning before producing output. Higher budgets produce more thorough reasoning at the cost of latency and token usage.

```typescript
// Works with both Nemotron 3 Nano 30B and Nemotron 3 Super 120B
const response = await nimProvider.chatCompletion({
  model: "nvidia/nemotron-3-super-120b-a12b",
  messages: [{ role: "user", content: "Analyze this complex scenario..." }],
  thinkingBudgetTokens: 4096,
});
```

### Fallback behavior

When NIM is unreachable and `fallbackModel` is configured, requests are routed to the fallback provider with an audit event:

```yaml
enterprise:
  nvidia:
    nim:
      enabled: true
      fallbackModel: "openai/gpt-4"
```

### Prometheus metrics

| Metric                         | Type      | Labels           | Description                      |
| ------------------------------ | --------- | ---------------- | -------------------------------- |
| `openclaw_nim_requests_total`  | Counter   | model, status    | Total NIM inference requests     |
| `openclaw_nim_latency_seconds` | Histogram | model            | Request latency distribution     |
| `openclaw_nim_tokens_total`    | Counter   | model, direction | Token consumption (input/output) |
| `openclaw_nim_health_status`   | Gauge     | endpoint         | Health status (0=down, 1=up)     |

### Audit events

| Action                | Category | Description                         |
| --------------------- | -------- | ----------------------------------- |
| `nvidia.nim.request`  | system   | Successful inference request        |
| `nvidia.nim.error`    | system   | Failed inference request            |
| `nvidia.nim.fallback` | system   | Request routed to fallback provider |

## GPU monitoring

### Setup

GPU monitoring requires `nvidia-smi` to be available on the host. It is automatically included with NVIDIA driver installations.

```yaml
enterprise:
  nvidia:
    gpuMetrics:
      enabled: true
      pollIntervalMs: 15000
      alertThresholds:
        gpuUtilization: 95
        memoryUtilization: 90
        temperature: 85
        powerDraw: 95
```

If `nvidia-smi` is not found, GPU metrics are silently disabled with a single warning log. The gateway continues to function normally.

### Metric reference

| Metric                                    | Type  | Labels              | Description             |
| ----------------------------------------- | ----- | ------------------- | ----------------------- |
| `openclaw_nvidia_gpu_utilization_percent` | Gauge | gpu_index, gpu_name | GPU compute utilization |
| `openclaw_nvidia_gpu_memory_used_bytes`   | Gauge | gpu_index, gpu_name | GPU memory in use       |
| `openclaw_nvidia_gpu_memory_total_bytes`  | Gauge | gpu_index, gpu_name | Total GPU memory        |
| `openclaw_nvidia_gpu_temperature_celsius` | Gauge | gpu_index, gpu_name | GPU temperature         |
| `openclaw_nvidia_gpu_power_watts`         | Gauge | gpu_index, gpu_name | Current power draw      |
| `openclaw_nvidia_gpu_power_limit_watts`   | Gauge | gpu_index, gpu_name | Power limit             |

### Threshold alerting

When a metric exceeds its threshold, an audit event `nvidia.gpu.threshold_exceeded` is emitted with the GPU index, metric name, current value, and threshold. Configure alert thresholds based on your hardware and workload:

- **gpuUtilization**: Sustained >95% may indicate queuing. Consider scaling out.
- **memoryUtilization**: >90% risks OOM kills for NIM containers.
- **temperature**: >85C triggers thermal throttling on most GPUs.
- **powerDraw**: >95% of power limit indicates the GPU is operating at maximum capacity.

### Grafana dashboard

Import the Prometheus metrics into Grafana using the metric names above. A sample dashboard query for GPU utilization:

```promql
openclaw_nvidia_gpu_utilization_percent{gpu_name=~".*"}
```

## Kubernetes with NIM sidecar

### Prerequisites

1. **NVIDIA GPU Operator** or device plugin installed on the cluster
2. **NGC credentials** for pulling NIM container images from `nvcr.io`

### Step 1: Create NGC pull secret

```bash
kubectl create secret docker-registry ngc-secret \
  --docker-server=nvcr.io \
  --docker-username='$oauthtoken' \
  --docker-password='<your-ngc-api-key>'
```

### Step 2: Configure GPU nodes

Ensure GPU nodes have the NVIDIA device plugin:

```bash
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.0/deployments/static/nvidia-device-plugin.yml
```

Verify GPU availability:

```bash
kubectl describe nodes | grep nvidia.com/gpu
```

### Step 3: Deploy with Helm

```bash
helm install openclaw ./k8s/helm/openclaw \
  -f k8s/examples/nvidia-nim-sidecar.yaml
```

Or configure values directly:

```yaml
nvidia:
  nim:
    enabled: true
    image:
      repository: nvcr.io/nim/nvidia/llama-3.1-nemotron-nano-8b-v1
      tag: "1.8.6"
    resources:
      limits:
        nvidia.com/gpu: 1
      requests:
        nvidia.com/gpu: 1
    port: 8000
    healthCheck:
      path: /v1/health/ready
      initialDelaySeconds: 120
      periodSeconds: 30
    modelCache:
      enabled: true
      size: 50Gi
    imagePullSecrets:
      - name: ngc-secret
    runtimeClassName: nvidia
    nodeSelector:
      nvidia.com/gpu.present: "true"
    tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
```

### Step 4: Verify

```bash
# Check pod status (NIM takes 2-5 minutes to load the model)
kubectl get pods -l app.kubernetes.io/name=openclaw -w

# Check NIM health
kubectl exec deploy/openclaw -c nim -- curl -s localhost:8000/v1/health/ready

# List available models
kubectl exec deploy/openclaw -c openclaw -- curl -s localhost:8000/v1/models

# Check OpenClaw logs
kubectl logs deploy/openclaw -c openclaw --tail=50
```

## Guardrail rules

### Thinking budget limit

Prevents runaway reasoning costs by capping thinking tokens per request on Nemotron 3 Nano and Super:

```yaml
enterprise:
  guardrails:
    nvidia:
      thinkingBudgetLimit:
        enabled: true
        maxThinkingTokens: 4096
        action: require-approval # block | require-approval | warn
```

### Cost guard

Track cumulative token usage and enforce limits per user or per tenant:

```yaml
enterprise:
  guardrails:
    nvidia:
      costGuard:
        enabled: true
        limits:
          - scope: per-user
            period: hourly
            maxTokens: 500000
            action: warn
          - scope: per-tenant
            period: daily
            maxTokens: 10000000
            action: require-approval
```

### Model routing policy

Restrict which models each RBAC role can access:

```yaml
enterprise:
  guardrails:
    nvidia:
      modelRoutingPolicy:
        enabled: true
        roleModelMap:
          viewer: ["nvidia/llama-3.1-nemotron-nano-8b-v1"]
          operator:
            - "nvidia/llama-3.1-nemotron-nano-8b-v1"
            - "nvidia/nemotron-3-nano-30b-a3b"
          power-user:
            - "nvidia/llama-3.1-nemotron-nano-8b-v1"
            - "nvidia/nemotron-3-nano-30b-a3b"
            - "nvidia/nemotron-3-super-120b-a12b"
          admin: ["*"]
          super-admin: ["*"]
```

## Architecture

```
                     ┌─────────────────────────────────────────────┐
                     │              INBOUND CHANNELS                │
                     │  WhatsApp · Telegram · Slack · Discord · ... │
                     └──────────────────────┬──────────────────────┘
                                            │
                     ┌──────────────────────▼──────────────────────┐
                     │         ENTERPRISE SECURITY LAYER            │
                     │  Input sanitizer · Guardrails · RBAC         │
                     │  Thinking budget · Cost guard · Model policy  │
                     └──────────────────────┬──────────────────────┘
                                            │
┌────────────────┐   ┌──────────────────────▼──────────────────────┐   ┌────────────────┐
│  AUDIT LOG     │   │                  GATEWAY                     │   │  SECRETS       │
│  SHA-256 chain │◄──┤  WebSocket · HTTP API · /metrics · /healthz  ├──►│  Vault/AWS/GCP │
└────────────────┘   └──────────────────────┬──────────────────────┘   └────────────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          │                 │                 │
                   ┌──────▼──────┐   ┌──────▼──────┐   ┌─────▼──────┐
                   │ NIM Provider │   │ OpenAI/     │   │ Other      │
                   │             │   │ Anthropic   │   │ Providers  │
                   └──────┬──────┘   └─────────────┘   └────────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       ┌──────▼──────┐    │    ┌──────▼──────┐
       │ NIM Sidecar │    │    │ NVIDIA      │
       │ (localhost) │    │    │ Hosted NIM  │
       │ Nemotron 3  │    │    │ API         │
       └──────┬──────┘    │    └─────────────┘
              │           │
       ┌──────▼──────┐    │
       │ NVIDIA GPU  │◄───┘
       │ nvidia-smi  │
       │ Prometheus  │
       └─────────────┘
```

## Troubleshooting

### NIM container OOM

NIM models require significant GPU memory. If the NIM container is OOM-killed:

- Check GPU memory with `nvidia-smi`
- Use a smaller model (Nano 8B requires ~16GB, Nano 30B requires ~40GB, Super 120B requires ~80GB with NVFP4)
- Ensure no other processes are consuming GPU memory

### GPU not detected

If `nvidia-smi` returns "command not found":

- Install NVIDIA drivers: `apt install nvidia-driver-535` (Ubuntu)
- For Kubernetes, ensure the NVIDIA device plugin is deployed
- Verify with `kubectl describe node | grep nvidia.com/gpu`

### NGC authentication failures

If NIM container fails to pull from `nvcr.io`:

```bash
# Verify NGC credentials
docker login nvcr.io -u '$oauthtoken' -p '<NGC_API_KEY>'

# Recreate K8s secret
kubectl delete secret ngc-secret
kubectl create secret docker-registry ngc-secret \
  --docker-server=nvcr.io \
  --docker-username='$oauthtoken' \
  --docker-password='<NGC_API_KEY>'
```

### Model loading timeout

NIM model loading takes 2-5 minutes. If the startup probe fails:

- Increase `healthCheck.initialDelaySeconds` (default: 120)
- Increase `healthCheck.failureThreshold` (default: 30)
- Check NIM logs: `kubectl logs deploy/openclaw -c nim`
- Ensure the model cache PVC is enabled to avoid re-downloading

### Thinking budget exceeded

If requests are blocked by the thinking budget guardrail:

- Increase `maxThinkingTokens` in the guardrail config
- Change the action to `warn` instead of `block`/`require-approval`
- Nemotron 3 Nano 30B and Nemotron 3 Super 120B support configurable thinking budgets

## FAQ

**Does this require NVIDIA GPUs?**

No. The NVIDIA-hosted NIM endpoint (`integrate.api.nvidia.com`) works on any hardware. GPU monitoring and the NIM sidecar require NVIDIA GPUs, but the NIM model provider works without them.

**Is this NemoClaw?**

No. OpenClaw Enterprise integrates with the NVIDIA AI stack (NIM, Nemotron models, GPU monitoring) that NemoClaw will also use. This provides compatibility with the NVIDIA ecosystem before NemoClaw ships.

**Which Nemotron model should I use?**

| Use Case                        | Recommended Model                              |
| ------------------------------- | ---------------------------------------------- |
| Cost-sensitive, high throughput | Nemotron Nano 8B                               |
| Complex reasoning, long context | Nemotron 3 Nano 30B (1M context)               |
| Agentic AI, multi-step tool use | Nemotron 3 Super 120B (1M context, 12B active) |
| Multi-agent orchestration       | Nemotron 3 Super 120B or Super 49B             |
| Development / testing           | Nemotron Nano 8B                               |

**Can I use both NVIDIA-hosted and self-hosted NIM?**

Configure one NIM endpoint per OpenClaw instance. For hybrid setups, deploy multiple OpenClaw instances with different NIM endpoints and use a load balancer.
