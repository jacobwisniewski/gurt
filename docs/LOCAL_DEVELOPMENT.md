# Local Development with Docker Sandbox Provider

This guide covers using the Docker-based sandbox provider for local development, eliminating the need for AWS Bedrock AgentCore during development and testing.

## Overview

The Docker sandbox provider runs sandbox containers directly on your local machine using Docker, providing:

- **No AWS costs** during development
- **Faster startup** (seconds vs minutes for Bedrock)
- **Offline development** capability
- **Identical container environment** to production

## Configuration

Set the environment variable to use the local provider:

```bash
SANDBOX_PROVIDER=local
```

Optional configuration:
```bash
# Override the sandbox image (default: gurt-sandbox:latest)
LOCAL_SANDBOX_IMAGE=gurt-sandbox:latest
```

## Volume Management

Each thread gets a dedicated Docker named volume that persists forever:

- **Volume naming**: `gurt-workspace-${threadId}`
- **Persistence**: Volumes survive container restarts and are reused when threads reactivate
- **Size limit**: Soft limit of 10GB per volume (documented but not strictly enforced by Docker)
- **Cleanup**: Manual - volumes persist until explicitly removed

### Managing Volumes

```bash
# List all gurt volumes
docker volume ls | grep gurt-workspace

# Inspect a specific volume
docker volume inspect gurt-workspace-thread-123

# Remove a specific thread's volume
docker volume rm gurt-workspace-thread-123

# Remove all gurt volumes (WARNING: Destroys all thread data)
docker volume rm $(docker volume ls -q | grep gurt-workspace)
```

## Port Allocation

Ports are allocated deterministically based on threadId:

- **Port range**: 10000-65535 (55,535 available ports)
- **Allocation**: Hash of threadId mapped to port range
- **Same thread, same port**: Deterministic allocation ensures consistency
- **Fallback**: If port is in use, next sequential port is tried

## Container Lifecycle

1. **First request**: Container created and started
2. **Thread reactivation**: Existing container restarted if stopped
3. **Container running**: Reused for subsequent requests
4. **Stop**: Container stopped but volume persists
5. **Cleanup**: Manual volume removal when needed

## Quick Start

1. **Ensure Docker is running**
2. **Set environment**:
   ```bash
   cp .env.docker .env
   # Edit .env and set:
   # SANDBOX_PROVIDER=local
   ```
3. **Start infrastructure**:
   ```bash
   ./scripts/dev.sh up
   ```
4. **Run migrations**:
   ```bash
   ./scripts/dev.sh migrate
   ```
5. **Start the bot**:
   ```bash
   npm run dev
   ```

## Troubleshooting

### Port Already in Use

The provider will automatically try the next sequential port. Check which ports are in use:
```bash
lsof -i :10000-65535 | grep LISTEN
```

### Container Won't Start

Check container logs:
```bash
docker logs gurt-sandbox-thread-123
```

### Volume Issues

Verify volume exists and is accessible:
```bash
docker volume inspect gurt-workspace-thread-123
```

### Image Not Found

Ensure the sandbox image is built:
```bash
npm run build:container
```

## Comparison: Local vs Bedrock

| Feature | Local Docker | AWS Bedrock |
|---------|--------------|-------------|
| Cost | Free | Pay per use |
| Startup Time | ~5 seconds | ~1-2 minutes |
| Persistence | Docker volumes | EBS volumes |
| Offline Use | Yes | No |
| Auto-scaling | No | Yes |
| Production | No | Yes |

## Switching Back to Bedrock

Simply change the environment variable:
```bash
SANDBOX_PROVIDER=bedrock
```

All existing thread data in PostgreSQL remains compatible.
