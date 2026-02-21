# Kubernetes deployment

OpenClaw ships a production-ready Helm chart at `k8s/helm/openclaw/`.

## Quick install

```bash
# Add chart repo
helm repo add openclaw https://charts.openclaw.dev
helm repo update

# Install (community)
helm install openclaw openclaw/openclaw \
  --namespace openclaw --create-namespace \
  --set image.tag=latest

# Install (enterprise HA)
helm install openclaw openclaw/openclaw \
  --namespace openclaw --create-namespace \
  -f k8s/examples/enterprise-ha.yaml
```

## Secrets

Create the required Kubernetes secret before installing:

```bash
kubectl create secret generic openclaw-secrets \
  --namespace openclaw \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=OPENCLAW_MASTER_KEY=$(openssl rand -base64 32)
```

For Vault-backed secrets, provide Vault credentials instead.

## Key values

| Value | Default | Description |
|-------|---------|-------------|
| `replicaCount` | `1` | Number of replicas |
| `image.repository` | `ghcr.io/openclaw/openclaw` | Container image |
| `image.tag` | `latest` | Image tag |
| `enterprise.enabled` | `false` | Enable enterprise features |
| `autoscaling.enabled` | `false` | Enable HPA |
| `autoscaling.minReplicas` | `1` | HPA min |
| `autoscaling.maxReplicas` | `10` | HPA max |
| `podDisruptionBudget.enabled` | `false` | Enable PDB |
| `podDisruptionBudget.minAvailable` | `1` | PDB min available |
| `networkPolicy.enabled` | `false` | Enable NetworkPolicy |
| `ingress.enabled` | `false` | Enable Ingress |
| `monitoring.serviceMonitor.enabled` | `false` | Enable Prometheus ServiceMonitor |
| `persistence.enabled` | `true` | Mount a PVC for data |
| `persistence.size` | `10Gi` | PVC size |

## Security defaults

The Helm chart sets secure defaults out of the box:

- `runAsNonRoot: true` — container runs as UID 1001
- `allowPrivilegeEscalation: false`
- `capabilities.drop: ["ALL"]`
- `readOnlyRootFilesystem: true` (data dirs mounted as volumes)
- `automountServiceAccountToken: false`

## Probes

All three probe types are configured by default:

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 3284
  initialDelaySeconds: 15

readinessProbe:
  httpGet:
    path: /readyz
    port: 3284
  initialDelaySeconds: 5

startupProbe:
  httpGet:
    path: /startupz
    port: 3284
  failureThreshold: 30
  periodSeconds: 10
```

## Prometheus monitoring

When `enterprise.monitoring.enabled: true` and `monitoring.serviceMonitor.enabled: true`, a `ServiceMonitor` resource is created for the Prometheus Operator.

```bash
helm install openclaw openclaw/openclaw \
  --set enterprise.monitoring.enabled=true \
  --set monitoring.serviceMonitor.enabled=true \
  --set monitoring.serviceMonitor.additionalLabels.release=kube-prometheus-stack
```

Metrics are available at `http://<pod>:9090/metrics`.

## HA deployment

See [`k8s/examples/enterprise-ha.yaml`](../../k8s/examples/enterprise-ha.yaml) for a full HA configuration including:

- 3 replicas with anti-affinity
- PodDisruptionBudget (minAvailable: 2)
- HPA (3–20 replicas based on CPU/memory)
- NetworkPolicy
- Vault-backed secrets
- OIDC authentication
- Prometheus ServiceMonitor
- cert-manager TLS
