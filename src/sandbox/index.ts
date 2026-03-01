import type { SandboxProvider, SandboxProviderDeps } from "./types.js";
import { createBedrockProvider } from "./providers/bedrock.js";
import { createLocalDockerProvider } from "./providers/local-docker.js";

export type { SandboxProvider, SandboxSession, SandboxProviderDeps } from "./types.js";
export { createOpencodeClient, type SandboxClient } from "./client.js";
export { createBedrockProvider } from "./providers/bedrock.js";
export { createLocalDockerProvider } from "./providers/local-docker.js";

/**
 * Create sandbox provider based on environment configuration
 * Uses SANDBOX_PROVIDER env variable (default: bedrock)
 */
export const createSandboxProvider = (deps: SandboxProviderDeps): SandboxProvider => {
  const provider = process.env.SANDBOX_PROVIDER || "bedrock";
  
  deps.logger.info({ provider }, "Creating sandbox provider");
  
  switch (provider) {
    case "local":
      return createLocalDockerProvider(deps);
    case "bedrock":
    default:
      return createBedrockProvider(deps);
  }
};
