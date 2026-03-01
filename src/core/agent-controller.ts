import type { Thread, Message } from "chat";
import type { SlackAdapter } from "@chat-adapter/slack";
import type { Logger } from "pino";
import type { LanguageModel } from "ai";
import * as SessionManager from "./session-manager.js";
import * as AgentContext from "./agent-context.js";
import * as Agent from "../agent/index.js";
import type { SandboxProvider } from "../sandbox/index.js";

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
      sessionId: string,
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
  sandbox: SandboxProvider;
}

export interface SandboxSession {
  sessionId: string;
  volumeId: string;
  client: ReturnType<typeof import("../sandbox/index.js")["createOpencodeClient"]>;
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
    await thread.subscribe();
    deps.logger.info({ threadId }, "Subscribed to thread");

    const context = await AgentContext.buildContext(
      {
        getSession: deps.sessionManager.getSession,
        getConversationHistory: deps.sessionManager.getConversationHistory
      },
      thread,
      message
    );
    deps.logger.info({ threadId, hasSandbox: !!context.sandbox.sessionId }, "Context built");

    const decision = await Agent.decide({ model: deps.model }, context);
    deps.logger.info({ threadId, requiresSandbox: decision.requiresSandbox }, "Agent decision made");

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

  const session = await getOrCreateSandboxSession(deps, threadId, context);

  await slack.startTyping(threadId, "Processing...");

  await deps.sessionManager.saveMessage(
    threadId,
    "user",
    context.slack.currentMessage.text
  );

  const executionLog: ExecutionLogEntry[] = [];

  const promptPromise = session.client.session.prompt({
    path: { id: "default" },
    body: {
      parts: [{ type: "text", text: decision.prompt || "Execute the user's request." }]
    }
  });

  try {
    const events = await session.client.global.event();
    for await (const event of events.stream) {
      const eventType = (event as { type?: string }).type;
      if (eventType === "command.executed") {
        const command = (event as { properties?: { command?: string } }).properties?.command;
        if (command) {
          await slack.startTyping(threadId, `Running: ${command}`);
          executionLog.push({
            type: "command",
            command,
            output: "",
            timestamp: new Date(),
            success: true
          });
        }
      }
    }
  } catch (error) {
    deps.logger.warn({ threadId, error }, "Event subscription error (non-critical)");
  }

  const response = await promptPromise;
  const responseData = response.data;

  if (!responseData) {
    throw new Error("No response from sandbox");
  }

  const responseText = extractResponseText(responseData);
  enrichExecutionLogWithOutputs(executionLog, responseText);

  await deps.sessionManager.saveMessage(
    threadId,
    "assistant",
    responseText,
    { executionLog }
  );

  await deps.sessionManager.updateLastActivity(threadId);

  const formattedResponse = formatResponse(responseText);
  await thread.post(formattedResponse);

  deps.logger.info({ threadId }, "Sandbox execution complete");
};

const getOrCreateSandboxSession = async (
  deps: HandleMentionDeps,
  threadId: string,
  context: AgentContext.AgentContext
): Promise<{ sessionId: string; volumeId: string; client: ReturnType<typeof import("../sandbox/index.js")["createOpencodeClient"]> }> => {
  const dbSession = await deps.sessionManager.getSession(threadId);

  if (dbSession && dbSession.status === "active") {
    const isActive = await deps.sandbox.isSandboxActive(dbSession.codeInterpreterId);
    
    if (isActive) {
      deps.logger.info({ threadId, sessionId: dbSession.codeInterpreterId }, "Reusing existing active session");
      return {
        sessionId: dbSession.codeInterpreterId,
        volumeId: dbSession.volumeId,
        client: null as unknown as ReturnType<typeof import("../sandbox/index.js")["createOpencodeClient"]>
      };
    } else {
      deps.logger.info({ threadId, sessionId: dbSession.codeInterpreterId }, "Session inactive, stopping");
      await deps.sandbox.stopSandbox(dbSession.codeInterpreterId);
    }
  }

  const userId = context.slack.currentMessage.author;
  const sandbox = await deps.sandbox.getOrCreateSession(threadId, userId);

  await deps.sessionManager.createSession(
    threadId,
    sandbox.sessionId,
    sandbox.volumeId,
    {
      user: { id: userId, name: userId },
      channel: { id: context.slack.channel.id, name: context.slack.channel.name }
    }
  );

  return {
    sessionId: sandbox.sessionId,
    volumeId: sandbox.volumeId,
    client: sandbox.client
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
  for (const entry of executionLog) {
    const lines = responseText.split("\n");
    let foundOutput = false;
    let outputLines: string[] = [];

    for (const line of lines) {
      if (line.includes(entry.command.substring(0, 30))) {
        foundOutput = true;
        continue;
      }

      if (foundOutput && (line.startsWith("#") || line.startsWith("---"))) {
        break;
      }

      if (foundOutput) {
        outputLines.push(line);
      }
    }

    if (outputLines.length > 0) {
      entry.output = outputLines.join("\n").substring(0, 1000);
    } else {
      entry.output = responseText.substring(0, 500);
    }

    entry.success = !(
      entry.output.toLowerCase().includes("error") ||
      entry.output.toLowerCase().includes("failed") ||
      entry.output.toLowerCase().includes("fatal")
    );
  }
};
