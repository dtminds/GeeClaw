import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleCliMarketplaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cli-marketplace/catalog' && req.method === 'GET') {
    sendJson(res, 200, await ctx.cliMarketplaceService.getCatalog());
    return true;
  }

  if (url.pathname === '/api/cli-marketplace/install' && req.method === 'POST') {
    const body = await parseJsonBody<{ id: string }>(req);
    sendJson(res, 200, await ctx.cliMarketplaceService.startInstallJob(body));
    return true;
  }

  if (url.pathname === '/api/cli-marketplace/uninstall' && req.method === 'POST') {
    const body = await parseJsonBody<{ id: string }>(req);
    sendJson(res, 200, await ctx.cliMarketplaceService.startUninstallJob(body));
    return true;
  }

  if (url.pathname.startsWith('/api/cli-marketplace/jobs/') && req.method === 'GET') {
    const jobId = decodeURIComponent(url.pathname.slice('/api/cli-marketplace/jobs/'.length));
    try {
      sendJson(res, 200, ctx.cliMarketplaceService.getJob(jobId));
    } catch (error) {
      sendJson(res, 404, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
}
