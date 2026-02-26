# Security Considerations

## Threat Model

### Assets
- Slack workspace access
- AWS resources (Bedrock, ECS, RDS)
- Internal REA resources
- User data and command history

### Threats
1. **Command Injection**: Malicious commands via Slack
2. **Privilege Escalation**: Escaping sandbox
3. **Data Exfiltration**: Stealing sensitive data
4. **Resource Abuse**: Crypto mining, DoS
5. **Session Hijacking**: Unauthorized access to active sessions

## Security Controls

### 1. Command Allowlisting

Only these commands are permitted:

```typescript
const ALLOWED_COMMANDS = [
  // New Relic CLI
  /^nr\s+deployments/,
  /^nr\s+apm/,
  /^nr\s+alerts/,
  /^nr\s+events/,
  /^nr\s+logs/,
  /^nr\s+status/,
  /^nr\s+--version/,
  
  // GitHub CLI
  /^gh\s+repo/,
  /^gh\s+pr/,
  /^gh\s+issue/,
  /^gh\s+workflow/,
  /^gh\s+run/,
  /^gh\s+status/,
  /^gh\s+--version/,
  
  // System commands (limited)
  /^ls\s+/,
  /^cat\s+/,
  /^pwd$/,
  /^echo\s+/,
  /^cd\s+/
];
```

### 2. Container Hardening

- **Non-root user**: Container runs as `gurt` user
- **Read-only filesystem**: Except `/tmp` and `/home/gurt`
- **No privileged mode**: Standard container permissions
- **Resource limits**: CPU/memory constrained
- **Network policies**: VPC egress only to required endpoints

### 3. AWS Security

#### IAM Policy (Least Privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore:InvokeAgentRuntime"
      ],
      "Resource": "arn:aws:bedrock-agentcore:*:*:agent-runtime/gurt-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:gurt/newrelic-api-key-*",
        "arn:aws:secretsmanager:*:*:secret:gurt/github-token-*"
      ]
    }
  ]
}
```

#### VPC Configuration

```yaml
SecurityGroup:
  Type: AWS::EC2::SecurityGroup
  Properties:
    GroupDescription: Gurt Sandbox Security Group
    SecurityGroupEgress:
      # New Relic API
      - IpProtocol: tcp
        FromPort: 443
        ToPort: 443
        DestinationCidrIp: 0.0.0.0/0
        Description: HTTPS to New Relic API
      # GitHub API
      - IpProtocol: tcp
        FromPort: 443
        ToPort: 443
        DestinationCidrIp: 0.0.0.0/0
        Description: HTTPS to GitHub API
```

### 4. Bedrock AgentCore Security

- **Session isolation**: MicroVM per thread
- **8-hour timeout**: Prevents indefinite sessions
- **Auto-cleanup**: Resources freed after inactivity
- **No persistence**: Containers are ephemeral

### 5. Audit Logging

All commands logged to PostgreSQL:

```sql
CREATE TABLE command_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  exit_code INTEGER,
  output_truncated TEXT
);

CREATE INDEX idx_command_logs_session ON command_logs(session_id);
CREATE INDEX idx_command_logs_user ON command_logs(user_id);
CREATE INDEX idx_command_logs_executed_at ON command_logs(executed_at);
```

### 6. Input Sanitization

```typescript
function sanitizeInput(input: string): string {
  // Remove null bytes
  let sanitized = input.replace(/\x00/g, '');
  
  // Limit length
  sanitized = sanitized.substring(0, 1000);
  
  // Block dangerous patterns
  const dangerousPatterns = [
    /rm\s+-rf/i,
    />\s*\/dev\/null/i,
    /curl\s+.*\|.*sh/i,
    /wget\s+.*\|.*sh/i,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error('Dangerous command pattern detected');
    }
  }
  
  return sanitized;
}
```

## Secrets Management

### Personal Deployment

Use AWS Secrets Manager:

```bash
# Store secrets
aws secretsmanager create-secret \
  --name gurt/newrelic-api-key \
  --secret-string "NRAK-..."

aws secretsmanager create-secret \
  --name gurt/github-token \
  --secret-string "ghp_..."
```

### REA Deployment

Use The PaaS secrets management:

```yaml
# In Realm UI or via API
secrets:
  - name: NEW_RELIC_API_KEY
    value: <kms-encrypted>
  - name: GITHUB_TOKEN
    value: <kms-encrypted>
```

## Compliance

### REA Requirements

- ✅ Data stays within AWS (no external services)
- ✅ Audit logging enabled
- ✅ IAM least privilege
- ✅ VPC network isolation
- ✅ Kyverno policies (via The PaaS)

### Data Retention

- **Command logs**: 90 days
- **Session metadata**: 30 days
- **Container images**: Last 10 versions

## Incident Response

### Suspicious Activity Detection

Alert on:
- >100 commands in 1 minute
- Commands matching blocked patterns
- Sessions lasting >7 hours
- Access from unexpected Slack workspaces

### Response Playbook

1. **Immediate**: Kill active session
2. **Investigate**: Review command logs
3. **Contain**: Revoke tokens if compromised
4. **Communicate**: Notify security team

## Security Checklist

Before production deployment:

- [ ] Command allowlist reviewed
- [ ] IAM policies minimized
- [ ] Secrets in Secrets Manager
- [ ] Audit logging enabled
- [ ] Resource limits configured
- [ ] Security groups restrictive
- [ ] Non-root container user
- [ ] Read-only root filesystem
- [ ] VPC endpoints configured
- [ ] Incident response plan documented
