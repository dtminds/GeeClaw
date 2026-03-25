import { beforeEach, describe, expect, it, vi } from 'vitest';

const bindInviteCodeMock = vi.fn();
const fetchGeeclawUserInfoMock = vi.fn();
const runWechatLoginFlowMock = vi.fn();

type MockSessionStoreShape = {
  account: Record<string, unknown> | null;
  deviceId: string;
  tokenEncrypted: string | null;
  tokenPlain: string | null;
};

let mockStoreShape: MockSessionStoreShape;

class MockStore<T extends Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K] {
    return mockStoreShape[key as keyof MockSessionStoreShape] as T[K];
  }

  set<K extends keyof T>(key: K, value: T[K]) {
    mockStoreShape[key as keyof MockSessionStoreShape] = value as MockSessionStoreShape[keyof MockSessionStoreShape];
  }
}

vi.mock('@electron/services/auth/invite-bind', () => ({
  bindInviteCode: (...args: unknown[]) => bindInviteCodeMock(...args),
}));

vi.mock('@electron/services/auth/user-info', () => ({
  fetchGeeclawUserInfo: (...args: unknown[]) => fetchGeeclawUserInfoMock(...args),
}));

vi.mock('@electron/services/auth/wechat-auth', () => ({
  runWechatLoginFlow: (...args: unknown[]) => runWechatLoginFlowMock(...args),
}));

vi.mock('electron-store', () => ({
  default: MockStore,
}));

describe('session-store startup refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockStoreShape = {
      account: {
        id: 'user-1',
        displayName: 'old-name',
        nickName: 'old-name',
        avatarUrl: 'https://old.example/avatar.png',
        userStatus: 0,
      },
      deviceId: 'geeclaw-test-device',
      tokenEncrypted: null,
      tokenPlain: 'token-abc',
    };
  });

  it('refreshes user status from GeeClaw user info on startup', async () => {
    fetchGeeclawUserInfoMock.mockResolvedValue({
      avatar: 'https://new.example/avatar.png',
      nickName: 'new-name',
      status: 1,
    });

    const { getSessionState } = await import('@electron/utils/session-store');
    await expect(getSessionState()).resolves.toEqual({
      status: 'authenticated',
      account: expect.objectContaining({
        id: 'user-1',
        displayName: 'new-name',
        nickName: 'new-name',
        avatarUrl: 'https://new.example/avatar.png',
        userStatus: 1,
      }),
    });
  });

  it('logs the user out when GeeClaw user info reports status=2', async () => {
    fetchGeeclawUserInfoMock.mockResolvedValue({
      status: 2,
    });

    const { getSessionState } = await import('@electron/utils/session-store');
    await expect(getSessionState()).resolves.toEqual({
      status: 'unauthenticated',
      account: null,
    });
    expect(mockStoreShape.account).toBeNull();
    expect(mockStoreShape.tokenPlain).toBeNull();
  });
});
