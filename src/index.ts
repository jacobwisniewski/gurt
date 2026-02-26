import { ThreadSandboxManager } from "./sandbox-manager";
import { App } from "@slack/bolt";
import { getConfig } from "./config/env";
import { logger } from "./config/logger";

// Get validated configuration
const config = getConfig();

const sandboxManager = new ThreadSandboxManager();

// Initialize Slack app
const slackApp = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: config.SLACK_APP_TOKEN
});

// Handle app mentions
slackApp.event("app_mention", async ({ event, say }) => {
  const threadId = event.thread_ts || event.ts;
  const userId = event.user;
  const text = event.text.replace(/<@\w+>/g, "").trim();
  
  logger.info({ threadId, userId }, 'Received app mention');
  
  try {
    // Get or create sandbox for this thread
    const { client } = await sandboxManager.getOrCreateSandbox(threadId, userId);
    
    // Send message to opencode
    const response = await client.session.prompt({
      path: { id: "default" },
      body: {
        parts: [{ type: "text", text }]
      }
    });
    
    // Send response back to Slack
    const responseText = extractResponseText(response.data);
    await say({
      text: responseText,
      thread_ts: threadId
    });
    
  } catch (error) {
    logger.error({ threadId, error }, 'Error processing app mention');
    await say({
      text: "Sorry, I encountered an error processing your request.",
      thread_ts: threadId
    });
  }
});

// Handle messages in threads
slackApp.message(async ({ message, say }) => {
  // Only respond to messages in threads where gurt is active
  if (!message.thread_ts) return;
  
  const threadId = message.thread_ts;
  const userId = message.user;
  const text = message.text;
  
  // Check if we have an active session for this thread
  const activeSessions = sandboxManager.getActiveSessions();
  const hasSession = activeSessions.some(s => s.threadId === threadId);
  
  if (!hasSession) return; // Not our thread
  
  logger.info({ threadId, userId }, 'Received thread message');
  
  try {
    const { client } = await sandboxManager.getOrCreateSandbox(threadId, userId);
    
    const response = await client.session.prompt({
      path: { id: "default" },
      body: {
        parts: [{ type: "text", text }]
      }
    });
    
    const responseText = extractResponseText(response.data);
    await say({
      text: responseText,
      thread_ts: threadId
    });
    
  } catch (error) {
    logger.error({ threadId, error }, 'Error processing thread message');
    await say({
      text: "Sorry, I encountered an error processing your request.",
      thread_ts: threadId
    });
  }
});

// Extract text from opencode response
function extractResponseText(data: any): string {
  if (!data.parts || data.parts.length === 0) {
    return "No response";
  }
  
  // Concatenate all text parts
  return data.parts
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n");
}

// Cleanup inactive sessions periodically
setInterval(async () => {
  await sandboxManager.cleanupInactiveSessions(30);
}, 60000); // Every minute

// Start the app
(async () => {
  await slackApp.start();
  logger.info('Gurt bot is running');
})();
