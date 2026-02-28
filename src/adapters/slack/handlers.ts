import type { Chat, Thread, Message } from "chat";
import type { HandleMentionDeps } from "../../core/agent-controller.js";

export type HandleMentionFn = (
  deps: HandleMentionDeps,
  thread: Thread,
  message: Message
) => Promise<void>;

export interface SetupSlackHandlersDeps {
  handleMention: HandleMentionFn;
  deps: HandleMentionDeps;
}

export const setupSlackHandlers = (
  deps: SetupSlackHandlersDeps,
  bot: Chat
): void => {
  bot.onNewMention(async (thread, message) => {
    await deps.handleMention(deps.deps, thread, message);
  });

  // Handle follow-up messages in subscribed threads
  if (bot.onSubscribedMessage) {
    bot.onSubscribedMessage(async (thread, message) => {
      await deps.handleMention(deps.deps, thread, message);
    });
  }
};
