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
    expect(settings.quickActions.actions.every((action) => action.enabled === true)).toBe(true);
    expect(settings.quickActions.actions.every((action) => action.outputMode === 'copy')).toBe(true);
    expect(settings.quickActions.closeOnCopy).toBe(true);
    expect(settings.quickActions.preferClipboardFallback).toBe(true);
  });
});

describe('settings routes quick actions', () => {
  it('round-trips quickActions through the generic settings route', async () => {
    vi.resetModules();
    const sendJsonMock = vi.fn();
    const currentSettings = {
      quickActions: {
        actions: [
          { id: 'translate', title: 'Translate', kind: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' },
          { id: 'reply', title: 'Reply', kind: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: true, outputMode: 'copy' },
          { id: 'lookup', title: 'Lookup', kind: 'lookup', shortcut: 'CommandOrControl+Shift+3', enabled: true, outputMode: 'copy' },
        ],
        closeOnCopy: true,
        preferClipboardFallback: true,
      },
    };
    const parseJsonBodyMock = vi.fn().mockResolvedValue({
      value: {
        actions: [
          { id: 'translate', title: 'Translate', kind: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' },
          { id: 'reply', title: 'Reply', kind: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: true, outputMode: 'copy' },
          {
            id: 'lookup',
            title: 'Lookup',
            kind: 'lookup',
            shortcut: 'CommandOrControl+Shift+3',
            enabled: true,
            outputMode: 'paste',
          },
        ],
        closeOnCopy: false,
        preferClipboardFallback: false,
      },
    });

    vi.doMock('@electron/utils/store', () => ({
      getAllSettings: vi.fn(async () => currentSettings),
      getSetting: vi.fn(async (key: string) => currentSettings[key as keyof typeof currentSettings]),
      resetSettings: vi.fn(),
      setSetting: vi.fn(async (key: string, value: unknown) => {
        currentSettings[key as keyof typeof currentSettings] = value as never;
      }),
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

    await handleSettingsRoutes(
      { method: 'GET' } as never,
      {} as never,
      new URL('http://127.0.0.1:13210/api/settings/quickActions'),
      { gatewayManager: { getStatus: () => ({ state: 'stopped' }), debouncedReload: vi.fn(), restart: vi.fn() } } as never,
    );

    expect(sendJsonMock).toHaveBeenLastCalledWith(
      expect.anything(),
      200,
      {
        value: expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({ id: 'lookup', outputMode: 'paste' }),
          ]),
          closeOnCopy: false,
          preferClipboardFallback: false,
        }),
      },
    );
  });
});
