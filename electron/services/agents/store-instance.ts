// Lazy-load electron-store (ESM module) from the main process only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentStore: any = null;

export async function getGeeClawAgentStore() {
  if (!agentStore) {
    const Store = (await import('electron-store')).default;
    agentStore = new Store({
      projectName: 'GeeClaw',
      name: 'geeclaw-agents',
      defaults: {
        schemaVersion: 2,
        agents: {} as Record<string, unknown>,
        bindings: [] as Array<Record<string, unknown>>,
        activeEvolution: {} as Record<string, unknown>,
        management: {} as Record<string, unknown>,
        agentAvatars: {} as Record<string, unknown>,
      },
    });
  }

  return agentStore;
}
