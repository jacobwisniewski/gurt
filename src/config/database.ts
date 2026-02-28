import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { getConfig } from "./env.js";

const config = getConfig();

export interface SandboxTable {
  thread_id: string;
  code_interpreter_id: string;
  volume_id: string;
  status: "active" | "idle" | "stopped";
  context_json: object;
  created_at: Date;
  last_activity: Date;
}

export interface MessageTable {
  id?: number; // Optional for inserts (auto-increment)
  thread_id: string;
  sequence_number: number;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: object;
  created_at: Date;
}

export interface ThreadSubscriptionTable {
  thread_id: string;
  created_at: Date;
}

export interface StateCacheTable {
  key: string;
  value: object;
  expires_at: Date | null;
  created_at: Date;
}

export interface StateLockTable {
  thread_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

export interface Database {
  sandboxes: SandboxTable;
  messages: MessageTable;
  thread_subscriptions: ThreadSubscriptionTable;
  state_cache: StateCacheTable;
  state_locks: StateLockTable;
}

const buildConnectionString = (): string => {
  if (config.DATABASE_URL) {
    return config.DATABASE_URL;
  }

  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB } = config;
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
};

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: buildConnectionString(),
    }),
  }),
});
