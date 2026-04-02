import { describe, expect, it, vi } from 'vitest';

class MockStore<T extends Record<string, unknown>> {
  store: T;

  constructor(options: { defaults: T }) {
    this.store = structuredClone(options.defaults);
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.store[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.store[key] = structuredClone(value);
  }

  clear(): void {
    this.store = {} as T;
  }
}

vi.mock('electron-store', () => ({
  default: MockStore,
}));

describe('quick action settings defaults', () => {
  it('includes built-in quick actions in the electron settings defaults', async () => {
    const { getAllSettings } = await import('@electron/utils/store');
    const settings = await getAllSettings();

    expect(settings.quickActions.actions.map((action) => action.id)).toEqual([
      'translate',
      'reply',
      'lookup',
    ]);
    expect(settings.quickActions.actions.every((action) => typeof action.shortcut === 'string')).toBe(true);
  });
});

describe('settings routes quick actions', () => {
  it('persists quickActions through the generic settings route', async () => {
    vi.resetModules();
    const setSettingMock = vi.fn();
    const sendJsonMock = vi.fn();
    const parseJsonBodyMock = vi.fn().mockResolvedValue({
      value: {
        actions: [
          { id: 'translate', title: 'Translate', kind: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' },
          { id: 'reply', title: 'Reply', kind: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: true, outputMode: 'copy' },
          { id: 'lookup', title: 'Lookup', kind: 'lookup', shortcut: 'CommandOrControl+Shift+3', enabled: true, outputMode: 'copy' },
        ],
        closeOnCopy: true,
        preferClipboardFallback: true,
      },
    });

    vi.doMock('@electron/utils/store', () => ({
      getAllSettings: vi.fn().mockResolvedValue({
        quickActions: { actions: [], closeOnCopy: true, preferClipboardFallback: true },
      }),
      getSetting: vi.fn(),
      resetSettings: vi.fn(),
      setSetting: setSettingMock,
    }));
    vi.doMock('@electron/api/route-utils', () => ({
      parseJsonBody: parseJsonBodyMock,
      sendJson: sendJsonMock,
    }));

    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    await handleSettingsRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://127.0.0.1:13210/api/settings/quickActions'),
      { gatewayManager: { getStatus: () => ({ state: 'stopped' }), debouncedReload: vi.fn(), restart: vi.fn() } } as never,
    );

    expect(setSettingMock).toHaveBeenCalledWith('quickActions', expect.objectContaining({
      actions: expect.arrayContaining([expect.objectContaining({ id: 'translate' })]),
    }));
  });
});
