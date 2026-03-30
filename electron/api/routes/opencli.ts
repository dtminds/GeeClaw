import type { IncomingMessage, ServerResponse } from 'http';
import { getOpenCliStatus } from '../../utils/opencli-runtime';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';

export async function handleOpenCliRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/opencli/status' && req.method === 'GET') {
    sendJson(res, 200, await getOpenCliStatus());
    return true;
  }

  return false;
}
