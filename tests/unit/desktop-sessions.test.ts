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
          gatewaySessionKey: 'agent:writer:geeclaw_main',
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
          gatewaySessionKey: 'agent:main:geeclaw_main',
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

  it('reuses an existing geeclaw main desktop session instead of creating a duplicate', async () => {
    const { createDesktopSession, listDesktopSessions } = await import('@electron/utils/desktop-sessions');

    const existing = await createDesktopSession({ gatewaySessionKey: 'agent:writer:geeclaw_main' });
    const sessions = await listDesktopSessions();

    expect(existing.id).toBe('session-main');
    expect(sessions.filter((session) => session.gatewaySessionKey === 'agent:writer:geeclaw_main')).toHaveLength(1);
  });

  it('does not treat nested geeclaw_main keys as the canonical main session', async () => {
    const { createDesktopSession, listDesktopSessions } = await import('@electron/utils/desktop-sessions');

    const nested = await createDesktopSession({ gatewaySessionKey: 'agent:writer:geeclaw_main:sub' });
    const nestedDuplicate = await createDesktopSession({ gatewaySessionKey: 'agent:writer:geeclaw_main:sub' });
    const sessions = await listDesktopSessions();

    expect(nested.id).not.toBe('session-main');
    expect(nestedDuplicate.id).not.toBe(nested.id);
    expect(sessions.filter((session) => session.gatewaySessionKey === 'agent:writer:geeclaw_main:sub')).toHaveLength(2);
    expect(sessions.filter((session) => session.gatewaySessionKey === 'agent:writer:geeclaw_main')).toHaveLength(1);
  });

  it('does not treat malformed keys with an empty agent id as the canonical main session', async () => {
    const { createDesktopSession, listDesktopSessions } = await import('@electron/utils/desktop-sessions');

    const malformed = await createDesktopSession({ gatewaySessionKey: 'agent::geeclaw_main' });
    const malformedDuplicate = await createDesktopSession({ gatewaySessionKey: 'agent::geeclaw_main' });
    const sessions = await listDesktopSessions();

    expect(malformed.id).not.toBe('session-main');
    expect(malformedDuplicate.id).not.toBe(malformed.id);
    expect(sessions.filter((session) => session.gatewaySessionKey === 'agent::geeclaw_main')).toHaveLength(2);
  });
});
