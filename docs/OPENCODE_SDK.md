# OpenCode SDK Documentation

## Overview

The `@opencode-ai/sdk` provides a TypeScript client for communicating with opencode instances. This document covers the SDK's capabilities and usage patterns relevant to Gurt's architecture.

## SDK Location

Source code: `/Users/jacob.wisniewski/repositories/opencode/packages/sdk/js/`

Package exports:
- `/` - v1 API
- `/client` - v1 client
- `/server` - v1 server  
- `/v2` - v2 API
- `/v2/client` - v2 client
- `/v2/server` - v2 server

## Key Features

### Server-Sent Events (SSE)

The SDK supports real-time event streaming via SSE:

```typescript
const eventStream = await client.global.event();
for await (const event of eventStream.stream) {
  // Handle events in real-time
}
```

### Available Events

| Event | Description |
|-------|-------------|
| `EventMessageUpdated` | When messages change |
| `EventMessagePartUpdated` | Streaming response parts (complete) |
| `EventMessagePartDelta` | Streaming response parts (incremental) |
| `EventCommandExecuted` | When a tool/command runs |
| `EventSessionStatus` | Session state changes |
| `EventSessionIdle` | Session becomes idle |
| `EventPtyCreated` | PTY session created |
| `EventPtyUpdated` | PTY session updated |
| `EventPtyExited` | PTY session exited |

### Session Methods

| Method | Description |
|--------|-------------|
| `session.prompt()` | Send message (blocking, returns full response) |
| `session.promptAsync()` | Send message asynchronously (returns immediately) |
| `session.command()` | Send command directly to session |
| `session.shell()` | Run shell command |
| `session.messages()` | Get conversation history |
| `session.init()` | Initialize session with model/config |

## Usage Patterns for Status Tracking

### Option A: Real-time Event Subscription

Subscribe to events during prompt execution to track what opencode is doing in real-time:

```typescript
const promptPromise = client.session.prompt({...});
const events = await client.global.event();

for await (const event of events.stream) {
  if (event.type === 'command.executed') {
    // Update Slack typing indicator with current command
    await slack.startTyping(threadId, `Running: ${event.properties.command}`);
  }
}

const response = await promptPromise;
```

**Pros:** Real-time visibility into tool execution  
**Cons:** More complex, need to handle async events

### Option B: Async with Polling

Use `promptAsync` and poll for status updates:

```typescript
await client.session.promptAsync({...});

while (true) {
  const messages = await client.session.messages({sessionID});
  const latest = messages.data.messages[messages.data.messages.length - 1];
  
  if (latest.status === 'completed') break;
  
  // Update typing indicator based on latest state
  await slack.startTyping(threadId, "Processing...");
  await sleep(1000);
}
```

**Pros:** Simple polling pattern  
**Cons:** 1-second latency on updates

### Option C: Simple Parsing (MVP)

Parse response parts from blocking `prompt()` call:

```typescript
const response = await client.session.prompt({...});

// Extract status from response.parts
const textParts = response.data.parts
  .filter(p => p.type === 'text')
  .map(p => p.text)
  .join('\n');

// Post to Slack
await thread.post(textParts);
```

**Pros:** Simplest implementation  
**Cons:** No real-time updates, user waits in silence

## Recommended Approach for Gurt

Use **Option A** (event subscription) from the beginning. Since operations (builds, deployments, log analysis) regularly take >10 seconds, real-time status updates are essential for good UX.

The event subscription provides:
- Visibility into multi-step workflows
- "Running: gh run list" style progress indicators
- Better user experience during long operations

## SDK Versions

- **v1 API:** `createOpencodeClient()` - Original API, fully functional
- **v2 API:** Available via `@opencode-ai/sdk/v2` import - Has additional features like improved streaming

Gurt currently uses v1 API. Migration to v2 is optional.

## Related Documentation

- `AGENTS.md` - Agent context and conventions
- `docs/IMPLEMENTATION_PLAN.md` - Gurt architecture and implementation
