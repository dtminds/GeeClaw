import type { IncomingMessage, ServerResponse } from 'http';
import { getMcporterStatus } from '../../utils/mcporter-runtime';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';

export async function handleMcpRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/mcp/status' && req.method === 'GET') {
    sendJson(res, 200, {
      mcporter: await getMcporterStatus(),
    });
    return true;
  }

  return false;
}
