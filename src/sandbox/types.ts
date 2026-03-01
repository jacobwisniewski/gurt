import type { Logger } from "pino";

export interface SandboxSession {
  threadId: string;
  sessionId: string;
  volumeId: string;
  opencodeUrl: string;
}

export interface SandboxProvider {
  createSandbox(threadId: string, userId: string): Promise<SandboxSession>;
  stopSandbox(sessionId: string): Promise<void>;
  isSandboxActive(sessionId: string): Promise<boolean>;
}

export interface SandboxProviderDeps {
  logger: Logger;
}
