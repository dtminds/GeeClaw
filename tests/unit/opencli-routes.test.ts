import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getOpenCliStatusMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/opencli-runtime', () => ({
  getOpenCliStatus: (...args: unknown[]) => getOpenCliStatusMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleOpenCliRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns system opencli status for GET /api/opencli/status', async () => {
    getOpenCliStatusMock.mockResolvedValue({
      binaryExists: true,
      binaryPath: '/usr/local/bin/opencli',
      version: '1.5.5',
      command: '/usr/local/bin/opencli',
      releasesUrl: 'https://github.com/jackwener/opencli/releases',
      readmeUrl: 'https://github.com/jackwener/opencli/blob/main/README.zh-CN.md',
      doctor: { ok: true },
    });

    const { handleOpenCliRoutes } = await import('@electron/api/routes/opencli');

    const handled = await handleOpenCliRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/opencli/status'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getOpenCliStatusMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        binaryExists: true,
        binaryPath: '/usr/local/bin/opencli',
        doctor: { ok: true },
      }),
    );
  });

  it('ignores unrelated routes', async () => {
    const { handleOpenCliRoutes } = await import('@electron/api/routes/opencli');

    const handled = await handleOpenCliRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/opencli/other'),
      {} as never,
    );

    expect(handled).toBe(false);
    expect(getOpenCliStatusMock).not.toHaveBeenCalled();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });
});
