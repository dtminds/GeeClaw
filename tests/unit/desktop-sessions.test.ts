import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockDesktopSessionsStoreShape = {
  schemaVersion: number;
  sessions: Array<Record<string, unknown>>;
};

const { mockReadOpenClawConfig } = vi.hoisted(() => ({
  mockReadOpenClawConfig: vi.fn(),
}));

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

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: mockReadOpenClawConfig,
}));

describe('desktop session cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    mockReadOpenClawConfig.mockReset().mockResolvedValue({});
    mockStoreShape = {
      schemaVersion: 3,
      sessions: [
        {
          id: 'session-main',
          gatewaySessionKey: 'agent:writer:geeclaw_main',
          title: 'Writer',
          lastMessagePreview: '',
          proposalStateEntries: [
            {
              proposalId: 'evo-1',
              decision: 'approved',
              updatedAt: 15,
            },
          ],
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

  it('reuses an existing configured custom main session instead of creating a duplicate', async () => {
    mockReadOpenClawConfig.mockResolvedValue({ session: { mainKey: 'workspace_main' } });
    mockStoreShape.sessions = [
      {
        id: 'session-custom-main',
        gatewaySessionKey: 'agent:writer:workspace_main',
        title: 'Writer',
        lastMessagePreview: '',
        createdAt: 10,
        updatedAt: 20,
      },
    ];

    const { createDesktopSession, listDesktopSessions } = await import('@electron/utils/desktop-sessions');

    const existing = await createDesktopSession({ gatewaySessionKey: 'agent:writer:workspace_main' });
    const sessions = await listDesktopSessions();

    expect(existing.id).toBe('session-custom-main');
    expect(sessions.filter((session) => session.gatewaySessionKey === 'agent:writer:workspace_main')).toHaveLength(1);
  });

  it('deduplicates configured custom main sessions during normalization', async () => {
    mockReadOpenClawConfig.mockResolvedValue({ session: { mainKey: 'workspace_main' } });
    mockStoreShape.sessions = [
      {
        id: 'session-custom-main-old',
        gatewaySessionKey: 'agent:writer:workspace_main',
        title: 'Writer old',
        lastMessagePreview: '',
        createdAt: 10,
        updatedAt: 20,
      },
      {
        id: 'session-custom-main-new',
        gatewaySessionKey: 'agent:writer:workspace_main',
        title: 'Writer new',
        lastMessagePreview: '',
        createdAt: 30,
        updatedAt: 40,
      },
    ];

    const { listDesktopSessions } = await import('@electron/utils/desktop-sessions');

    const sessions = await listDesktopSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe('session-custom-main-new');
  });

  it('persists proposal states when updating a desktop session', async () => {
    const { updateDesktopSession, getDesktopSession } = await import('@electron/utils/desktop-sessions');

    await updateDesktopSession('session-main', {
      proposalStateEntries: [
        {
          proposalId: 'evo-1',
          decision: 'approved',
          updatedAt: 100,
        },
        {
          proposalId: 'evo-2',
          decision: 'rejected',
          updatedAt: 200,
        },
      ],
    });

    const updated = await getDesktopSession('session-main');
    expect(updated?.proposalStateEntries).toEqual([
      {
        proposalId: 'evo-1',
        decision: 'approved',
        updatedAt: 100,
      },
      {
        proposalId: 'evo-2',
        decision: 'rejected',
        updatedAt: 200,
      },
    ]);
  });

  it('keeps only the latest 50 proposal decision entries', async () => {
    const { updateDesktopSession, getDesktopSession } = await import('@electron/utils/desktop-sessions');

    await updateDesktopSession('session-main', {
      proposalStateEntries: Array.from({ length: 55 }, (_, index) => ({
        proposalId: `evo-${index + 1}`,
        decision: index % 2 === 0 ? 'approved' as const : 'rejected' as const,
        updatedAt: index + 1,
      })),
    });

    const updated = await getDesktopSession('session-main');
    expect(updated?.proposalStateEntries).toHaveLength(50);
    expect(updated?.proposalStateEntries?.[0]?.proposalId).toBe('evo-6');
    expect(updated?.proposalStateEntries?.[49]?.proposalId).toBe('evo-55');
  });
});
