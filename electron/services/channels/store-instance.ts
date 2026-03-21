// Lazy-load electron-store (ESM module) from the main process only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let channelStore: any = null;

export async function getGeeClawChannelStore() {
  if (!channelStore) {
    const Store = (await import('electron-store')).default;
    channelStore = new Store({
      projectName: 'GeeClaw',
      name: 'geeclaw-channels',
      defaults: {
        schemaVersion: 1,
        channels: {} as Record<string, unknown>,
        plugins: {} as Record<string, unknown>,
      },
    });
  }

  return channelStore;
}
