import { BedrockAgentCoreClient, StartCodeInterpreterSessionCommand, StopCodeInterpreterSessionCommand, GetCodeInterpreterSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import { EC2Client, CreateVolumeCommand, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import { createOpencodeClient as createOpencodeClientFromSdk } from "@opencode-ai/sdk";
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

export type SandboxClient = ReturnType<typeof createOpencodeClientFromSdk>;

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

export const createSandbox = async (threadId: string, _userId: string): Promise<{
  threadId: string;
  codeInterpreterId: string;
  volumeId: string;
  opencodeUrl: string;
}> => {
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
    codeInterpreterIdentifier: `gurt-thread-${threadId}`
  }));
  
  const codeInterpreterId = sessionResult.codeInterpreterIdentifier!;
  const opencodeUrl = `http://localhost:4096`;
  
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
  
  await configureSandbox(sandbox);
  logger.info({ threadId }, "Sandbox configured");
  
  return {
    threadId,
    codeInterpreterId,
    volumeId,
    opencodeUrl
  };
};

export const createClient = (opencodeUrl: string): SandboxClient => {
  return createOpencodeClientFromSdk({
    baseUrl: opencodeUrl
  });
};

const configureSandbox = async (sandbox: Sandbox): Promise<void> => {
  const client = createClient(sandbox.opencodeUrl);
  await client.session.init({
    path: { id: "default" },
    body: {
      messageID: "init",
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet-20241022"
    }
  });
};

export const stopSandbox = async (codeInterpreterId: string): Promise<void> => {
  logger.info({ codeInterpreterId }, "Stopping sandbox");
  
  await bedrockClient.send(new StopCodeInterpreterSessionCommand({
    codeInterpreterIdentifier: codeInterpreterId
  } as any));
  
  logger.info({ codeInterpreterId }, "Sandbox stopped");
};

export const isSandboxActive = async (codeInterpreterId: string): Promise<boolean> => {
  try {
    const result = await bedrockClient.send(new GetCodeInterpreterSessionCommand({
      codeInterpreterIdentifier: codeInterpreterId
    } as any));
    
    const status = result.status as string | undefined;
    const isActive = status !== "STOPPED" && status !== "FAILED";
    
    return isActive;
  } catch {
    return false;
  }
};
