# REA The PaaS Deployment

This directory contains configuration for deploying gurt to REA's Internal Developer Platform (The PaaS).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    The PaaS (EKS)                            │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Gurt Bot (Web Service)                    │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌────────────────┐ │  │
│  │  │   chat-sdk │  │   Sandbox    │  │   Thread State │ │  │
│  │  │   Adapter  │  │   Manager    │  │   (Redis)      │ │  │
│  │  └────────────┘  └──────────────┘  └────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │        Bedrock AgentCore Runtime (AWS)                │  │
│  │     (Separate from The PaaS - AWS Service)            │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │   RDS PostgreSQL     │  │   ElastiCache Redis         │ │
│  │   (db-in-a-box)      │  │   (The PaaS managed)        │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Key Differences from Personal Deployment

1. **Gurt Bot**: Runs on The PaaS (EKS) as a Web Service workload
2. **Bedrock AgentCore**: Still runs in AWS (not on The PaaS)
3. **Database**: RDS via db-in-a-box
4. **Cache**: ElastiCache via The PaaS
5. **Secrets**: Managed via The PaaS secrets or AWS Secrets Manager
6. **IAM**: Uses workload identity (IRSA) instead of static credentials

## Prerequisites

- Access to The PaaS via [Realm](https://realm.rea-group.com)
- AWS access to Bedrock AgentCore
- db-in-a-box configured for PostgreSQL

## Configuration

### 1. The PaaS Workload

Create a Web Service in Realm:
- **Name**: gurt
- **Type**: Web Service
- **Runtime**: Node.js 20
- **Port**: 8080

### 2. Kubernetes Manifests

```yaml
# deploy/rea/k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gurt
  labels:
    app: gurt
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gurt
  template:
    metadata:
      labels:
        app: gurt
    spec:
      serviceAccountName: gurt
      containers:
        - name: gurt
          image: ${ECR_REGISTRY}/gurt-bot:latest
          ports:
            - containerPort: 8080
          env:
            - name: NODE_ENV
              value: "production"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: gurt-db-credentials
                  key: url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: gurt-redis-credentials
                  key: url
            - name: AWS_REGION
              value: "ap-southeast-2"
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

### 3. Service Account with IRSA

```yaml
# deploy/rea/k8s/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gurt
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::${AWS_ACCOUNT_ID}:role/gurt-bedrock-access
```

### 4. IAM Role for Bedrock Access

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore:InvokeAgentRuntime",
        "bedrock-agentcore:CreateAgentSession",
        "bedrock-agentcore:StopAgentSession",
        "bedrock-agentcore:GetAgentSession"
      ],
      "Resource": "arn:aws:bedrock-agentcore:ap-southeast-2:${AWS_ACCOUNT_ID}:agent-runtime/gurt-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVolume",
        "ec2:AttachVolume",
        "ec2:DetachVolume",
        "ec2:DeleteVolume",
        "ec2:DescribeVolumes"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/ManagedBy": "gurt"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:ap-southeast-2:${AWS_ACCOUNT_ID}:secret:gurt/*"
    }
  ]
}
```

## Deployment

### Via Buildkite

The repository includes a Buildkite pipeline that deploys automatically:

```yaml
# .buildkite/pipeline.yml
steps:
  - label: ":docker: Build"
    command:
      - docker build -t gurt-bot .
      
  - label: ":rocket: Deploy to The PaaS"
    command:
      - ./scripts/deploy-rea.sh
    branches: "main"
```

### Manual Deployment

```bash
# Build image
./scripts/build.sh

# Deploy to The PaaS
./scripts/deploy-rea.sh

# Or use kubectl directly
kubectl apply -f deploy/rea/k8s/
```

## db-in-a-box Configuration

```yaml
# database/db-in-a-box.yaml
apiVersion: db-in-a-box.rea-group.com/v1
kind: Database
metadata:
  name: gurt
  namespace: gurt
spec:
  engine: postgres
  version: "15"
  instanceClass: db.t3.micro
  storage: 20
  backupRetentionDays: 7
  deletionProtection: false
  
  schemas:
    - name: gurt
      
  users:
    - name: gurt-app
      grants:
        - schema: gurt
          privileges: [ALL]
    - name: gurt-readonly
      grants:
        - schema: gurt
          privileges: [SELECT]
```

## Secrets Management

### Option 1: The PaaS Secrets

Store secrets in Realm UI or via API:

```bash
# Via Realm CLI
realm secrets create --name SLACK_BOT_TOKEN --value "xoxb-..."
realm secrets create --name NEW_RELIC_API_KEY --value "NRAK-..."
```

### Option 2: AWS Secrets Manager

```bash
# Create secrets
aws secretsmanager create-secret \
  --name gurt/slack-bot-token \
  --secret-string "xoxb-..."

aws secretsmanager create-secret \
  --name gurt/newrelic-api-key \
  --secret-string "NRAK-..."
```

## Monitoring

### The PaaS Observability

- **Metrics**: Automatically sent to Datadog
- **Logs**: Available in Realm UI
- **Alerts**: Configure in Realm

### Custom Dashboards

```yaml
# deploy/rea/monitoring/dashboard.yaml
apiVersion: monitoring.rea-group.com/v1
kind: Dashboard
metadata:
  name: gurt-dashboard
spec:
  title: "Gurt Bot Metrics"
  widgets:
    - title: "Active Sessions"
      type: graph
      query: "gurt.active_sessions"
    - title: "Commands Executed"
      type: graph
      query: "gurt.commands_executed"
```

## Security

### Network Policies

```yaml
# deploy/rea/k8s/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: gurt
spec:
  podSelector:
    matchLabels:
      app: gurt
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: TCP
          port: 53
    - to: []  # Allow all outbound (needed for Bedrock, Slack, etc.)
```

### Pod Security

```yaml
# deploy/rea/k8s/securitycontext.yaml
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
  containers:
    - name: gurt
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
```

## Cost Optimization

### Resource Limits

Set appropriate limits to avoid over-provisioning:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

### Auto-scaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: gurt
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: gurt
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n gurt
kubectl logs -n gurt deployment/gurt
kubectl describe pod -n gurt <pod-name>
```

### Bedrock AgentCore Issues

```bash
# Check Bedrock session status
aws bedrock-agentcore get-agent-session --session-arn <arn>

# View CloudWatch logs
aws logs tail /aws/bedrock-agentcore/runtimes/gurt-sandbox-DEFAULT
```

### Database Connection

```bash
# Connect via bastion (if needed)
psql $DATABASE_URL

# Check connection from pod
kubectl exec -it deployment/gurt -- psql $DATABASE_URL -c "SELECT 1"
```

## Support

For issues:
1. Check [The PaaS documentation](https://paas.rea-group.com)
2. Contact #paas-support Slack channel
3. File ticket in JIRA: PaaS project
