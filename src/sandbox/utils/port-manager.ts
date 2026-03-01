/**
 * Deterministic port allocation for sandbox containers
 * Uses threadId hash to ensure same thread always gets same port
 * Range: 10000-65535 (55,535 available ports)
 */

const PORT_MIN = 10000;
const PORT_MAX = 65535;
const PORT_RANGE = PORT_MAX - PORT_MIN + 1;

/**
 * Simple hash function for strings
 * Similar to Java's hashCode
 */
const hashCode = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
};

/**
 * Get deterministic port for a thread
 * Same threadId always returns same port
 */
export const getPortForThread = (threadId: string): number => {
  const hash = hashCode(threadId);
  return PORT_MIN + (Math.abs(hash) % PORT_RANGE);
};

/**
 * Get next sequential port (for fallback when primary is in use)
 */
export const getNextPort = (currentPort: number): number => {
  const nextPort = currentPort + 1;
  return nextPort > PORT_MAX ? PORT_MIN : nextPort;
};
