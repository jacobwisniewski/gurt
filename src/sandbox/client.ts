import { createOpencodeClient as createOpencodeClientFromSdk } from "@opencode-ai/sdk";

export type SandboxClient = ReturnType<typeof createOpencodeClientFromSdk>;

export const createOpencodeClient = (opencodeUrl: string): SandboxClient => {
  return createOpencodeClientFromSdk({
    baseUrl: opencodeUrl
  });
};
