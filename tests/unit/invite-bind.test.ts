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

describe('bindInviteCode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true when the GeeClaw auth API confirms the invite binding', async () => {
    proxyAwareFetchMock.mockResolvedValue(
      createResponse({ success: true, data: true, errorMsg: '' }),
    );

    const { bindInviteCode } = await import('@electron/services/auth/invite-bind');
    await expect(bindInviteCode('invite-123', 'token-abc')).resolves.toBe(true);

    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      'https://api-test.geeclaw.cn/geeclaw/api/invite/bind?inviteCode=invite-123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Geeclaw-Token': 'token-abc',
          'GC-version': '0.0.0-test',
        }),
      }),
    );
  });

  it('rejects when the API responds with data=false', async () => {
    proxyAwareFetchMock.mockResolvedValue(
      createResponse({ success: true, data: false, errorMsg: '邀请码无效' }),
    );

    const { bindInviteCode } = await import('@electron/services/auth/invite-bind');
    await expect(bindInviteCode('bad-code', 'token-abc')).rejects.toThrow('邀请码无效');
  });

  it('falls back to GET when POST is not allowed', async () => {
    proxyAwareFetchMock
      .mockResolvedValueOnce(createResponse('', { status: 405, statusText: 'Method Not Allowed' }))
      .mockResolvedValueOnce(createResponse({ success: true, data: true }));

    const { bindInviteCode } = await import('@electron/services/auth/invite-bind');
    await expect(bindInviteCode('invite-123', 'token-abc')).resolves.toBe(true);

    expect(proxyAwareFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api-test.geeclaw.cn/geeclaw/api/invite/bind?inviteCode=invite-123',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(proxyAwareFetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api-test.geeclaw.cn/geeclaw/api/invite/bind?inviteCode=invite-123',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
