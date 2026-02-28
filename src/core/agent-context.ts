import type { Thread, Message } from "chat";
import type * as SessionManager from "./session-manager.js";

export interface AgentContext {
  slack: {
    channel: {
      id: string;
      name: string;
      type: "public" | "private" | "dm";
    };
    thread: {
      id: string;
      participants: string[];
      messageCount: number;
    };
    currentMessage: {
      text: string;
      author: string;
      timestamp: string;
    };
    history: Array<{
      role: string;
      content: string;
      author: string;
      timestamp: string;
    }>;
  };
  sandbox: {
    sessionId?: string;
    executionHistory: Array<{
      command: string;
      output: string;
      timestamp: Date;
      success: boolean;
    }>;
    currentDirectory?: string;
    gitBranch?: string;
    lastOutput?: string;
  };
}

export interface BuildContextDeps {
  getSession: (threadId: string) => Promise<SessionManager.Session | null>;
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
}

export const buildContext = async (
  deps: BuildContextDeps,
  thread: Thread,
  message: Message
): Promise<AgentContext> => {
  // Build Slack context with safe property access
  const slackContext = {
    channel: {
      id: thread.channel.id,
      name: thread.channel.name ?? "unknown",
      type: ((thread.channel as { type?: string }).type ?? "public") as "public" | "private" | "dm"
    },
    thread: {
      id: thread.id,
      participants: ((thread as { participants?: Array<{ name?: string }> }).participants ?? []).map(
        (p: { name?: string }) => p.name ?? "unknown"
      ),
      messageCount: (thread as { messageCount?: number }).messageCount ?? 0
    },
    currentMessage: {
      text: message.text,
      author: (message.author as { name?: string }).name ?? "unknown",
      timestamp: (message as { timestamp?: string }).timestamp ?? new Date().toISOString()
    },
    history: await getThreadHistory(deps, thread.id)
  };

  // Build Sandbox context
  const session = await deps.getSession(thread.id);
  const history = session
    ? await deps.getConversationHistory(thread.id, 10)
    : [];

  // Extract execution history from message metadata
  const executionHistory = extractExecutionHistory(history);

  const sandboxContext = session
    ? {
        sessionId: session.codeInterpreterId,
        executionHistory,
        currentDirectory: undefined,
        gitBranch: undefined,
        lastOutput: history.length > 0 ? history[history.length - 1].content : undefined
      }
    : {
        executionHistory: []
      };

  return {
    slack: slackContext,
    sandbox: sandboxContext
  };
};

const getThreadHistory = async (
  deps: BuildContextDeps,
  threadId: string
): Promise<
  Array<{
    role: string;
    content: string;
    author: string;
    timestamp: string;
  }>
> => {
  const messages = await deps.getConversationHistory(threadId, 20);

  return messages.map(m => ({
    role: m.role,
    content: m.content,
    author: m.role === "user" ? "user" : "assistant",
    timestamp: m.timestamp.toISOString()
  }));
};

const extractExecutionHistory = (
  messages: Array<{ metadata?: object; timestamp: Date }>
): Array<{
  command: string;
  output: string;
  timestamp: Date;
  success: boolean;
}> => {
  const history: Array<{
    command: string;
    output: string;
    timestamp: Date;
    success: boolean;
  }> = [];

  for (const message of messages) {
    const metadata = message.metadata as
      | {
          executionLog?: Array<{
            type: string;
            command: string;
            output: string;
            timestamp: string;
            success: boolean;
          }>;
        }
      | undefined;

    if (metadata?.executionLog) {
      for (const entry of metadata.executionLog) {
        if (entry.type === "command") {
          history.push({
            command: entry.command,
            output: entry.output,
            timestamp: new Date(entry.timestamp),
            success: entry.success
          });
        }
      }
    }
  }

  // Return most recent first, limited to last 10 commands
  return history.reverse().slice(0, 10);
};
