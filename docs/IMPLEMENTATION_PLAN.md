# Gurt Implementation Plan

## Architecture Overview

Gurt uses a **stateful agent architecture** where the agent maintains both Slack and Sandbox context to make intelligent decisions about what to execute.

```
Slack Message Arrives
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Gurt Controller (Event Handler)                             │
│ - Loads Slack context (channel, users, history)            │
│ - Loads Sandbox context (previous commands, state)         │
│ - Passes combined context to Agent                         │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ ToolLoopAgent (Decision Engine)                             │
│ - Receives: Full context (Slack + Sandbox)                 │
│ - Decides: What action to take                             │
│ - Outputs: Prompt for sandbox OR Slack response            │
│ - Maintains: Agent state across steps                      │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Gurt Controller (Execution)                                 │
│ IF decision requires sandbox:                              │
│   - Gets/creates sandbox session                           │
│   - Sends prompt to opencode                               │
│   - SUBSCRIBES to events                                   │
│   - Updates Slack typing indicator in real-time            │
│   - Receives final result                                  │
│                                                            │
│ IF decision requires Slack action:                         │
│   - Posts message/reaction                                 │
│                                                            │
│ Updates: Agent state                                       │
│ Continues: Loop if more steps needed                       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
              Final Response to Slack
```

### Key Design Principles

1. **Agent has NO tools** - It generates prompts/decisions, not direct executions
2. **Gurt controls execution** - Sandbox lifecycle, event streaming, Slack UI
3. **Full context provided** - Agent sees Slack context + Sandbox state together
4. **Stateful across steps** - Agent remembers what it already did
5. **Event-driven updates** - Real-time typing indicator via sandbox event subscription

### Agent Context

```typescript
interface AgentContext {
  // Slack Context
  slack: {
    channel: { id: string; name: string; type: string };
    thread: { id: string; participants: string[] };
    currentMessage: { text: string; author: string; timestamp: string };
    history: Array<{ role: string; content: string; author?: string }>;
  };
  
  // Sandbox Context
  sandbox: {
    sessionId?: string;
    previousCommands: Array<{ command: string; output: string }>;
    currentDirectory?: string;
    gitBranch?: string;
    lastOutput?: string;
  };
  
  // Agent State (maintained across steps)
  agentState: {
    stepsTaken: number;
    currentGoal?: string;
    decisions: string[];
  };
}
```

### Session Model (MVP)

**One opencode session per Slack thread, sequential execution only.**

```
Thread
  ↓
Agent (ToolLoopAgent)
  ↓
One Sandbox Session at /home/gurt/workspace
  ↓
Sequential prompts only

Example Flow:
User: "check my builds"
↓
Agent: "Check build for service-a in /home/gurt/workspace/service-a"
↓
Wait for result
↓
Agent: "Check build for service-b in /home/gurt/workspace/service-b"
↓
Wait for result
↓
Agent: "Post summary to Slack"
```

**Design Rationale:**
- **Simpler state management** - One session, one context, one execution flow
- **Predictable error handling** - If step fails, stop or retry cleanly
- **Lower resource cost** - No parallel compute charges
- **Easier debugging** - Linear execution trace

**Future Enhancement:** Parallel session support can be added later when:
- Latency becomes a bottleneck
- Multiple independent checks are frequent use cases
- Resource costs are acceptable

### Execution Flow Example

**User:** "@gurt why did my build fail?"

**Step 1:** Agent receives context
```
Slack: {#deployments, @alice, "why did my build fail?"}
Sandbox: {no previous commands}
```
**Decision:** "Check build status"
**Action:** Gurt sends to sandbox → "Check the latest build status"
**Result:** "Build #12345 failed"

**Step 2:** Agent receives updated context
```
Slack: {#deployments, @alice, "why did my build fail?"}
Sandbox: {previous: "build #12345 failed"}
```
**Decision:** "Check build logs"
**Action:** Gurt sends to sandbox → "Get the logs for failed build #12345"
**Result:** Error details found

**Step 3:** Agent decides to respond
**Decision:** "Report findings to user"
**Action:** Gurt posts to Slack with formatted response

## Tech Stack

- **Database:** PostgreSQL 15+
- **Query Builder:** Kysley (TypeScript-first SQL query builder)
- **Migrations:** Flyway (industry standard, versioned SQL migrations)
- **Framework:** chat-sdk with Slack adapter
- **State Management:** Postgres (replacing Redis + in-memory Map)
- **AI:** ai-sdk with ToolLoopAgent (stateful agent architecture)

## Database Schema

### Migration: V001__initial_schema.sql

```sql
-- Sandboxes table: tracks active/inactive sandbox sessions
CREATE TABLE sandboxes (
    thread_id VARCHAR(255) PRIMARY KEY,
    code_interpreter_id VARCHAR(255) NOT NULL,
    volume_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'stopped')),
    context_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sandboxes_status ON sandboxes(status);
CREATE INDEX idx_sandboxes_last_activity ON sandboxes(last_activity);

-- Messages table: conversation history for context
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    thread_id VARCHAR(255) NOT NULL REFERENCES sandboxes(thread_id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(thread_id, sequence_number)
);

CREATE INDEX idx_messages_thread_id ON messages(thread_id);
CREATE INDEX idx_messages_thread_sequence ON messages(thread_id, sequence_number);
```

## Project Structure

```
src/
├── index.ts                    # Entry point, bot setup
├── config/
│   ├── env.ts                  # Environment config
│   ├── logger.ts               # Pino logger
│   ├── schema.ts               # Zod env validation
│   └── database.ts             # Kysley database instance
├── adapters/
│   └── slack/
│       ├── index.ts            # Slack adapter setup
│       ├── handlers.ts         # onNewMention, onSubscribedMessage
│       └── formatter.ts        # Response formatting
├── core/
│   ├── agent-controller.ts     # Orchestrate agent + execution
│   ├── agent-context.ts        # Build full context for agent
│   ├── session-manager.ts      # Sandbox lifecycle (Kysley)
│   └── state-manager.ts        # Agent state persistence
├── agent/
│   ├── index.ts                # ToolLoopAgent setup
│   ├── prompts.ts              # System prompts
│   └── types.ts                # Agent types
├── sandbox/
│   ├── client.ts               # opencode client wrapper
│   ├── manager.ts              # Bedrock AgentCore integration
│   └── types.ts                # Sandbox type definitions
└── types/
    └── index.ts                # Shared TypeScript types

database/
├── migrations/
│   └── V001__initial_schema.sql
└── flyway.conf                 # Flyway configuration
```

## Implementation Phases

### Phase 1: Database Setup

1. **Install dependencies:**
   ```bash
   pnpm add kysley pg
   pnpm add -D @types/pg
   ```

2. **Create database config (`src/config/database.ts`):**
   ```typescript
   import { Kysely, PostgresDialect } from 'kysely'
   import { Pool } from 'pg'
   import { getConfig } from './env'
   
   export interface Database {
     sandboxes: SandboxTable
     messages: MessageTable
   }
   
   interface SandboxTable {
     thread_id: string
     code_interpreter_id: string
     volume_id: string
     status: 'active' | 'idle' | 'stopped'
     context_json: object
     created_at: Date
     last_activity: Date
   }
   
   interface MessageTable {
     id: number
     thread_id: string
     sequence_number: number
     role: 'user' | 'assistant' | 'system'
     content: string
     metadata: object
     created_at: Date
   }
   
   const config = getConfig()
   
   export const db = new Kysely<Database>({
     dialect: new PostgresDialect({
       pool: new Pool({
         connectionString: config.DATABASE_URL
       })
     })
   })
   ```

3. **Set up Flyway:**
   - Add `flyway.conf` to `database/`
   - Document migration commands in README

### Phase 2: Session Manager

**File:** `src/core/session-manager.ts`

Replace the in-memory Map with Kysley queries:

```typescript
export class SessionManager {
  async getOrCreateSession(threadId: string, context: ThreadContext): Promise<Session> {
    // 1. Check if session exists in DB
    const existing = await db.selectFrom('sandboxes')
      .where('thread_id', '=', threadId)
      .selectAll()
      .executeTakeFirst()
    
    if (existing && existing.status === 'active') {
      // Update last_activity
      await db.updateTable('sandboxes')
        .set({ last_activity: new Date() })
        .where('thread_id', '=', threadId)
        .execute()
      return this.toSession(existing)
    }
    
    // 2. Create new session (reuse existing code from sandbox.ts)
    return this.createNewSession(threadId, context)
  }
  
  async saveMessage(threadId: string, role: string, content: string): Promise<void> {
    // Get next sequence number
    const lastMessage = await db.selectFrom('messages')
      .where('thread_id', '=', threadId)
      .orderBy('sequence_number', 'desc')
      .select('sequence_number')
      .executeTakeFirst()
    
    const sequence = (lastMessage?.sequence_number ?? 0) + 1
    
    await db.insertInto('messages')
      .values({
        thread_id: threadId,
        sequence_number: sequence,
        role,
        content,
        created_at: new Date()
      })
      .execute()
  }
  
  async getConversationHistory(threadId: string, limit: number = 10): Promise<Message[]> {
    return db.selectFrom('messages')
      .where('thread_id', '=', threadId)
      .orderBy('sequence_number', 'desc')
      .limit(limit)
      .selectAll()
      .execute()
  }
}
```

### Phase 3: Agent Context Builder

**File:** `src/core/agent-context.ts`

Build full context (Slack + Sandbox) for the agent:

```typescript
export interface AgentContext {
  slack: {
    channel: {
      id: string
      name: string
      type: 'public' | 'private' | 'dm'
    }
    thread: {
      id: string
      participants: string[]
      messageCount: number
    }
    currentMessage: {
      text: string
      author: string
      timestamp: string
    }
    history: Array<{
      role: string
      content: string
      author: string
      timestamp: string
    }>
  }
  sandbox: {
    sessionId?: string
    previousCommands: Array<{
      command: string
      output: string
      timestamp: Date
    }>
    currentDirectory?: string
    gitBranch?: string
    lastOutput?: string
  }
}

export class AgentContextBuilder {
  async buildContext(
    thread: Thread,
    message: Message,
    sessionManager: SessionManager
  ): Promise<AgentContext> {
    // Build Slack context
    const slackContext = {
      channel: {
        id: thread.channel.id,
        name: thread.channel.name,
        type: thread.channel.type
      },
      thread: {
        id: thread.id,
        participants: thread.participants.map(p => p.name),
        messageCount: thread.messageCount
      },
      currentMessage: {
        text: message.text,
        author: message.author.name,
        timestamp: message.timestamp
      },
      history: await this.getThreadHistory(thread.id)
    }
    
    // Build Sandbox context
    const session = await sessionManager.getSession(thread.id)
    const sandboxContext = session ? {
      sessionId: session.codeInterpreterId,
      previousCommands: session.previousCommands || [],
      currentDirectory: session.currentDirectory,
      gitBranch: session.gitBranch,
      lastOutput: session.lastOutput
    } : {
      previousCommands: []
    }
    
    return {
      slack: slackContext,
      sandbox: sandboxContext
    }
  }
}
```

### Phase 4: Agent Controller

**File:** `src/core/agent-controller.ts`

Orchestrate agent decisions and execution:

```typescript
export class AgentController {
  constructor(
    private agent: ToolLoopAgent,
    private sessionManager: SessionManager,
    private contextBuilder: AgentContextBuilder
  ) {}

  async handleMention(thread: Thread, message: Message) {
    const threadId = thread.id
    
    try {
      // 1. Subscribe to thread for follow-up messages
      await thread.subscribe()
      
      // 2. Build full context
      const context = await this.contextBuilder.buildContext(
        thread, 
        message, 
        this.sessionManager
      )
      
      // 3. Agent decides what to do
      const decision = await this.agent.generate({
        prompt: this.buildAgentPrompt(context)
      })
      
      // 4. Execute based on decision
      if (decision.requiresSandbox) {
        await this.executeInSandbox(thread, decision.prompt, context)
      } else {
        await this.postToSlack(thread, decision.response)
      }
      
    } catch (error) {
      logger.error({ threadId, error }, "Error processing mention")
      await thread.post("Sorry, I encountered an error. Please try again.")
    }
  }
  
  private async executeInSandbox(
    thread: Thread, 
    prompt: string, 
    context: AgentContext
  ) {
    const slack = thread.adapter as SlackAdapter
    const threadId = thread.id
    
    // Get or create sandbox session
    const session = await this.sessionManager.getOrCreateSession(threadId, {
      user: context.slack.currentMessage.author,
      channel: context.slack.channel
    })
    
    // Start prompt and subscribe to events
    const promptPromise = session.client.session.prompt({
      path: { id: "default" },
      body: { parts: [{ type: "text", text: prompt }] }
    })
    
    // Subscribe to events for real-time updates
    const events = await session.client.global.event()
    for await (const event of events.stream) {
      if (event.type === 'command.executed') {
        await slack.startTyping(threadId, `Running: ${event.properties.command}`)
      }
    }
    
    // Wait for final response
    const response = await promptPromise
    
    // Format and post response
    const responseText = this.extractResponseText(response.data)
    await thread.post(this.formatResponse(responseText))
  }
}
```

### Phase 5: Slack Handlers

**File:** `src/adapters/slack/handlers.ts`

```typescript
export function setupSlackHandlers(
  bot: Chat, 
  agentController: AgentController
) {
  bot.onNewMention(async (thread, message) => {
    await agentController.handleMention(thread, message)
  })
  
  bot.onSubscribedMessage(async (thread, message) => {
    // Same flow as onNewMention but without subscribe()
    await agentController.handleMention(thread, message)
  })
}
```

### Phase 6: Response Formatter

**File:** `src/adapters/slack/formatter.ts`

Keep it simple - clean markdown:

```typescript
export function formatResponse(text: string): string {
  // Truncate if too long
  const MAX_LENGTH = 3000
  if (text.length > MAX_LENGTH) {
    return text.substring(0, MAX_LENGTH - 100) + 
           '\n\n... (truncated, use a file attachment for full output)'
  }
  
  // Basic formatting - opencode should return markdown
  return text
}

function extractResponseText(data: any): string {
  if (!data?.parts || data.parts.length === 0) {
    return "No response"
  }
  
  return data.parts
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text || "")
    .join("\n")
}
```

### Phase 6: Jira CLI in Container

**File:** `docker/Dockerfile`

Add official Jira CLI:

```dockerfile
# Install Jira CLI
RUN curl -L https://github.com/ankitpokhrel/jira-cli/releases/latest/download/jira_$(uname -s)_$(uname -m).tar.gz | tar -xz && \
    mv jira /usr/local/bin/ && \
    chmod +x /usr/local/bin/jira
```

Update environment variables to include Jira auth.

## Configuration Changes

**`.env.example` additions:**
```bash
# Database (replaces Redis)
DATABASE_URL=postgresql://user:pass@localhost:5432/gurt

# Jira (optional)
JIRA_API_TOKEN=your-token
JIRA_EMAIL=your-email@example.com
JIRA_HOST=https://your-domain.atlassian.net
```

**`src/config/schema.ts` additions:**
```typescript
DATABASE_URL: z.string().url(),
JIRA_API_TOKEN: z.string().optional(),
JIRA_EMAIL: z.string().email().optional(),
JIRA_HOST: z.string().url().optional()
```

**Model Configuration (AI SDK):**

Uses `@ai-sdk/amazon-bedrock` provider for Bedrock integration:

```typescript
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { ToolLoopAgent } from 'ai';

// Model agnostic configuration
MODEL_PROVIDER: z.enum(['bedrock', 'openai', 'anthropic']).default('bedrock'),
MODEL_ID: z.string().default('anthropic.claude-3-5-sonnet-20241022-v2:0'),

// Examples:
// For cops-dev testing with Kimi 2.5 (cheaper):
// MODEL_PROVIDER=bedrock
// MODEL_ID=kimi-2.5

// For production or fallback:
// MODEL_PROVIDER=bedrock
// MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
```

**Agent Setup:**
```typescript
const agent = new ToolLoopAgent({
  model: bedrock(config.MODEL_ID),
  instructions: 'You are Gurt, a DevOps assistant...',
  // ... rest of config
});
```

**Design Notes:**
- **Model-agnostic by design** - Easy to swap providers/models via environment variables
- **Kimi 2.5 preferred for cops-dev testing** - More cost-effective for development iterations
- **Claude 3.5 Sonnet fallback** - Reliable alternative for production or if Kimi unavailable
- **Configurable at runtime** - No code changes needed to switch models

## Migration Commands

**Development:**
```bash
# Run migrations
pnpm migrate:up

# Create new migration
pnpm migrate:create --name add_new_table

# Rollback
pnpm migrate:down
```

**Production:**
```bash
# Flyway CLI
flyway -configFiles=database/flyway.conf migrate
```

## Testing Strategy

1. **Unit tests:** SessionManager, ContextBuilder (mock DB)
2. **Integration tests:** Full flow with test Slack workspace
3. **Manual testing:** Deploy to dev, interact in real Slack

## Success Criteria

- [ ] Thread subscription works (follow-up messages recognized)
- [ ] Conversation history persists in Postgres
- [ ] Typing indicators show custom status
- [ ] Sandbox sessions survive bot restart
- [ ] Context includes channel, user, thread history
- [ ] Clean, formatted responses in Slack
- [ ] Jira CLI available in sandbox

## Future Enhancements

- [ ] Parallel opencode sessions (for independent operations)
- [ ] Streaming responses for long operations
- [ ] Cards/actions for interactive workflows
- [ ] Intent routing layer (ai-sdk)
- [ ] Internal observability UI
- [ ] Redis cache for hot sessions (optional)
- [ ] Multi-workspace OAuth support

## MCP Integrations

### Glean MCP (Internal Documentation Search)

**Overview:** Integrate Glean search via MCP to give opencode access to REA internal documentation, APIs, and knowledge base.

**Authentication Approach: Service Account (Option A)**

**Rationale:**
- Simple setup - no per-user OAuth flow
- Shared context across all users
- Works immediately without user authentication
- Credentials managed via environment variables

**Architecture:**

```
Sandbox Container
  ├─ opencode agent
  ├─ gh, nr, jira, aws CLI tools
  └─ Glean MCP Server (service account auth)
         ↓
    Glean API (REA internal)
         ↓
    Internal docs, API specs, runbooks
```

**Configuration:**

```typescript
// Environment variables
GLEAN_MCP_ENABLED=true
GLEAN_MCP_URL=https://glean.rea-group.com/mcp
GLEAN_MCP_CLIENT_ID=service-account-client-id
GLEAN_MCP_CLIENT_SECRET=service-account-secret

// opencode session init
await client.session.init({
  path: { id: "default" },
  body: {
    mcp: {
      glean: {
        type: "remote",
        url: process.env.GLEAN_MCP_URL,
        auth: {
          type: "oauth",
          clientId: process.env.GLEAN_MCP_CLIENT_ID,
          clientSecret: process.env.GLEAN_MCP_CLIENT_SECRET,
        },
        enabled: true,
      },
    },
  },
});
```

**Use Cases:**
- Search internal documentation during debugging
- Look up API specifications and schemas
- Find runbooks and operational procedures
- Answer questions about internal systems

**Example Prompts:**
```
"Search Glean for the deployment runbook for service-auth"
"What does Glean say about the conversational-experience-api architecture?"
"Find error handling documentation in Glean"
```

**Security Considerations:**
- Service account should have read-only access
- Store credentials in AWS Secrets Manager
- No sensitive data logged to Slack
- Users see only what service account can access

**Future: Per-User Auth (Option B)**
- Allow individual users to authenticate their Glean account
- Personal context (what user can see)
- Store OAuth tokens per user in database
- Fallback to service account if user not authenticated
