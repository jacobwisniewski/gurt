# Deployment Guide

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 20+
- Docker (for local builds)
- Slack App credentials

## Personal Deployment (AWS)

### 1. AWS Setup

```bash
# Configure AWS CLI
aws configure

# Enable Bedrock model access (if not already done)
# Go to AWS Console > Bedrock > Model Access
# Enable: Anthropic Claude models
```

### 2. Environment Variables

Create `.env`:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# AWS
AWS_REGION=us-west-2
AWS_PROFILE=default

# Bedrock AgentCore
BEDROCK_AGENTCORE_ROLE_ARN=arn:aws:iam::ACCOUNT:role/BedrockAgentCoreExecutionRole

# PostgreSQL Database (optional for personal - can skip for MVP)
DATABASE_URL=postgresql://user:pass@host:5432/gurt
```

### 3. Deploy

```bash
# Install dependencies
npm install

# Build container (ARM64)
npm run build:container

# Deploy to Bedrock AgentCore
npm run deploy:personal
```

## REA Deployment (The PaaS)

### 1. Prerequisites

- Access to The PaaS via Realm
- db-in-a-box configured for PostgreSQL

### 2. Deploy via Realm

```bash
# Create workload in Realm
# - Type: Web Service
# - Framework: Node.js

# Deploy
git push origin main
# Buildkite pipeline will deploy automatically
```

### 3. Bedrock AgentCore Setup

Bedrock AgentCore Runtime runs independently of The PaaS:

```bash
# Deploy from local (Bedrock AgentCore not managed by The PaaS)
npm run deploy:rea
```

### 4. IAM Configuration

Use workload identity for The PaaS → Bedrock access:

```yaml
# deploy/rea/service-account.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gurt
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::REA-ACCOUNT:role/gurt-bedrock-access
```

## Bedrock AgentCore Configuration

### Custom Container Build

```bash
# Build ARM64 container
docker build --platform linux/arm64 -t gurt-sandbox:latest -f docker/Dockerfile .

# Push to ECR (created automatically by agentcore launch)
# Or let CodeBuild handle it
```

### Configuration File

`.bedrock_agentcore.yaml`:

```yaml
bedrock_agentcore:
  runtime:
    name: gurt-sandbox
    description: Gurt CLI execution environment
    
  container:
    image: gurt-sandbox:latest
    port: 8080
    
  resources:
    cpu: 1024
    memory: 2048
    
  environment:
    - name: NEW_RELIC_API_KEY
      valueFrom: arn:aws:secretsmanager:...
    - name: GITHUB_TOKEN
      valueFrom: arn:aws:secretsmanager:...
```

## Local Development

### Option 1: Mock Mode (No AWS)

```bash
# Run bot with mock sandbox
npm run dev:mock
```

### Option 2: Local Bedrock AgentCore

```bash
# Start local AgentCore dev server
agentcore dev

# In another terminal
npm run dev
```

## Slack App Configuration

### 1. Create Slack App

Go to https://api.slack.com/apps and create new app.

### 2. OAuth Scopes

Required scopes:
- `app_mentions:read`
- `chat:write`
- `chat:write.public`
- `im:history`
- `im:read`
- `im:write`

### 3. Event Subscriptions

Subscribe to events:
- `app_mention`
- `message.im`

### 4. Install App

Install to workspace and note:
- Bot User OAuth Token
- Signing Secret
- App-Level Token (for Socket Mode)

## Troubleshooting

### Container Build Issues

**Error**: `exec format error`
- **Cause**: Not building ARM64 container
- **Fix**: Use `--platform linux/arm64`

**Error**: `CodeBuild failed`
- **Cause**: Missing dependencies in requirements.txt
- **Fix**: Ensure all Python deps listed

### Deployment Issues

**Error**: `AccessDenied`
- **Cause**: IAM permissions
- **Fix**: Check `bedrock-agentcore:InvokeAgentRuntime` permission

### Runtime Issues

**Error**: Session timeout
- **Cause**: 8-hour limit reached
- **Fix**: Start new thread

## Rollback

```bash
# Destroy Bedrock AgentCore resources
agentcore destroy

# For REA deployment
# Use Realm to rollback or kubectl
```
