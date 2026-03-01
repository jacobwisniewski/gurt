import { BedrockAgentCoreClient, StartCodeInterpreterSessionCommand, StopCodeInterpreterSessionCommand, GetCodeInterpreterSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import { EC2Client, CreateVolumeCommand, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import type { SandboxProvider, SandboxSession, SandboxProviderDeps } from "../types.js";
import { createOpencodeClient } from "../client.js";
import { getConfig } from "../../config/env.js";

const config = getConfig();

const bedrockClient = new BedrockAgentCoreClient({ region: config.AWS_REGION });
const ec2Client = new EC2Client({ region: config.AWS_REGION });

const BEDROCK_OPENCODE_URL = "http://localhost:4096";

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

export const createBedrockProvider = (deps: SandboxProviderDeps): SandboxProvider => {
  const { logger } = deps;

  return {
    getOrCreateSession: async (threadId: string, userId: string): Promise<SandboxSession> => {
      logger.info({ threadId, userId }, "Getting or creating Bedrock sandbox");
      
      const existingVolumeId = await findExistingVolume(threadId);
      let volumeId: string;
      
      if (existingVolumeId) {
        logger.info({ threadId, volumeId: existingVolumeId }, "Reusing existing EBS volume");
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
        logger.info({ threadId, volumeId }, "Created new EBS volume");
      }
      
      const sessionResult = await bedrockClient.send(new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: `gurt-thread-${threadId}`
      }));
      
      const codeInterpreterId = sessionResult.codeInterpreterIdentifier!;
      
      logger.info({ threadId, codeInterpreterId }, "Bedrock session created");
      
      return {
        threadId,
        sessionId: codeInterpreterId,
        volumeId,
        client: createOpencodeClient(BEDROCK_OPENCODE_URL)
      };
    },

    stopSandbox: async (sessionId: string): Promise<void> => {
      logger.info({ sessionId }, "Stopping Bedrock sandbox");
      
      await bedrockClient.send(new StopCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: sessionId
      } as any));
      
      logger.info({ sessionId }, "Bedrock sandbox stopped");
    },

    isSandboxActive: async (sessionId: string): Promise<boolean> => {
      try {
        const result = await bedrockClient.send(new GetCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: sessionId
        } as any));
        
        const status = result.status as string | undefined;
        return status !== "STOPPED" && status !== "FAILED";
      } catch {
        return false;
      }
    }
  };
};
