import { EC2Client, CreateVolumeCommand, DeleteVolumeCommand } from "@aws-sdk/client-ec2";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { getConfig } from "./config/env";
import { logger } from "./config/logger";

export interface Sandbox {
  threadId: string;
  sessionArn: string;
  volumeId: string;
  opencodeUrl: string;
  password: string;
  createdAt: Date;
  lastActivity: Date;
}

const sandboxes: Map<string, Sandbox> = new Map();

const config = getConfig();

const ec2Client = new EC2Client({ region: config.AWS_REGION });

const isSandboxAlive = async (sandbox: Sandbox): Promise<boolean> => {
  try {
    const client = createOpencodeClient({
      baseUrl: sandbox.opencodeUrl
    });
    
    await client.session.init({
      path: { id: "default" },
      body: {
        messageID: "ping",
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet-20241022"
      }
    });
    
    return true;
  } catch {
    return false;
  }
};

export const getSandbox = async (threadId: string): Promise<Sandbox | undefined> => {
  const sandbox = sandboxes.get(threadId);
  
  if (!sandbox) {
    return undefined;
  }
  
  const alive = await isSandboxAlive(sandbox);
  
  if (!alive) {
    logger.info({ threadId }, "Sandbox no longer alive, cleaning up");
    await destroySandbox(threadId);
    return undefined;
  }
  
  sandbox.lastActivity = new Date();
  return sandbox;
};

export const createSandbox = async (threadId: string, _userId: string): Promise<Sandbox> => {
  logger.info({ threadId }, "Creating sandbox");
  
  const volume = await createVolume(threadId);
  logger.info({ threadId, volumeId: volume.volumeId }, "Volume created");
  
  const sessionArn = await createBedrockSession(threadId, volume.volumeId);
  logger.info({ threadId, sessionArn }, "Bedrock session created");
  
  const opencodeUrl = await waitForSandbox(sessionArn);
  logger.info({ threadId, opencodeUrl }, "Sandbox ready");
  
  const sandbox: Sandbox = {
    threadId,
    sessionArn,
    volumeId: volume.volumeId,
    opencodeUrl,
    password: config.OPENCODE_SERVER_PASSWORD,
    createdAt: new Date(),
    lastActivity: new Date()
  };
  
  sandboxes.set(threadId, sandbox);
  
  await configureSandbox(sandbox);
  logger.info({ threadId }, "Sandbox configured");
  
  return sandbox;
};

export const createOpencodeClientForSandbox = (sandbox: Sandbox) => {
  return createOpencodeClient({
    baseUrl: sandbox.opencodeUrl
  });
};

const createVolume = async (threadId: string): Promise<{ volumeId: string }> => {
  const result = await ec2Client.send(new CreateVolumeCommand({
    AvailabilityZone: config.AWS_AVAILABILITY_ZONE,
    Size: 10,
    VolumeType: "gp3",
    Encrypted: true,
    KmsKeyId: config.KMS_KEY_ID,
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
};

const createBedrockSession = async (threadId: string, _volumeId: string): Promise<string> => {
  const envVars: Record<string, string> = {
    NEW_RELIC_API_KEY: config.NEW_RELIC_API_KEY,
    GITHUB_TOKEN: config.GITHUB_TOKEN,
    AWS_REGION: config.AWS_REGION,
    GURT_THREAD_ID: threadId,
    OPENCODE_SERVER_PASSWORD: config.OPENCODE_SERVER_PASSWORD
  };
  
  if (config.AWS_ACCESS_KEY_ID) {
    envVars.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
    envVars.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY!;
    if (config.AWS_SESSION_TOKEN) {
      envVars.AWS_SESSION_TOKEN = config.AWS_SESSION_TOKEN;
    }
  }
  
  return `arn:aws:bedrock-agentcore:session:${threadId}`;
};

const waitForSandbox = async (_sessionArn: string): Promise<string> => {
  await new Promise(resolve => setTimeout(resolve, 5000));
  return `http://localhost:4096`;
};

const configureSandbox = async (sandbox: Sandbox): Promise<void> => {
  const client = createOpencodeClientForSandbox(sandbox);
  await client.session.init({
    path: { id: "default" },
    body: {
      messageID: "init",
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet-20241022"
    }
  });
};

export const destroySandbox = async (threadId: string): Promise<void> => {
  const sandbox = sandboxes.get(threadId);
  if (!sandbox) return;
  
  logger.info({ threadId }, "Destroying sandbox");
  
  try {
    await ec2Client.send(new DeleteVolumeCommand({
      VolumeId: sandbox.volumeId
    }));
    logger.info({ threadId, volumeId: sandbox.volumeId }, "EBS volume deleted");
  } catch (error) {
    logger.error({ threadId, error }, "Failed to delete EBS volume");
  }
  
  sandboxes.delete(threadId);
  logger.info({ threadId }, "Sandbox destroyed");
};
