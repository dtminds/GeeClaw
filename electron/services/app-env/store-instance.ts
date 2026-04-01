// Lazy-load electron-store (ESM module) from the main process only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appEnvStore: any = null;

export interface GeeClawAppEnvStoreShape {
  managedEnvironmentEntries: Array<{
    key: string;
    value: string;
  }>;
}

export async function getGeeClawAppEnvStore() {
  if (!appEnvStore) {
    const Store = (await import('electron-store')).default;
    appEnvStore = new Store<GeeClawAppEnvStoreShape>({
      name: 'geeclaw-app-env',
      defaults: {
        managedEnvironmentEntries: [],
      },
    });
  }

  return appEnvStore;
}
