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
    sendJson(res, 200, await ctx.cliMarketplaceService.install(body));
    return true;
  }

  return false;
}
