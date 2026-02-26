import { createOpencodeClient } from "@opencode-ai/sdk";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { EBSClient, CreateVolumeCommand } from "@aws-sdk/client-ec2";
import { getConfig } from "./config/env";
import { logger } from "./config/logger";

interface ThreadSession {
  threadId: string;
  sessionArn: string;
  volumeId: string;
  opencodeUrl: string;
  createdAt: Date;
  lastActivity: Date;
}

export class ThreadSandboxManager {
  private bedrockClient: BedrockAgentCoreClient;
  private ebsClient: EBSClient;
  private sessions: Map<string, ThreadSession> = new Map();
  private config: ReturnType<typeof getConfig>;
  
  constructor() {
    this.config = getConfig();
    this.bedrockClient = new BedrockAgentCoreClient({ region: this.config.AWS_REGION });
    this.ebsClient = new EBSClient({ region: this.config.AWS_REGION });
  }

  /**
   * Get or create a sandbox for a Slack thread
   */
  async getOrCreateSandbox(threadId: string, userId: string): Promise<{
    client: ReturnType<typeof createOpencodeClient>;
    session: ThreadSession;
  }> {
    // Check if session exists and is active
    const existingSession = this.sessions.get(threadId);
    if (existingSession) {
      // Update last activity
      existingSession.lastActivity = new Date();
      return {
        client: createOpencodeClient({ baseUrl: existingSession.opencodeUrl }),
        session: existingSession
      };
    }

    // Create new sandbox
    const session = await this.createSandbox(threadId, userId);
    return {
      client: createOpencodeClient({ baseUrl: session.opencodeUrl }),
      session
    };
  }

  /**
   * Create a new sandbox with persistent volume
   */
  private async createSandbox(threadId: string, userId: string): Promise<ThreadSession> {
    logger.info({ threadId }, 'Creating new sandbox');
    
    // 1. Create EBS volume for persistence
    const volume = await this.createPersistentVolume(threadId);
    logger.info({ threadId, volumeId: volume.volumeId }, 'Created EBS volume');
    
    // 2. Create Bedrock AgentCore session
    const sessionArn = await this.createBedrockSession(threadId, volume.volumeId);
    logger.info({ threadId, sessionArn }, 'Created Bedrock session');
    
    // 3. Wait for container to be ready and get endpoint
    const opencodeUrl = await this.waitForSandboxReady(sessionArn);
    logger.info({ threadId, opencodeUrl }, 'Sandbox ready');
    
    const session: ThreadSession = {
      threadId,
      sessionArn,
      volumeId: volume.volumeId,
      opencodeUrl,
      createdAt: new Date(),
      lastActivity: new Date()
    };
    
    this.sessions.set(threadId, session);
    
    // 4. Configure opencode with API keys
    await this.configureOpencode(session);
    logger.info({ threadId }, 'opencode configured');
    
    return session;
  }

  /**
   * Create EBS volume for thread persistence
   */
  private async createPersistentVolume(threadId: string): Promise<{ volumeId: string }> {
    const result = await this.ebsClient.send(new CreateVolumeCommand({
      AvailabilityZone: this.config.AWS_AVAILABILITY_ZONE,
      Size: 10, // GB, configurable
      VolumeType: "gp3",
      Encrypted: true,
      KmsKeyId: this.config.KMS_KEY_ID,
      TagSpecifications: [{
        ResourceType: "volume",
        Tags: [
          { Key: "Name", Value: `gurt-thread-${threadId}` },
          { Key: "ThreadId", Value: threadId },
          { Key: "ManagedBy", Value: "gurt" }
        ]
      }]
    }));
    
    return { volumeId: result.VolumeId! };
  }

  /**
   * Create Bedrock AgentCore session
   */
  private async createBedrockSession(threadId: string, volumeId: string): Promise<string> {
    // Use AWS SDK to create Bedrock AgentCore session
    // This will spin up a container with our custom image
    // and mount the EBS volume at /home/gurt/workspace
    
    // Build environment variables
    const envVars: Record<string, string> = {
      // API keys passed as env vars
      NEW_RELIC_API_KEY: this.config.NEW_RELIC_API_KEY,
      GITHUB_TOKEN: this.config.GITHUB_TOKEN,
      // AWS credentials for CLI (if provided)
      ...(this.config.AWS_ACCESS_KEY_ID && {
        AWS_ACCESS_KEY_ID: this.config.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: this.config.AWS_SECRET_ACCESS_KEY!,
        ...(this.config.AWS_SESSION_TOKEN && { AWS_SESSION_TOKEN: this.config.AWS_SESSION_TOKEN })
      }),
      AWS_REGION: this.config.AWS_REGION,
      // Thread identification
      GURT_THREAD_ID: threadId,
      OPENCODE_SERVER_PASSWORD: this.config.OPENCODE_SERVER_PASSWORD
    };
    
    const result = await this.bedrockClient.send(new CreateAgentSessionCommand({
      agentName: `gurt-thread-${threadId}`,
      runtimeConfiguration: {
        containerImage: this.config.GURT_CONTAINER_IMAGE,
        environmentVariables: envVars,
        volumes: [{
          name: "workspace",
          ebs: {
            volumeId: volumeId,
            mountPath: "/home/gurt/workspace"
          }
        }]
      },
      maxSessionDuration: 28800 // 8 hours max
    }));
    
    return result.sessionArn!;
  }

  /**
   * Wait for sandbox to be ready and return opencode URL
   */
  private async waitForSandboxReady(sessionArn: string): Promise<string> {
    // Poll Bedrock AgentCore for endpoint
    const maxAttempts = 60;
    const delayMs = 1000;
    
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.bedrockClient.send(new GetAgentSessionCommand({
        sessionArn
      }));
      
      if (status.status === "ACTIVE" && status.endpoint) {
        return status.endpoint;
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    throw new Error("Sandbox failed to start within 60 seconds");
  }

  /**
   * Configure opencode with initial settings
   */
  private async configureOpencode(session: ThreadSession): Promise<void> {
    const client = createOpencodeClient({ baseUrl: session.opencodeUrl });
    
    // Initialize project/workspace
    await client.session.init({
      path: { id: "default" },
      body: {
        messageID: "init",
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet-20241022"
      }
    });
  }

  /**
   * Clean up inactive sessions
   */
  async cleanupInactiveSessions(maxIdleMinutes: number = 30): Promise<void> {
    const now = new Date();
    const maxIdleMs = maxIdleMinutes * 60 * 1000;
    
    for (const [threadId, session] of this.sessions) {
      const idleTime = now.getTime() - session.lastActivity.getTime();
      
      if (idleTime > maxIdleMs) {
        logger.info({ threadId, idleMinutes: Math.round(idleTime / 60000) }, 'Cleaning up inactive session');
        await this.destroySandbox(threadId);
      }
    }
  }

  /**
   * Destroy a sandbox
   */
  async destroySandbox(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;
    
    logger.info({ threadId }, 'Destroying sandbox');
    
    // Stop Bedrock session
    await this.bedrockClient.send(new StopAgentSessionCommand({
      sessionArn: session.sessionArn
    }));
    
    // Note: EBS volume is NOT deleted - it persists for thread history
    // Volume will be re-attached when thread becomes active again
    
    this.sessions.delete(threadId);
    logger.info({ threadId }, 'Sandbox destroyed');
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): ThreadSession[] {
    return Array.from(this.sessions.values());
  }
}

// Placeholder types for AWS SDK commands
// These will be properly typed when we install the actual SDK
declare class CreateAgentSessionCommand {
  constructor(input: unknown);
}

declare class GetAgentSessionCommand {
  constructor(input: unknown);
}

declare class StopAgentSessionCommand {
  constructor(input: unknown);
}
