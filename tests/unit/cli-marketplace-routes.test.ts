import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleCliMarketplaceRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns CLI marketplace catalog for GET /api/cli-marketplace/catalog', async () => {
    const getCatalog = vi.fn(async () => [
      {
        id: 'feishu',
        title: 'Feishu CLI',
        description: 'Official Feishu command line tools',
        installed: true,
        actionLabel: 'reinstall',
        source: 'system',
      },
    ]);

    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/cli-marketplace/catalog'),
      { cliMarketplaceService: { getCatalog } } as never,
    );

    expect(handled).toBe(true);
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      [
        expect.objectContaining({
          id: 'feishu',
          installed: true,
          actionLabel: 'reinstall',
          source: 'system',
        }),
      ],
    );
  });

  it('installs a curated CLI for POST /api/cli-marketplace/install', async () => {
    const install = vi.fn(async () => ({
      id: 'wecom',
      title: 'WeCom CLI',
      description: 'Official WeCom command line tools',
      installed: true,
      actionLabel: 'reinstall',
      source: 'geeclaw',
    }));
    parseJsonBodyMock.mockResolvedValueOnce({ id: 'wecom' });

    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/cli-marketplace/install'),
      { cliMarketplaceService: { install } } as never,
    );

    expect(handled).toBe(true);
    expect(parseJsonBodyMock).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith({ id: 'wecom' });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'wecom',
        installed: true,
        actionLabel: 'reinstall',
        source: 'geeclaw',
      }),
    );
  });

  it('ignores unrelated routes', async () => {
    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/cli-marketplace/other'),
      {} as never,
    );

    expect(handled).toBe(false);
    expect(parseJsonBodyMock).not.toHaveBeenCalled();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });
});
