# Security

## Threats

- Command injection via Slack
- Sandbox escape
- Data exfiltration
- Resource abuse
- Session hijacking

## Controls

### Container

- Non-root user
- Read-only filesystem
- Resource limits
- VPC network isolation

### AWS IAM

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock-agentcore:InvokeAgentRuntime"],
      "Resource": "arn:aws:bedrock-agentcore:*:*:agent-runtime/gurt-*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:gurt/*"
    }
  ]
}
```

### Session Security

- MicroVM isolation per thread
- 8-hour timeout
- Auto-cleanup after 30 min idle
- Encrypted EBS volumes

### Secrets

API keys in environment variables only. Never logged.

## Compliance

- Data stays within AWS
- IAM least privilege
- VPC isolation
- Audit logging

## Response

Kill session, review logs, revoke tokens if needed.
