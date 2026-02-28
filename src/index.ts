import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { db } from "./config/database.js";
import { logger } from "./config/logger.js";
import { getConfig } from "./config/env.js";
import * as AgentController from "./core/agent-controller.js";
import * as SessionManager from "./core/session-manager.js";
import { createPostgresState } from "./adapters/state-postgres.js";
import {
  createSandbox,
  isSandboxActive,
  createClient,
  stopSandbox
} from "./sandbox.js";

const config = getConfig();

// Create root dependencies
const sessionManagerDeps: SessionManager.SessionManagerDeps = {
  db,
  logger
};

// Create AI model
const model = bedrock(config.MODEL_ID);

// Create bot with PostgreSQL state adapter
const bot = new Chat({
  userName: "gurt",
  adapters: {
    slack: createSlackAdapter()
  },
  state: createPostgresState(db)
});

// Create bound handlers with injected dependencies
const createHandleMention = (): ((thread: Parameters<typeof AgentController.handleMention>[1], message: Parameters<typeof AgentController.handleMention>[2]) => Promise<void>) => {
  const deps: AgentController.HandleMentionDeps = {
    logger,
    model,
    opencodePassword: config.OPENCODE_SERVER_PASSWORD,
    sessionManager: {
      getSession: (threadId) => SessionManager.getSession(sessionManagerDeps, threadId),
      createSession: (threadId, codeInterpreterId, volumeId, context) =>
        SessionManager.createSession(sessionManagerDeps, threadId, codeInterpreterId, volumeId, context),
      updateLastActivity: (threadId) => SessionManager.updateLastActivity(sessionManagerDeps, threadId),
      saveMessage: (threadId, role, content, metadata) =>
        SessionManager.saveMessage(sessionManagerDeps, threadId, role, content, metadata),
      getConversationHistory: (threadId, limit) =>
        SessionManager.getConversationHistory(sessionManagerDeps, threadId, limit)
    },
    sandbox: {
      createSandbox,
      isSandboxActive,
      createOpencodeClient: createClient,
      stopSandbox
    }
  };

  return (thread, message) => AgentController.handleMention(deps, thread, message);
};

const handleMention = createHandleMention();

// Handle new mentions
bot.onNewMention(async (thread, message) => {
  await handleMention(thread, message);
});

// Handle follow-up messages in subscribed threads
if (bot.onSubscribedMessage) {
  bot.onSubscribedMessage(async (thread, message) => {
    await handleMention(thread, message);
  });
}

logger.info("Gurt bot is running with functional architecture, dependency injection, and database-backed sessions");
