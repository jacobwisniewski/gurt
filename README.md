# Gurt

A Slack bot that provides sandboxed opencode instances for running CLI commands (New Relic, GitHub) directly from Slack threads.

## Overview

Gurt is built with [chat-sdk](https://chat-sdk.dev) and provides isolated execution environments via AWS Bedrock AgentCore Runtime. Each Slack thread gets its own sandbox instance where users can execute CLI commands securely.

## Architecture

```
Slack Thread
     ↓
Gurt Bot (chat-sdk + AWS Bedrock AgentCore)
     ↓
Custom Container (opencode + CLI tools)
     ↓
Internal/AWS Resources
```

### Components

- **Slack Bot**: Built with chat-sdk, handles threading and message routing
- **AWS Bedrock AgentCore Runtime**: Provides isolated sandbox containers
- **Custom Container**: ARM64 Docker image with opencode, New Relic CLI, and GitHub CLI pre-installed
- **PostgreSQL**: Conversation history and audit logging

## Project Structure

```
gurt/
├── src/                          # Source code
│   ├── bot.ts                    # Main bot logic (chat-sdk)
│   ├── commands/                 # CLI command handlers
│   │   ├── newrelic.ts
│   │   └── github.ts
│   └── index.ts                  # Entry point
├── deploy/                       # Deployment configs
│   ├── personal/                 # Personal AWS deployment
│   │   └── bedrock-agentcore.yaml
│   └── rea/                      # REA The PaaS deployment
│       └── k8s-manifests/
├── docker/
│   └── Dockerfile                # Custom container with opencode + CLIs
├── docs/
│   ├── ARCHITECTURE.md           # Detailed architecture docs
│   ├── DEPLOYMENT.md             # Deployment guide
│   └── SECURITY.md               # Security considerations
├── database/
│   └── migrations/               # PostgreSQL migrations
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 20+
- AWS CLI configured
- Docker (for local development)
- Slack app credentials

### Installation

```bash
# Clone and install
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run locally
npm run dev
```

## Deployment

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed instructions.

### Personal (AWS)

Uses AWS Bedrock AgentCore Runtime with custom containers.

### REA (The PaaS)

Deploys to REA's Internal Developer Platform with EKS + ECS Fargate fallback.

## Security

- Isolated containers per Slack thread
- Command allowlisting (New Relic + GitHub CLI only)
- AWS IAM least privilege
- VPC network isolation
- Full audit logging to PostgreSQL

See [SECURITY.md](docs/SECURITY.md) for details.

## License

MIT
