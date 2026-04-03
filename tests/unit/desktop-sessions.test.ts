import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockDesktopSessionsStoreShape = {
  schemaVersion: number;
  sessions: Array<Record<string, unknown>>;
};

let mockStoreShape: MockDesktopSessionsStoreShape;

class MockStore<T extends Record<string, unknown>> {
  constructor(_options?: unknown) {}

  get<K extends keyof T>(key: K): T[K] {
    return mockStoreShape[key as keyof MockDesktopSessionsStoreShape] as T[K];
  }

  set<K extends keyof T>(key: K, value: T[K]) {
    mockStoreShape[key as keyof MockDesktopSessionsStoreShape] = value as MockDesktopSessionsStoreShape[keyof MockDesktopSessionsStoreShape];
  }
}

vi.mock('electron-store', () => ({
  default: MockStore,
}));

describe('desktop session cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    mockStoreShape = {
      schemaVersion: 2,
      sessions: [
        {
          id: 'session-main',
          gatewaySessionKey: 'agent:writer:main',
          title: 'Writer',
          lastMessagePreview: '',
          createdAt: 10,
          updatedAt: 20,
        },
        {
          id: 'session-tmp',
          gatewaySessionKey: 'agent:writer:geeclaw_tmp_123',
          title: 'Writer tmp',
          lastMessagePreview: '',
          createdAt: 30,
          updatedAt: 40,
        },
        {
          id: 'session-other',
          gatewaySessionKey: 'agent:main:main',
          title: 'Main',
          lastMessagePreview: '',
          createdAt: 50,
          updatedAt: 60,
        },
      ],
    };
  });

  it('removes all desktop sessions for a deleted agent', async () => {
    const { deleteDesktopSessionsForAgent, listDesktopSessions } = await import('@electron/utils/desktop-sessions');

    const deleted = await deleteDesktopSessionsForAgent('writer');
    const remaining = await listDesktopSessions();

    expect(deleted.map((session) => session.id)).toEqual(['session-main', 'session-tmp']);
    expect(remaining.map((session) => session.id)).toEqual(['session-other']);
  });
});
