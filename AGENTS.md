# Gurt Agent Documentation

## OpenCode SDK

The project uses `@opencode-ai/sdk` for communicating with opencode instances running in AWS Bedrock AgentCore sandboxes.

**Source Location:** `/Users/jacob.wisniewski/repositories/opencode/packages/sdk/js/`

**Full Documentation:** See `docs/OPENCODE_SDK.md`

## AWS Bedrock AgentCore

Gurt uses AWS Bedrock AgentCore Runtime to run sandboxed containers with custom Docker images.

**Documentation:** https://docs.aws.amazon.com/bedrock-agentcore/

**JavaScript SDK:** `@aws-sdk/client-bedrock-agentcore`

**Key Concepts:**
- **Code Interpreter Session**: AWS's terminology for a sandboxed compute environment. Despite the name, it supports custom Docker containers (not just Python notebooks). We use it to run our custom container with opencode and CLI tools.
- **Custom Container**: The Docker image we build with opencode, CLI tools, and custom configuration
- **EBS Volume**: Persistent storage attached to each thread's sandbox

**Architecture:**
1. Gurt receives Slack mention
2. Calls `StartCodeInterpreterSessionCommand` to launch custom container
3. Container runs opencode server with gh, nr, jira, aws CLI tools
4. Gurt communicates with opencode via SDK
5. EBS volume persists across session restarts for the same thread
