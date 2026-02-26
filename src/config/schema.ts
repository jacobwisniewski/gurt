import { z } from "zod";

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string()
    .startsWith("xoxb-")
    .min(10),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_APP_TOKEN: z.string()
    .startsWith("xapp-")
    .min(10),
  AWS_REGION: z.string().default("us-west-2"),
  AWS_AVAILABILITY_ZONE: z.string().min(1),
  AWS_PROFILE: z.string().optional(),
  NEW_RELIC_API_KEY: z.string()
    .startsWith("NRAK-")
    .min(10),
  GITHUB_TOKEN: z.string()
    .regex(/^ghp_|^github_pat_/)
    .min(10),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),
  OPENCODE_SERVER_PASSWORD: z.string()
    .min(16),
  GURT_CONTAINER_IMAGE: z.string().default("gurt-sandbox:latest"),
  KMS_KEY_ID: z.string().optional(),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const isEnvConfig = (obj: unknown): obj is EnvConfig =>
  envSchema.safeParse(obj).success;

export const parseEnv = (): EnvConfig => {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    throw new Error(
      `Environment validation failed: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }
  
  return result.data;
};
