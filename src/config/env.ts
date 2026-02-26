import { EnvConfig, parseEnv } from "./schema";

let configInstance: EnvConfig | null = null;

export const getConfig = (): EnvConfig => {
  if (!configInstance) {
    configInstance = parseEnv();
  }
  return configInstance;
};
