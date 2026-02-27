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
  id: number;
  thread_id: string;
  sequence_number: number;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: object;
  created_at: Date;
}

export interface Database {
  sandboxes: SandboxTable;
  messages: MessageTable;
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: config.DATABASE_URL,
    }),
  }),
});
