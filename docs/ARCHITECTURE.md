# Architecture

## System Overview

Gurt provides sandboxed CLI execution environments within Slack threads using AWS Bedrock AgentCore Runtime.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Slack User                               │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Slack Platform                               │
│              (Events API + WebSocket)                           │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gurt Bot Service                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   chat-sdk   │  │ Thread State │  │   Command Router     │   │
│  │   Adapter    │  │   (Redis)    │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              AWS Bedrock AgentCore Runtime                       │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │           Custom Container (per thread)                  │   │
│   │  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐  │   │
│   │  │  opencode  │  │ New Relic CLI │  │   GitHub CLI    │  │   │
│   │  │   Agent    │  │               │  │                 │  │   │
│   │  └────────────┘  └──────────────┘  └─────────────────┘  │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
┌───────────────────┐    ┌──────────────────┐
│  Internal REA     │    │   PostgreSQL     │
│    Resources      │    │  (Audit Logs)    │
│  (VPC internal)   │    │                  │
└───────────────────┘    └──────────────────┘
```

## Thread-to-Session Mapping

Each Slack thread maps to one Bedrock AgentCore session with **persistent storage**:

```
Slack Thread Created
         ↓
Gurt creates Bedrock AgentCore Session
         ↓
Session spins up Custom Container
         ↓
Container mounts EBS Volume (persistent per thread)
         ↓
All thread messages → Container
         ↓
Container streams output back
         ↓
Auto-terminate after 30 min inactivity
         ↓
Container stops but volume persists
         ↓
Next message in thread → Same volume re-mounted
```

### Volume Lifecycle

| State | Storage | Duration |
|-------|---------|----------|
| **Active Session** | EBS volume mounted | While thread is active |
| **Inactive Session** | EBS volume detached | 30 min idle → container stops |
| **Thread Archived** | EBS volume snapshot | User-configurable retention |
| **Thread Deleted** | EBS volume deleted | Immediate cleanup |

### Volume Specifications

```yaml
VolumeConfig:
  type: gp3
  size: 10GB (default, configurable)
  encryption: AWS KMS
  backup: Daily snapshots
  mountPoint: /home/gurt/workspace
```

## Container Architecture

### Custom Container

**Base Image**: ARM64-compatible (AWS Graviton requirement)
**Pre-installed Tools**:
- opencode CLI
- New Relic CLI
- GitHub CLI

### Session Isolation

- One container per Slack thread
- MicroVM isolation via Bedrock AgentCore
- 8-hour maximum session duration
- Auto-cleanup after inactivity

## Data Flow

### 1. Message Flow

```
User: @gurt newrelic deployments list
         ↓
Slack → Gurt Bot
         ↓
Gurt validates command (allowlist)
         ↓
Gurt routes to active thread session
         ↓
Container executes: newrelic deployments list
         ↓
Output streamed back to Slack thread
```

### 2. State Management

```
Thread State (Redis):
{
  threadId: "slack-thread-123",
  sessionArn: "arn:aws:bedrock-agentcore:...",
  createdAt: "2025-02-26T10:00:00Z",
  lastActivity: "2025-02-26T10:05:00Z",
  commandHistory: [...]
}
```

### 3. Audit Logging

```
PostgreSQL Schema:
- sessions: session metadata
- commands: executed commands with output
- users: user activity tracking
```

## Deployment Options

### Personal (AWS Account)

- Bedrock AgentCore Runtime
- RDS PostgreSQL
- ElastiCache Redis
- Simple IAM roles

### REA (The PaaS)

- Gurt Bot on The PaaS (EKS Web Service)
- Bedrock AgentCore Runtime
- RDS via db-in-a-box
- ElastiCache via The PaaS
- IAM via workload identity

## Security Layers

1. **Slack OAuth**: User authentication
2. **Command Allowlisting**: Only nr, gh commands
3. **Bedrock Guardrails**: Content filtering (optional)
4. **IAM Roles**: Least privilege access
5. **VPC Security Groups**: Network isolation
6. **Session Isolation**: MicroVM per thread
7. **Audit Logging**: All commands logged

## Scaling Considerations

### Concurrent Sessions

- Bedrock AgentCore handles scaling automatically
- Limits TBD based on AWS quotas
- Cost scales with concurrent sessions

### Resource Limits

Per container:
- CPU: Configurable
- Memory: Configurable
- Disk: Ephemeral (state not persisted)
- Network: VPC egress only

## Cost Model

### Bedrock AgentCore Pricing

- Pay per request + compute time
- ARM64 Graviton pricing
- No idle costs (serverless)

### RDS PostgreSQL

- db-in-a-box (REA) or RDS (personal)
- Storage for audit logs

### Redis

- ElastiCache or ElastiCache Serverless
- Session state only (small data)
