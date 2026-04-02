import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getSessionStateMock = vi.fn();
const loginWithWechatMock = vi.fn();
const logoutSessionMock = vi.fn();
const mockLoginMock = vi.fn();
const mockLogoutMock = vi.fn();
const submitInviteCodeMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/session-store', () => ({
  getSessionState: (...args: unknown[]) => getSessionStateMock(...args),
  loginWithWechat: (...args: unknown[]) => loginWithWechatMock(...args),
  logoutSession: (...args: unknown[]) => logoutSessionMock(...args),
  mockLogin: (...args: unknown[]) => mockLoginMock(...args),
  mockLogout: (...args: unknown[]) => mockLogoutMock(...args),
  submitInviteCode: (...args: unknown[]) => submitInviteCodeMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleAuthSessionRoutes invite code flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('redeems invite codes through POST /api/session/invite-code', async () => {
    parseJsonBodyMock.mockResolvedValue({ inviteCode: 'invite-123' });
    submitInviteCodeMock.mockResolvedValue({
      status: 'authenticated',
      account: {
        id: 'session-user',
        userStatus: 1,
      },
    });

    const { handleAuthSessionRoutes } = await import('@electron/api/routes/session');

    const handled = await handleAuthSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/session/invite-code'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(parseJsonBodyMock).toHaveBeenCalledTimes(1);
    expect(submitInviteCodeMock).toHaveBeenCalledWith('invite-123');
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        status: 'authenticated',
        account: expect.objectContaining({
          id: 'session-user',
          userStatus: 1,
        }),
      }),
    );
  });

  it('returns a 500 payload when invite code verification fails', async () => {
    parseJsonBodyMock.mockResolvedValue({ inviteCode: '' });
    submitInviteCodeMock.mockRejectedValue(new Error('Invite code is required'));

    const { handleAuthSessionRoutes } = await import('@electron/api/routes/session');

    await handleAuthSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/session/invite-code'),
      {} as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({
        success: false,
        error: 'Error: Invite code is required',
      }),
    );
  });
});
