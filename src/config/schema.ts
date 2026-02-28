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
  
  // PostgreSQL Configuration - either DATABASE_URL or individual params
  DATABASE_URL: z.string().url().optional(),
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.string().transform((val) => parseInt(val, 10)).default("5432"),
  POSTGRES_USER: z.string().default("postgres"),
  POSTGRES_PASSWORD: z.string().default(""),
  POSTGRES_DB: z.string().default("gurt"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  
  // Model Configuration
  MODEL_PROVIDER: z.enum(["bedrock", "openai", "anthropic"]).default("bedrock"),
  MODEL_ID: z.string().default("anthropic.claude-3-5-sonnet-20241022-v2:0"),
  
  // Jira Configuration (optional)
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_HOST: z.string().url().optional(),
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
