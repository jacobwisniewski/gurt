import type { Kysely } from "kysely";
import type { Database } from "../config/database.js";
import type { Logger } from "pino";

export interface Session {
  threadId: string;
  codeInterpreterId: string;
  volumeId: string;
  status: "active" | "idle" | "stopped";
  contextJson: object;
  createdAt: Date;
  lastActivity: Date;
}

export interface ThreadContext {
  user: {
    id: string;
    name: string;
  };
  channel: {
    id: string;
    name: string;
  };
}

export interface SessionManagerDeps {
  db: Kysely<Database>;
  logger: Logger;
}

export const getSession = async (
  deps: SessionManagerDeps,
  threadId: string
): Promise<Session | null> => {
  const result = await deps.db
    .selectFrom("sandboxes")
    .where("thread_id", "=", threadId)
    .selectAll()
    .executeTakeFirst();

  if (!result) {
    return null;
  }

  return {
    threadId: result.thread_id,
    codeInterpreterId: result.code_interpreter_id,
    volumeId: result.volume_id,
    status: result.status,
    contextJson: result.context_json,
    createdAt: result.created_at,
    lastActivity: result.last_activity,
  };
};

export const createSession = async (
  deps: SessionManagerDeps,
  threadId: string,
  codeInterpreterId: string,
  volumeId: string,
  context: ThreadContext
): Promise<Session> => {
  const now = new Date();

  await deps.db
    .insertInto("sandboxes")
    .values({
      thread_id: threadId,
      code_interpreter_id: codeInterpreterId,
      volume_id: volumeId,
      status: "active",
      context_json: context,
      created_at: now,
      last_activity: now,
    })
    .execute();

  deps.logger.info({ threadId, codeInterpreterId, volumeId }, "Created session in database");

  return {
    threadId,
    codeInterpreterId,
    volumeId,
    status: "active",
    contextJson: context,
    createdAt: now,
    lastActivity: now,
  };
};

export const updateLastActivity = async (
  deps: SessionManagerDeps,
  threadId: string
): Promise<void> => {
  await deps.db
    .updateTable("sandboxes")
    .set({ last_activity: new Date() })
    .where("thread_id", "=", threadId)
    .execute();
};

export const updateStatus = async (
  deps: SessionManagerDeps,
  threadId: string,
  status: "active" | "idle" | "stopped"
): Promise<void> => {
  await deps.db
    .updateTable("sandboxes")
    .set({ status })
    .where("thread_id", "=", threadId)
    .execute();
};

export const deleteSession = async (
  deps: SessionManagerDeps,
  threadId: string
): Promise<void> => {
  await deps.db.deleteFrom("sandboxes").where("thread_id", "=", threadId).execute();
  deps.logger.info({ threadId }, "Deleted session from database");
};

export const saveMessage = async (
  deps: SessionManagerDeps,
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
  metadata?: object
): Promise<void> => {
  const lastMessage = await deps.db
    .selectFrom("messages")
    .where("thread_id", "=", threadId)
    .orderBy("sequence_number", "desc")
    .select("sequence_number")
    .executeTakeFirst();

  const sequenceNumber = (lastMessage?.sequence_number ?? 0) + 1;

  await deps.db
    .insertInto("messages")
    .values({
      thread_id: threadId,
      sequence_number: sequenceNumber,
      role,
      content,
      metadata: metadata ?? {},
      created_at: new Date(),
    })
    .execute();
};

export const getConversationHistory = async (
  deps: SessionManagerDeps,
  threadId: string,
  limit: number = 10
): Promise<
  Array<{
    role: string;
    content: string;
    metadata?: object;
    timestamp: Date;
  }>
> => {
  const messages = await deps.db
    .selectFrom("messages")
    .where("thread_id", "=", threadId)
    .orderBy("sequence_number", "desc")
    .limit(limit)
    .selectAll()
    .execute();

  return messages
    .reverse()
    .map((m) => ({
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      timestamp: m.created_at,
    }));
};
