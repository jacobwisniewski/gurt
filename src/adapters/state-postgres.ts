import type { Kysely } from "kysely";
import type { Database } from "../config/database.js";

export interface Lock {
  expiresAt: number;
  threadId: string;
  token: string;
}

export interface StateAdapter {
  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null>;
  connect(): Promise<void>;
  delete(key: string): Promise<void>;
  disconnect(): Promise<void>;
  extendLock(lock: Lock, ttlMs: number): Promise<boolean>;
  get<T = unknown>(key: string): Promise<T | null>;
  isSubscribed(threadId: string): Promise<boolean>;
  releaseLock(lock: Lock): Promise<void>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  subscribe(threadId: string): Promise<void>;
  unsubscribe(threadId: string): Promise<void>;
}

export class PostgresStateAdapter implements StateAdapter {
  constructor(private db: Kysely<Database>) {}

  async connect(): Promise<void> {
    // PostgreSQL is already connected via Kysely
    // Clean up expired entries on connect
    await this.cleanupExpired();
  }

  async disconnect(): Promise<void> {
    // Kysely handles connection pooling
  }

  async subscribe(threadId: string): Promise<void> {
    await this.db
      .insertInto("thread_subscriptions")
      .values({
        thread_id: threadId,
        created_at: new Date(),
      })
      .onConflict((oc) => oc.column("thread_id").doNothing())
      .execute();
  }

  async unsubscribe(threadId: string): Promise<void> {
    await this.db
      .deleteFrom("thread_subscriptions")
      .where("thread_id", "=", threadId)
      .execute();
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom("thread_subscriptions")
      .where("thread_id", "=", threadId)
      .select("thread_id")
      .executeTakeFirst();

    return !!result;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const token = this.generateToken();

    // First, clean up any expired locks for this thread
    await this.db
      .deleteFrom("state_locks")
      .where("thread_id", "=", threadId)
      .where("expires_at", "<", new Date())
      .execute();

    try {
      // Try to acquire the lock
      await this.db
        .insertInto("state_locks")
        .values({
          thread_id: threadId,
          token,
          expires_at: new Date(expiresAt),
          created_at: new Date(),
        })
        .execute();

      return {
        expiresAt,
        threadId,
        token,
      };
    } catch {
      // Lock already exists
      return null;
    }
  }

  async releaseLock(lock: Lock): Promise<void> {
    await this.db
      .deleteFrom("state_locks")
      .where("thread_id", "=", lock.threadId)
      .where("token", "=", lock.token)
      .execute();
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const newExpiresAt = Date.now() + ttlMs;

    const result = await this.db
      .updateTable("state_locks")
      .set({ expires_at: new Date(newExpiresAt) })
      .where("thread_id", "=", lock.threadId)
      .where("token", "=", lock.token)
      .where("expires_at", ">", new Date())
      .executeTakeFirst();

    return (result.numUpdatedRows ?? 0) > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    // Clean up expired entry if it exists
    await this.cleanupExpiredKey(key);

    const result = await this.db
      .selectFrom("state_cache")
      .where("key", "=", key)
      .select("value")
      .executeTakeFirst();

    return result ? (result.value as T) : null;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    await this.db
      .insertInto("state_cache")
      .values({
        key,
        value: JSON.parse(JSON.stringify(value)),
        expires_at: expiresAt,
        created_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: JSON.parse(JSON.stringify(value)),
          expires_at: expiresAt,
        })
      )
      .execute();
  }

  async delete(key: string): Promise<void> {
    await this.db.deleteFrom("state_cache").where("key", "=", key).execute();
  }

  private generateToken(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private async cleanupExpired(): Promise<void> {
    const now = new Date();

    // Clean up expired locks
    await this.db
      .deleteFrom("state_locks")
      .where("expires_at", "<", now)
      .execute();

    // Clean up expired cache entries
    await this.db
      .deleteFrom("state_cache")
      .where("expires_at", "<", now)
      .execute();
  }

  private async cleanupExpiredKey(key: string): Promise<void> {
    await this.db
      .deleteFrom("state_cache")
      .where("key", "=", key)
      .where("expires_at", "<", new Date())
      .execute();
  }
}

export const createPostgresState = (db: Kysely<Database>): StateAdapter => {
  return new PostgresStateAdapter(db);
};
