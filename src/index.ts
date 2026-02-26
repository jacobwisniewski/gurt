import { App } from "@slack/bolt";
import { getConfig } from "./config/env";
import { logger } from "./config/logger";
import { createSandbox, getSandbox, destroySandbox, cleanupInactiveSandboxes, Sandbox } from "./sandbox";

const config = getConfig();

const slackApp = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: config.SLACK_APP_TOKEN
});

const extractResponseText = (data: { parts?: Array<{ type: string; text?: string }> }): string => {
  if (!data.parts || data.parts.length === 0) {
    return "No response";
  }
  
  return data.parts
    .filter(part => part.type === "text")
    .map(part => part.text || "")
    .join("\n");
};

const handleMessage = async (threadId: string, userId: string, text: string, say: (message: { text: string; thread_ts?: string }) => Promise<void>) => {
  logger.info({ threadId, userId }, "Message received");
  
  try {
    const sandbox = await getOrCreateSandbox(threadId, userId);
    const response = await sendToSandbox(sandbox, text);
    const responseText = extractResponseText(response);
    
    await say({
      text: responseText,
      thread_ts: threadId
    });
  } catch (error) {
    logger.error({ threadId, error }, "Error processing message");
    await say({
      text: "Sorry, I encountered an error processing your request.",
      thread_ts: threadId
    });
  }
};

const getOrCreateSandbox = async (threadId: string, userId: string): Promise<Sandbox> => {
  const existing = getSandbox(threadId);
  if (existing) {
    return existing;
  }
  
  return createSandbox(threadId, userId);
};

const sendToSandbox = async (sandbox: Sandbox, text: string): Promise<{ parts: Array<{ type: string; text: string }> }> => {
  const response = await fetch(`${sandbox.opencodeUrl}/session/default/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${Buffer.from(`opencode:${sandbox.password}`).toString("base64")}`
    },
    body: JSON.stringify({
      parts: [{ type: "text", text }]
    })
  });
  
  if (!response.ok) {
    throw new Error(`Sandbox request failed: ${response.statusText}`);
  }
  
  return response.json();
};

slackApp.event("app_mention", async ({ event, say }) => {
  const threadId = event.thread_ts || event.ts;
  const userId = event.user;
  const text = event.text.replace(/<@\w+>/g, "").trim();
  
  await handleMessage(threadId, userId, text, say);
});

slackApp.message(async ({ message, say }) => {
  if (!message.thread_ts) return;
  
  const threadId = message.thread_ts;
  const hasSandbox = getSandbox(threadId);
  
  if (!hasSandbox) return;
  
  const userId = message.user;
  const text = message.text || "";
  
  await handleMessage(threadId, userId, text, say);
});

setInterval(async () => {
  await cleanupInactiveSandboxes(30);
}, 60000);

(async () => {
  await slackApp.start();
  logger.info("Gurt bot is running");
})();
