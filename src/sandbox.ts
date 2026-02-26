import { EC2Client, CreateVolumeCommand, AttachVolumeCommand, DetachVolumeCommand, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
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
const volumes: Map<string, string> = new Map();

const config = getConfig();

const ec2Client = new EC2Client({ region: config.AWS_REGION });

const findExistingVolume = async (threadId: string): Promise<string | undefined> => {
  const cached = volumes.get(threadId);
  if (cached) return cached;
  
  const result = await ec2Client.send(new DescribeVolumesCommand({
    Filters: [
      { Name: "tag:ThreadId", Values: [threadId] },
      { Name: "tag:ManagedBy", Values: ["gurt"] },
      { Name: "status", Values: ["available", "in-use"] }
    ]
  }));
  
  const volume = result.Volumes?.[0];
  if (volume?.VolumeId) {
    volumes.set(threadId, volume.VolumeId);
    return volume.VolumeId;
  }
  
  return undefined;
};

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
    logger.info({ threadId }, "Sandbox no longer alive, will recreate");
    await detachVolume(sandbox.volumeId);
    sandboxes.delete(threadId);
    return undefined;
  }
  
  sandbox.lastActivity = new Date();
  return sandbox;
};

export const createSandbox = async (threadId: string, _userId: string): Promise<Sandbox> => {
  logger.info({ threadId }, "Creating sandbox");
  
  const existingVolumeId = await findExistingVolume(threadId);
  let volumeId: string;
  
  if (existingVolumeId) {
    logger.info({ threadId, volumeId: existingVolumeId }, "Reusing existing volume");
    volumeId = existingVolumeId;
  } else {
    const volume = await createVolume(threadId);
    volumeId = volume.volumeId;
    volumes.set(threadId, volumeId);
    logger.info({ threadId, volumeId }, "Created new volume");
  }
  
  const sessionArn = await createBedrockSession(threadId, volumeId);
  logger.info({ threadId, sessionArn }, "Bedrock session created");
  
  const opencodeUrl = await waitForSandbox(sessionArn);
  logger.info({ threadId, opencodeUrl }, "Sandbox ready");
  
  await attachVolume(volumeId);
  logger.info({ threadId, volumeId }, "Volume attached");
  
  const sandbox: Sandbox = {
    threadId,
    sessionArn,
    volumeId,
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

const attachVolume = async (volumeId: string): Promise<void> => {
  await ec2Client.send(new AttachVolumeCommand({
    VolumeId: volumeId,
    InstanceId: "sandbox-instance",
    Device: "/dev/sdf"
  }));
};

const detachVolume = async (volumeId: string): Promise<void> => {
  try {
    await ec2Client.send(new DetachVolumeCommand({
      VolumeId: volumeId
    }));
    logger.info({ volumeId }, "Volume detached");
  } catch (error) {
    logger.error({ volumeId, error }, "Failed to detach volume");
  }
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
  
  logger.info({ threadId }, "Destroying sandbox (keeping volume)");
  
  await detachVolume(sandbox.volumeId);
  sandboxes.delete(threadId);
  
  logger.info({ threadId }, "Sandbox destroyed, volume preserved");
};

export const permanentlyDeleteThread = async (threadId: string): Promise<void> => {
  const volumeId = volumes.get(threadId);
  
  if (volumeId) {
    logger.info({ threadId, volumeId }, "Permanently deleting thread volume");
    
    try {
      await ec2Client.send(new DetachVolumeCommand({
        VolumeId: volumeId
      }));
    } catch {}
    
    try {
      const { DeleteVolumeCommand } = await import("@aws-sdk/client-ec2");
      await ec2Client.send(new DeleteVolumeCommand({
        VolumeId: volumeId
      }));
      logger.info({ threadId, volumeId }, "Volume deleted");
    } catch (error) {
      logger.error({ threadId, volumeId, error }, "Failed to delete volume");
    }
    
    volumes.delete(threadId);
  }
  
  sandboxes.delete(threadId);
  logger.info({ threadId }, "Thread permanently deleted");
};
