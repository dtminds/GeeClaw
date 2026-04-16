import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getSessionStateMock = vi.fn();
const loginWithWechatMock = vi.fn();
const logoutSessionMock = vi.fn();
const mockLoginMock = vi.fn();
const mockLogoutMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/session-store', () => ({
  getSessionState: (...args: unknown[]) => getSessionStateMock(...args),
  loginWithWechat: (...args: unknown[]) => loginWithWechatMock(...args),
  logoutSession: (...args: unknown[]) => logoutSessionMock(...args),
  mockLogin: (...args: unknown[]) => mockLoginMock(...args),
  mockLogout: (...args: unknown[]) => mockLogoutMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleAuthSessionRoutes invite code flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('no longer handles POST /api/session/invite-code', async () => {
    const { handleAuthSessionRoutes } = await import('@electron/api/routes/session');

    const handled = await handleAuthSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/session/invite-code'),
      {} as never,
    );

    expect(handled).toBe(false);
    expect(parseJsonBodyMock).not.toHaveBeenCalled();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });
});
