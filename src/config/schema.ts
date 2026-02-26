import { z } from 'zod';

/**
 * Environment variable schema and types
 * 
 * This file is imported by src/config/env.ts for runtime validation
 * and can be used directly for type definitions
 */

export const envSchema = z.object({
  // Required - Slack
  SLACK_BOT_TOKEN: z.string()
    .startsWith('xoxb-', 'Slack bot token must start with xoxb-')
    .min(10, 'Slack bot token is too short'),
  SLACK_SIGNING_SECRET: z.string().min(1, 'Slack signing secret is required'),
  SLACK_APP_TOKEN: z.string()
    .startsWith('xapp-', 'Slack app token must start with xapp-')
    .min(10, 'Slack app token is too short'),
  
  // AWS
  AWS_REGION: z.string().default('us-west-2'),
  AWS_AVAILABILITY_ZONE: z.string().min(1, 'AWS availability zone is required'),
  AWS_PROFILE: z.string().optional(),
  
  // API Keys (sensitive)
  NEW_RELIC_API_KEY: z.string()
    .startsWith('NRAK-', 'New Relic API key must start with NRAK-')
    .min(10, 'New Relic API key is too short'),
  GITHUB_TOKEN: z.string()
    .regex(/^ghp_|^github_pat_/, 'GitHub token must start with ghp_ or github_pat_')
    .min(10, 'GitHub token is too short'),
  
  // AWS Credentials (optional - can use IAM role)
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),
  
  // opencode Server
  OPENCODE_SERVER_PASSWORD: z.string()
    .min(16, 'opencode server password must be at least 16 characters'),
  
  // Container
  GURT_CONTAINER_IMAGE: z.string().default('gurt-sandbox:latest'),
  
  // Infrastructure
  KMS_KEY_ID: z.string().optional(),
  
  // Database (optional for MVP)
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

// Runtime type guard
export function isEnvConfig(obj: unknown): obj is EnvConfig {
  return envSchema.safeParse(obj).success;
}
