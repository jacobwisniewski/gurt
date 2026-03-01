import Docker from "dockerode";
import type { SandboxProvider, SandboxSession, SandboxProviderDeps } from "../types.js";
import { createOpencodeClient, type SandboxClient } from "../client.js";
import { getPortForThread, getNextPort } from "../utils/port-manager.js";
import { getConfig } from "../../config/env.js";

const config = getConfig();

const CONTAINER_PREFIX = "gurt-sandbox";
const VOLUME_PREFIX = "gurt-workspace";
const IMAGE_NAME = process.env.LOCAL_SANDBOX_IMAGE || "gurt-sandbox:latest";

/**
 * Sanitize threadId for use in Docker resource names
 * Replaces special characters with dashes
 */
const sanitizeName = (threadId: string): string => {
  return threadId.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
};

/**
 * Get container name for thread
 */
const getContainerName = (threadId: string): string => {
  return `${CONTAINER_PREFIX}-${sanitizeName(threadId)}`;
};

/**
 * Get volume name for thread
 */
const getVolumeName = (threadId: string): string => {
  return `${VOLUME_PREFIX}-${sanitizeName(threadId)}`;
};

/**
 * Check if a port is available
 */
const isPortAvailable = async (docker: Docker, port: number): Promise<boolean> => {
  try {
    const containers = await docker.listContainers();
    for (const container of containers) {
      if (container.Ports) {
        for (const portMapping of container.Ports) {
          if (portMapping.PublicPort === port) {
            return false;
          }
        }
      }
    }
    return true;
  } catch {
    return true;
  }
};

/**
 * Find an available port starting from the deterministic port
 */
const findAvailablePort = async (docker: Docker, threadId: string): Promise<number> => {
  const basePort = getPortForThread(threadId);
  let port = basePort;
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    if (await isPortAvailable(docker, port)) {
      return port;
    }
    port = getNextPort(port);
    attempts++;
  }

  throw new Error(`Could not find available port after ${maxAttempts} attempts`);
};

/**
 * Ensure volume exists
 */
const ensureVolume = async (docker: Docker, volumeName: string): Promise<void> => {
  try {
    const volume = docker.getVolume(volumeName);
    await volume.inspect();
  } catch {
    await docker.createVolume({
      Name: volumeName,
      Labels: {
        "managed-by": "gurt",
        "purpose": "sandbox-workspace"
      }
    });
  }
};

/**
 * Create connected opencode client
 */
const createClient = (port: number): SandboxClient => {
  return createOpencodeClient(`http://localhost:${port}`);
};

/**
 * Create local Docker sandbox provider
 */
export const createLocalDockerProvider = (deps: SandboxProviderDeps): SandboxProvider => {
  const docker = new Docker();
  const { logger } = deps;

  return {
    getOrCreateSession: async (threadId: string, userId: string): Promise<SandboxSession> => {
      logger.info({ threadId, userId }, "Getting or creating local Docker sandbox");

      const containerName = getContainerName(threadId);
      const volumeName = getVolumeName(threadId);

      // Ensure volume exists
      await ensureVolume(docker, volumeName);
      logger.info({ threadId, volumeName }, "Volume ready");

      // Check if container already exists
      try {
        const existingContainer = docker.getContainer(containerName);
        const containerInfo = await existingContainer.inspect();

        if (containerInfo.State.Running) {
          // Container is already running, reuse it
          const port = containerInfo.HostConfig.PortBindings?.["4096/tcp"]?.[0]?.HostPort;
          logger.info({ threadId, containerName, port }, "Reusing existing running container");
          
          return {
            threadId,
            sessionId: containerName,
            volumeId: volumeName,
            client: createClient(parseInt(port || "4096", 10))
          };
        } else {
          // Container exists but stopped, start it
          logger.info({ threadId, containerName }, "Starting existing stopped container");
          await existingContainer.start();
          
          const port = containerInfo.HostConfig.PortBindings?.["4096/tcp"]?.[0]?.HostPort;
          return {
            threadId,
            sessionId: containerName,
            volumeId: volumeName,
            client: createClient(parseInt(port || "4096", 10))
          };
        }
      } catch {
        // Container doesn't exist, create new one
        logger.info({ threadId, containerName }, "Creating new container");
      }

      // Find available port
      const hostPort = await findAvailablePort(docker, threadId);
      logger.info({ threadId, hostPort }, "Found available port");

      // Create container
      const container = await docker.createContainer({
        name: containerName,
        Image: IMAGE_NAME,
        ExposedPorts: {
          "4096/tcp": {}
        },
        HostConfig: {
          PortBindings: {
            "4096/tcp": [{ HostPort: hostPort.toString() }]
          },
          Binds: [`${volumeName}:/home/gurt/workspace`],
          RestartPolicy: {
            Name: "unless-stopped"
          }
        },
        Env: [
          `OPENCODE_SERVER_PASSWORD=${config.OPENCODE_SERVER_PASSWORD}`,
          "HOME=/home/gurt"
        ],
        Labels: {
          "managed-by": "gurt",
          "thread-id": threadId,
          "user-id": userId
        }
      });

      // Start container
      await container.start();
      logger.info({ threadId, containerName, hostPort }, "Container started");

      // Wait for container to be healthy
      let healthy = false;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (!healthy && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          const info = await container.inspect();
          if (info.State.Running && info.State.Health?.Status === "healthy") {
            healthy = true;
          } else if (info.State.Running && !info.State.Health) {
            healthy = true;
          }
        } catch {
          // Ignore errors during health check
        }
        attempts++;
      }

      if (!healthy) {
        try {
          await container.stop();
          await container.remove();
        } catch {
          // Ignore cleanup errors
        }
        throw new Error(`Container failed to become healthy after ${maxAttempts} seconds`);
      }

      logger.info({ threadId }, "Sandbox ready");

      return {
        threadId,
        sessionId: containerName,
        volumeId: volumeName,
        client: createClient(hostPort)
      };
    },

    stopSandbox: async (sessionId: string): Promise<void> => {
      logger.info({ sessionId }, "Stopping local Docker sandbox");

      try {
        const container = docker.getContainer(sessionId);
        const info = await container.inspect();

        if (info.State.Running) {
          await container.stop({ t: 10 });
          logger.info({ sessionId }, "Container stopped");
        }
      } catch (error) {
        logger.warn({ sessionId, error }, "Failed to stop container (may not exist)");
      }
    },

    isSandboxActive: async (sessionId: string): Promise<boolean> => {
      try {
        const container = docker.getContainer(sessionId);
        const info = await container.inspect();
        return info.State.Running;
      } catch {
        return false;
      }
    }
  };
};
