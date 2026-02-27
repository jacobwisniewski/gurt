import { db } from "../config/database.js";
import { logger } from "../config/logger.js";

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

export class SessionManager {
  async getSession(threadId: string): Promise<Session | null> {
    const result = await db
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
  }

  async createSession(
    threadId: string,
    codeInterpreterId: string,
    volumeId: string,
    context: ThreadContext
  ): Promise<Session> {
    const now = new Date();

    await db
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

    logger.info({ threadId, codeInterpreterId, volumeId }, "Created session in database");

    return {
      threadId,
      codeInterpreterId,
      volumeId,
      status: "active",
      contextJson: context,
      createdAt: now,
      lastActivity: now,
    };
  }

  async updateLastActivity(threadId: string): Promise<void> {
    await db
      .updateTable("sandboxes")
      .set({ last_activity: new Date() })
      .where("thread_id", "=", threadId)
      .execute();
  }

  async updateStatus(
    threadId: string,
    status: "active" | "idle" | "stopped"
  ): Promise<void> {
    await db
      .updateTable("sandboxes")
      .set({ status })
      .where("thread_id", "=", threadId)
      .execute();
  }

  async deleteSession(threadId: string): Promise<void> {
    await db.deleteFrom("sandboxes").where("thread_id", "=", threadId).execute();
    logger.info({ threadId }, "Deleted session from database");
  }

  async saveMessage(
    threadId: string,
    role: "user" | "assistant" | "system",
    content: string,
    metadata?: object
  ): Promise<void> {
    const lastMessage = await db
      .selectFrom("messages")
      .where("thread_id", "=", threadId)
      .orderBy("sequence_number", "desc")
      .select("sequence_number")
      .executeTakeFirst();

    const sequenceNumber = (lastMessage?.sequence_number ?? 0) + 1;

    await db
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
  }

  async getConversationHistory(
    threadId: string,
    limit: number = 10
  ): Promise<
    Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>
  > {
    const messages = await db
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
        timestamp: m.created_at,
      }));
  }
}
