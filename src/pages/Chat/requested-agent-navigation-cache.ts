export interface RequestedAgentNavigationCache {
  add: (key: string) => void;
  has: (key: string) => boolean;
}

export function createRequestedAgentNavigationCache(maxEntries: number): RequestedAgentNavigationCache {
  const normalizedMaxEntries = Math.max(1, Math.floor(maxEntries));
  const keys = new Set<string>();

  return {
    add(key: string) {
      if (!key) return;
      if (keys.has(key)) {
        keys.delete(key);
      }
      keys.add(key);
      while (keys.size > normalizedMaxEntries) {
        const oldestKey = keys.values().next().value;
        if (!oldestKey) {
          break;
        }
        keys.delete(oldestKey);
      }
    },
    has(key: string) {
      return keys.has(key);
    },
  };
}
