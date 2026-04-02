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
      new URL('http://127.0.0.1:13210/api/cli-marketplace/catalog'),
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

  it('starts a CLI install job for POST /api/cli-marketplace/install', async () => {
    const startInstallJob = vi.fn(async () => ({
      id: 'job-install-1',
      itemId: 'wecom',
      title: 'WeCom CLI',
      operation: 'install',
      status: 'running',
      logs: '$ npm install --global @wecom/cli\n',
      startedAt: '2026-03-30T00:00:00.000Z',
      finishedAt: null,
    }));
    parseJsonBodyMock.mockResolvedValueOnce({ id: 'wecom' });

    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cli-marketplace/install'),
      { cliMarketplaceService: { startInstallJob } } as never,
    );

    expect(handled).toBe(true);
    expect(parseJsonBodyMock).toHaveBeenCalledTimes(1);
    expect(startInstallJob).toHaveBeenCalledWith({ id: 'wecom' });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-install-1',
        operation: 'install',
        status: 'running',
      }),
    );
  });

  it('starts a CLI uninstall job for POST /api/cli-marketplace/uninstall', async () => {
    const startUninstallJob = vi.fn(async () => ({
      id: 'job-uninstall-1',
      itemId: 'feishu',
      title: 'Feishu CLI',
      operation: 'uninstall',
      status: 'running',
      logs: '$ npm uninstall --global @larksuite/cli\n',
      startedAt: '2026-03-30T00:00:00.000Z',
      finishedAt: null,
    }));
    parseJsonBodyMock.mockResolvedValueOnce({ id: 'feishu' });

    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cli-marketplace/uninstall'),
      { cliMarketplaceService: { startUninstallJob } } as never,
    );

    expect(handled).toBe(true);
    expect(startUninstallJob).toHaveBeenCalledWith({ id: 'feishu' });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-uninstall-1',
        operation: 'uninstall',
        status: 'running',
      }),
    );
  });

  it('returns a CLI marketplace job snapshot for GET /api/cli-marketplace/jobs/:id', async () => {
    const getJob = vi.fn(() => ({
      id: 'job-install-1',
      itemId: 'wecom',
      title: 'WeCom CLI',
      operation: 'install',
      status: 'succeeded',
      logs: '$ npm install --global @wecom/cli\n$ npx -y skills add WeComTeam/wecom-cli -y -g\n',
      startedAt: '2026-03-30T00:00:00.000Z',
      finishedAt: '2026-03-30T00:00:30.000Z',
    }));

    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cli-marketplace/jobs/job-install-1'),
      { cliMarketplaceService: { getJob } } as never,
    );

    expect(handled).toBe(true);
    expect(getJob).toHaveBeenCalledWith('job-install-1');
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-install-1',
        status: 'succeeded',
      }),
    );
  });

  it('returns 404 for missing CLI marketplace jobs', async () => {
    const getJob = vi.fn(() => {
      throw new Error('CLI marketplace job "missing-job" was not found');
    });

    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cli-marketplace/jobs/missing-job'),
      { cliMarketplaceService: { getJob } } as never,
    );

    expect(handled).toBe(true);
    expect(getJob).toHaveBeenCalledWith('missing-job');
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      404,
      {
        success: false,
        error: 'CLI marketplace job "missing-job" was not found',
      },
    );
  });

  it('ignores unrelated routes', async () => {
    const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

    const handled = await handleCliMarketplaceRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cli-marketplace/other'),
      {} as never,
    );

    expect(handled).toBe(false);
    expect(parseJsonBodyMock).not.toHaveBeenCalled();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });
});
