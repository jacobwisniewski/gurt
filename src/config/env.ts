import type { EnvConfig } from './schema';

/**
 * Validated environment configuration
 * 
 * This is set at runtime by scripts/run-with-env.ts
 * Never import this directly in tests - use dependency injection instead
 */

// Global config object (populated by run-with-env.ts)
declare global {
  var __GURT_CONFIG__: EnvConfig | undefined;
}

/**
 * Get the validated environment configuration
 * 
 * @throws Error if config hasn't been validated (run via npm run with-env)
 */
export function getConfig(): EnvConfig {
  if (!globalThis.__GURT_CONFIG__) {
    throw new Error(
      'Environment config not found. ' +
      'Did you run via "npm run with-env"? ' +
      'Direct node/tsx execution is not allowed for security.'
    );
  }
  
  return globalThis.__GURT_CONFIG__;
}

/**
 * Check if config is available (for optional usage)
 */
export function hasConfig(): boolean {
  return !!globalThis.__GURT_CONFIG__;
}

/**
 * Mask a secret for logging
 */
export function maskSecret(value: string | undefined): string {
  if (!value || value.length < 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Set the global config (called by run-with-env.ts)
 * @internal
 */
export function __setConfig(config: EnvConfig): void {
  globalThis.__GURT_CONFIG__ = config;
}
