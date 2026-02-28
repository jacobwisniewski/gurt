
import type { Thread, Message } from "chat";
import type { SlackAdapter } from "@chat-adapter/slack";
import type { Logger } from "pino";
import type { LanguageModel } from "ai";
import * as SessionManager from "./session-manager.js";
import * as AgentContext from "./agent-context.js";
import * as Agent from "../agent/index.js";
import type { SandboxClient } from "../sandbox.js";

interface ExecutionLogEntry {
  type: "command";
  command: string;
  output: string;
  timestamp: Date;
  success: boolean;
}

export interface HandleMentionDeps {
  logger: Logger;
  model: LanguageModel;
  opencodePassword: string;
  sessionManager: {
    getSession: (threadId: string) => Promise<SessionManager.Session | null>;
    createSession: (
      threadId: string,
      codeInterpreterId: string,
      volumeId: string,
      context: SessionManager.ThreadContext
    ) => Promise<SessionManager.Session>;
    updateLastActivity: (threadId: string) => Promise<void>;
    saveMessage: (
      threadId: string,
      role: "user" | "assistant" | "system",
      content: string,
      metadata?: object
    ) => Promise<void>;
    getConversationHistory: (
      threadId: string,
      limit?: number
    ) => Promise<
      Array<{
        role: string;
        content: string;
        metadata?: object;
        timestamp: Date;
      }>
    >;
  };
  sandbox: {
    createSandbox: (threadId: string, userId: string) => Promise<{
      threadId: string;
      codeInterpreterId: string;
      volumeId: string;
      opencodeUrl: string;
    }>;
    isSandboxActive: (codeInterpreterId: string) => Promise<boolean>;
    createOpencodeClient: (opencodeUrl: string) => SandboxClient;
    stopSandbox: (codeInterpreterId: string) => Promise<void>;
  };
}

export interface SandboxSession {
  codeInterpreterId: string;
  volumeId: string;
  opencodeUrl: string;
  client: SandboxClient;
}

export const handleMention = async (
  deps: HandleMentionDeps,
  thread: Thread,
  message: Message
): Promise<void> => {
  const threadId = thread.id;
  const userId = (message.author as { id?: string }).id || "unknown";
  const userName = (message.author as { name?: string }).name || "unknown";

  deps.logger.info({ threadId, userId, userName }, "Mention received");

  try {
    // Subscribe to thread for follow-up messages
    await thread.subscribe();
    deps.logger.info({ threadId }, "Subscribed to thread");

    // Build full context (Slack + Sandbox)
    const context = await AgentContext.buildContext(
      {
        getSession: deps.sessionManager.getSession,
        getConversationHistory: deps.sessionManager.getConversationHistory
      },
      thread,
      message
    );
    deps.logger.info({ threadId, hasSandbox: !!context.sandbox.sessionId }, "Context built");

    // Get agent decision
    const decision = await Agent.decide({ model: deps.model }, context);
    deps.logger.info({ threadId, requiresSandbox: decision.requiresSandbox }, "Agent decision made");

    // Execute based on decision
    if (decision.requiresSandbox) {
      await executeInSandbox(deps, thread, decision, context);
    } else {
      await postToSlack(thread, decision.response || "I understand your request.");
    }
  } catch (error) {
    deps.logger.error({ threadId, error }, "Error processing mention");
    await thread.post("Sorry, I encountered an error. Please try again.");
  }
};

const executeInSandbox = async (
  deps: HandleMentionDeps,
  thread: Thread,
  decision: Agent.AgentDecision,
  context: AgentContext.AgentContext
): Promise<void> => {
  const threadId = thread.id;
  const slack = thread.adapter as SlackAdapter;

  // Get or create sandbox session from database
  const session = await getOrCreateSandboxSession(deps, threadId, context);

  // Show typing indicator
  await slack.startTyping(threadId, "Processing...");

  // Save user message to history
  await deps.sessionManager.saveMessage(
    threadId,
    "user",
    context.slack.currentMessage.text
  );

  // Track execution log
  const executionLog: ExecutionLogEntry[] = [];

  // Start prompt and subscribe to events for real-time updates
  const promptPromise = session.client.session.prompt({
    path: { id: "default" },
    body: {
      parts: [{ type: "text", text: decision.prompt || "Execute the user's request." }]
    }
  });

  // Subscribe to events for real-time updates and capture execution log
  try {
    const events = await session.client.global.event();
    for await (const event of events.stream) {
      const eventType = (event as { type?: string }).type;
      if (eventType === "command.executed") {
        const command = (event as { properties?: { command?: string } }).properties?.command;
        if (command) {
          await slack.startTyping(threadId, `Running: ${command}`);
          // Add to execution log (we'll update with output later)
          executionLog.push({
            type: "command",
            command,
            output: "", // Will be filled from response
            timestamp: new Date(),
            success: true // Assume success initially
          });
        }
      }
    }
  } catch (error) {
    deps.logger.warn({ threadId, error }, "Event subscription error (non-critical)");
  }

  // Wait for final response
  const response = await promptPromise;
  const responseData = response.data;

  if (!responseData) {
    throw new Error("No response from sandbox");
  }

  // Extract and format response
  const responseText = extractResponseText(responseData);

  // Try to extract command outputs from response for execution log
  enrichExecutionLogWithOutputs(executionLog, responseText);

  // Save assistant response to history with execution log metadata
  await deps.sessionManager.saveMessage(
    threadId,
    "assistant",
    responseText,
    { executionLog }
  );

  // Update last activity
  await deps.sessionManager.updateLastActivity(threadId);

  // Post formatted response
  const formattedResponse = formatResponse(responseText);
  await thread.post(formattedResponse);

  deps.logger.info({ threadId }, "Sandbox execution complete");
};

const getOrCreateSandboxSession = async (
  deps: HandleMentionDeps,
  threadId: string,
  context: AgentContext.AgentContext
): Promise<SandboxSession> => {
  // Check if session exists in database
  const dbSession = await deps.sessionManager.getSession(threadId);

  if (dbSession && dbSession.status === "active") {
    // Verify it's still active via AWS
    const isActive = await deps.sandbox.isSandboxActive(dbSession.codeInterpreterId);
    
    if (isActive) {
      // Create client on-demand from database info
      // We need to determine the opencode URL - this should ideally be stored in DB
      // For now, using default
      const opencodeUrl = "http://localhost:4096";
      const client = deps.sandbox.createOpencodeClient(opencodeUrl);

      return {
        codeInterpreterId: dbSession.codeInterpreterId,
        volumeId: dbSession.volumeId,
        opencodeUrl,
        client
      };
    } else {
      // Session is inactive in AWS, update database
      deps.logger.info({ threadId, codeInterpreterId: dbSession.codeInterpreterId }, "Session inactive, cleaning up");
      await deps.sandbox.stopSandbox(dbSession.codeInterpreterId);
    }
  }

  // Create new sandbox session
  const userId = context.slack.currentMessage.author;
  const sandbox = await deps.sandbox.createSandbox(threadId, userId);

  // Save to database
  await deps.sessionManager.createSession(
    threadId,
    sandbox.codeInterpreterId,
    sandbox.volumeId,
    {
      user: {
        id: userId,
        name: userId
      },
      channel: {
        id: context.slack.channel.id,
        name: context.slack.channel.name
      }
    }
  );

  const client = deps.sandbox.createOpencodeClient(sandbox.opencodeUrl);

  return {
    codeInterpreterId: sandbox.codeInterpreterId,
    volumeId: sandbox.volumeId,
    opencodeUrl: sandbox.opencodeUrl,
    client
  };
};

const postToSlack = async (thread: Thread, response: string): Promise<void> => {
  const formattedResponse = formatResponse(response);
  await thread.post(formattedResponse);
};

const extractResponseText = (data: { parts?: Array<{ type: string; text?: string }> }): string => {
  if (!data.parts || data.parts.length === 0) {
    return "No response";
  }

  return data.parts
    .filter(part => part.type === "text")
    .map(part => part.text || "")
    .join("\n");
};

const formatResponse = (text: string): string => {
  const MAX_LENGTH = 3000;
  if (text.length > MAX_LENGTH) {
    return (
      text.substring(0, MAX_LENGTH - 100) +
      "\n\n... (truncated, use a file attachment for full output)"
    );
  }
  return text;
};

const enrichExecutionLogWithOutputs = (
  executionLog: ExecutionLogEntry[],
  responseText: string
): void => {
  // Simple heuristic: look for command output patterns in the response
  // This is a basic implementation - could be enhanced with better parsing
  for (const entry of executionLog) {
    // Try to find output related to this command
    // Look for sections that might be command output
    const lines = responseText.split("\n");
    let foundOutput = false;
    let outputLines: string[] = [];

    for (const line of lines) {
      // If we see the command mentioned, start collecting output
      if (line.includes(entry.command.substring(0, 30))) {
        foundOutput = true;
        continue;
      }

      // If we're collecting and hit a markdown separator or new section, stop
      if (foundOutput && (line.startsWith("#") || line.startsWith("---"))) {
        break;
      }

      if (foundOutput) {
        outputLines.push(line);
      }
    }

    // If we found output, use it; otherwise use a portion of the response
    if (outputLines.length > 0) {
      entry.output = outputLines.join("\n").substring(0, 1000); // Limit output length
    } else {
      // Fallback: use relevant portion of response
      entry.output = responseText.substring(0, 500);
    }

    // Check for error indicators
    entry.success = !(
      entry.output.toLowerCase().includes("error") ||
      entry.output.toLowerCase().includes("failed") ||
      entry.output.toLowerCase().includes("fatal")
    );
  }
};
