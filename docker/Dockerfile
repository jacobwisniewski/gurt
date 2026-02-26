FROM --platform=linux/arm64 node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    unzip \
    ca-certificates \
    # Required for opencode
    build-essential \
    python3 \
    python3-pip \
    # Useful tools
    vim \
    less \
    htop \
    && rm -rf /var/lib/apt/lists/*

# Install New Relic CLI
RUN curl -fsSL https://cli.newrelic.com/install.sh | bash

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Install AWS CLI (ARM64 version)
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip" && \
    unzip -q awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws/

# Install opencode via npm
RUN npm install -g opencode-ai@latest

# Create non-root user for security
RUN useradd -m -s /bin/bash gurt && \
    mkdir -p /home/gurt/workspace && \
    chown -R gurt:gurt /home/gurt

# Set working directory
WORKDIR /home/gurt/workspace

# Switch to non-root user
USER gurt

# Set environment
ENV HOME=/home/gurt
ENV PATH="/usr/local/bin:${PATH}"
ENV OPENCODE_INSTALL_DIR=/usr/local/bin

# Expose port for opencode server
EXPOSE 4096

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:4096/global/health || exit 1

# Start opencode server
CMD ["opencode", "serve", "--port", "4096", "--hostname", "0.0.0.0"]
