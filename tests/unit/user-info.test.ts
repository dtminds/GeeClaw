import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetchMock = vi.fn();

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

function createResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
): Response {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status: init.status ?? 200,
      statusText: init.statusText ?? 'OK',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

describe('fetchGeeclawUserInfo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns status and profile fields from the GeeClaw user info API', async () => {
    proxyAwareFetchMock.mockResolvedValue(createResponse({
      success: true,
      data: {
        avatar: 'https://example.com/avatar.png',
        apiKey: 'gc-user-api-key',
        nickName: 'lsave',
        status: 1,
      },
    }));

    const { fetchGeeclawUserInfo } = await import('@electron/services/auth/user-info');
    await expect(fetchGeeclawUserInfo('token-abc')).resolves.toEqual({
      avatar: 'https://example.com/avatar.png',
      apiKey: 'gc-user-api-key',
      nickName: 'lsave',
      status: 1,
    });

    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      'https://api.geeclaw.cn/geeclaw/api/user/info',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Geeclaw-Token': 'token-abc',
          'GC-version': '0.0.0-test',
        }),
      }),
    );
  });

  it('throws a session-expired error on 401', async () => {
    proxyAwareFetchMock.mockResolvedValue(createResponse('', { status: 401, statusText: 'Unauthorized' }));

    const { fetchGeeclawUserInfo } = await import('@electron/services/auth/user-info');
    await expect(fetchGeeclawUserInfo('token-abc')).rejects.toThrow('User info session expired');
  });
});
