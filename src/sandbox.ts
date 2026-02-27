import { BedrockAgentCoreClient, StartCodeInterpreterSessionCommand, StopCodeInterpreterSessionCommand, GetCodeInterpreterSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import { EC2Client, CreateVolumeCommand, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { getConfig } from "./config/env";
import { logger } from "./config/logger";

export interface Sandbox {
  threadId: string;
  codeInterpreterId: string;
  volumeId: string;
  opencodeUrl: string;
  password: string;
  createdAt: Date;
  lastActivity: Date;
}

const sandboxes: Map<string, Sandbox> = new Map();

const config = getConfig();

const bedrockClient = new BedrockAgentCoreClient({ region: config.AWS_REGION });
const ec2Client = new EC2Client({ region: config.AWS_REGION });

const findExistingVolume = async (threadId: string): Promise<string | undefined> => {
  const result = await ec2Client.send(new DescribeVolumesCommand({
    Filters: [
      { Name: "tag:ThreadId", Values: [threadId] },
      { Name: "tag:ManagedBy", Values: ["gurt"] },
      { Name: "status", Values: ["available", "in-use"] }
    ]
  }));
  
  const volume = result.Volumes?.[0];
  return volume?.VolumeId;
};

export const getSandbox = (threadId: string): Sandbox | undefined => {
  const sandbox = sandboxes.get(threadId);
  
  if (sandbox) {
    sandbox.lastActivity = new Date();
  }
  
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
    const volume = await ec2Client.send(new CreateVolumeCommand({
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
    
    volumeId = volume.VolumeId!;
    logger.info({ threadId, volumeId }, "Created new volume");
  }
  
  const sessionResult = await bedrockClient.send(new StartCodeInterpreterSessionCommand({
    codeInterpreterIdentifier: `gurt-thread-${threadId}`,
    environmentVariables: {
      NEW_RELIC_API_KEY: config.NEW_RELIC_API_KEY,
      GITHUB_TOKEN: config.GITHUB_TOKEN,
      AWS_REGION: config.AWS_REGION,
      GURT_THREAD_ID: threadId,
      OPENCODE_SERVER_PASSWORD: config.OPENCODE_SERVER_PASSWORD,
      GURT_VOLUME_ID: volumeId
    }
  }));
  
  const codeInterpreterId = sessionResult.codeInterpreterIdentifier!;
  const opencodeUrl = sessionResult.endpoint || `http://localhost:4096`;
  
  logger.info({ threadId, codeInterpreterId, opencodeUrl }, "Bedrock session created");
  
  const sandbox: Sandbox = {
    threadId,
    codeInterpreterId,
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

export const stopSandbox = async (threadId: string): Promise<void> => {
  const sandbox = sandboxes.get(threadId);
  if (!sandbox) return;
  
  logger.info({ threadId, codeInterpreterId: sandbox.codeInterpreterId }, "Stopping sandbox");
  
  await bedrockClient.send(new StopCodeInterpreterSessionCommand({
    codeInterpreterIdentifier: sandbox.codeInterpreterId
  }));
  
  sandboxes.delete(threadId);
  logger.info({ threadId }, "Sandbox stopped");
};

export const isSandboxActive = async (threadId: string): Promise<boolean> => {
  const sandbox = sandboxes.get(threadId);
  if (!sandbox) return false;
  
  try {
    const result = await bedrockClient.send(new GetCodeInterpreterSessionCommand({
      codeInterpreterIdentifier: sandbox.codeInterpreterId
    }));
    
    const isActive = result.status !== "STOPPED" && result.status !== "FAILED";
    
    if (!isActive) {
      sandboxes.delete(threadId);
    }
    
    return isActive;
  } catch {
    sandboxes.delete(threadId);
    return false;
  }
};
