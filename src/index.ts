import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { logger } from "./config/logger";
import { createSandbox, getSandbox, createOpencodeClientForSandbox } from "./sandbox";

const bot = new Chat({
  userName: "gurt",
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState(),
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

bot.onNewMention(async (thread, message) => {
  const threadId = thread.id;
  const userId = (message.author as { id?: string }).id || "unknown";
  
  logger.info({ threadId, userId }, "Mention received");
  
  try {
    const sandbox = await getOrCreateSandbox(threadId, userId);
    const client = createOpencodeClientForSandbox(sandbox);
    
    const response = await client.session.prompt({
      path: { id: "default" },
      body: {
        parts: [{ type: "text", text: message.text }]
      }
    });
    
    const responseData = response.data;
    
    if (!responseData) {
      throw new Error("No response from sandbox");
    }
    
    const responseText = extractResponseText(responseData);
    await thread.post(responseText);
  } catch (error) {
    logger.error({ threadId, error }, "Error processing mention");
    await thread.post("Sorry, I encountered an error processing your request.");
  }
});



const getOrCreateSandbox = async (threadId: string, userId: string) => {
  const existing = await getSandbox(threadId);
  if (existing) {
    return existing;
  }

  return createSandbox(threadId, userId);
};

logger.info("Gurt bot is running");
