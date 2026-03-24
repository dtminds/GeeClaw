import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getMcporterStatusMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/mcporter-runtime', () => ({
  getMcporterStatus: (...args: unknown[]) => getMcporterStatusMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleMcpRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns mcporter status for GET /api/mcp/status', async () => {
    getMcporterStatusMock.mockResolvedValue({
      installed: true,
      binaryPath: '/usr/local/bin/mcporter',
      version: '0.7.3',
      system: { exists: true, path: '/usr/local/bin/mcporter', version: '0.7.3' },
      bundled: { exists: true, path: '/tmp/mcporter/dist/cli.js', version: '0.7.3' },
    });

    const { handleMcpRoutes } = await import('@electron/api/routes/mcp');

    const handled = await handleMcpRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/mcp/status'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getMcporterStatusMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        mcporter: expect.objectContaining({
          installed: true,
          version: '0.7.3',
        }),
      }),
    );
  });

  it('ignores unrelated mcp routes', async () => {
    const { handleMcpRoutes } = await import('@electron/api/routes/mcp');

    const handled = await handleMcpRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/mcp/other'),
      {} as never,
    );

    expect(handled).toBe(false);
    expect(getMcporterStatusMock).not.toHaveBeenCalled();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });
});
