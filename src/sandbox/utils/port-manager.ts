const PORT_MIN = 10000;
const PORT_MAX = 65535;
const PORT_RANGE = PORT_MAX - PORT_MIN + 1;

const hashCode = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

export const getPortForThread = (threadId: string): number => {
  const hash = hashCode(threadId);
  return PORT_MIN + (hash % PORT_RANGE);
};

export const getNextPort = (currentPort: number): number => {
  const nextPort = currentPort + 1;
  return nextPort > PORT_MAX ? PORT_MIN : nextPort;
};
