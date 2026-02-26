# Personal AWS Deployment

This directory contains configuration for deploying gurt to your personal AWS account.

## Prerequisites

- AWS CLI configured with personal account credentials
- Docker installed (optional - can use CodeBuild)
- Bedrock AgentCore starter toolkit: `npm install -g bedrock-agentcore-starter-toolkit`

## Configuration

### 1. Environment Variables

Create `.env` file:

```bash
# AWS
AWS_REGION=us-west-2
AWS_PROFILE=personal

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# API Keys (stored in Secrets Manager)
NEW_RELIC_API_KEY=your-nr-key
GITHUB_TOKEN=ghp-your-token

# Bedrock AgentCore
OPENCODE_SERVER_PASSWORD=secure-random-password
KMS_KEY_ID=alias/aws/ebs  # Or your custom KMS key
```

### 2. Bedrock AgentCore Config

`.bedrock_agentcore.yaml`:

```yaml
bedrock_agentcore:
  runtime:
    name: gurt-sandbox
    description: Gurt CLI execution environment
    
  container:
    image: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/gurt-sandbox:latest
    port: 4096
    
  resources:
    cpu: 1024
    memory: 2048
    
  environment:
    - name: NEW_RELIC_API_KEY
      valueFrom: arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:gurt/newrelic-api-key
    - name: GITHUB_TOKEN
      valueFrom: arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:gurt/github-token
    - name: OPENCODE_SERVER_PASSWORD
      valueFrom: arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:gurt/opencode-password
    
  storage:
    volumes:
      - name: workspace
        mountPath: /home/gurt/workspace
        size: 10
        type: gp3
        encrypted: true
```

## Deployment Steps

### Option 1: CodeBuild (Recommended)

No local Docker needed:

```bash
# Deploy
npm run deploy:personal

# Or manually
agentcore launch
```

### Option 2: Local Build

Requires Docker with ARM64 support:

```bash
# Build container locally
npm run build:container

# Deploy
agentcore launch --local-build
```

## Infrastructure

### Required AWS Resources

1. **ECR Repository**: For container images
2. **Secrets Manager**: For API keys
3. **KMS Key**: For EBS encryption (optional)
4. **IAM Role**: Bedrock AgentCore execution role
5. **CloudWatch Logs**: For logging

### Setup Script

```bash
#!/bin/bash

# Create ECR repository
aws ecr create-repository --repository-name gurt-sandbox

# Store secrets
aws secretsmanager create-secret \
  --name gurt/newrelic-api-key \
  --secret-string "$NEW_RELIC_API_KEY"

aws secretsmanager create-secret \
  --name gurt/github-token \
  --secret-string "$GITHUB_TOKEN"

aws secretsmanager create-secret \
  --name gurt/opencode-password \
  --secret-string "$OPENCODE_SERVER_PASSWORD"

# Create IAM role (save ARN for .bedrock_agentcore.yaml)
aws iam create-role \
  --role-name BedrockAgentCoreGurtExecutionRole \
  --assume-role-policy-document file://trust-policy.json
```

## Cost Considerations

**Bedrock AgentCore**: ~$0.05/hour per active session + request fees
**EBS Storage**: ~$0.10/GB/month for persistent volumes
**Data Transfer**: Minimal (responses only)

Example: 10 active threads, 2 hours/day = ~$30/month

## Monitoring

View logs:
```bash
# Bedrock AgentCore logs
aws logs tail /aws/bedrock-agentcore/runtimes/gurt-sandbox-DEFAULT --follow

# Application logs
aws logs tail /aws/lambda/gurt-bot --follow
```

## Cleanup

```bash
# Destroy all resources
agentcore destroy

# Delete EBS volumes manually (they persist)
aws ec2 describe-volumes --filters Name=tag:ManagedBy,Values=gurt
aws ec2 delete-volume --volume-id vol-xxxxx
```
