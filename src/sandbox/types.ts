import type { Logger } from "pino";
import type { SandboxClient } from "./client.js";

export interface SandboxSession {
  threadId: string;
  sessionId: string;
  volumeId: string;
  client: SandboxClient;
}

export interface SandboxProvider {
  getOrCreateSession(threadId: string, userId: string): Promise<SandboxSession>;
  stopSandbox(sessionId: string): Promise<void>;
  isSandboxActive(sessionId: string): Promise<boolean>;
  createClientForSession(sessionId: string): SandboxClient;
}

export interface SandboxProviderDeps {
  logger: Logger;
}
