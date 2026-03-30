import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';
import type { HostApiContext } from './context';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleChannelRoutes } from './routes/channels';
import { handleCliMarketplaceRoutes } from './routes/cli-marketplace';
import { handleLogRoutes } from './routes/logs';
import { handleOpenCliRoutes } from './routes/opencli';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleFileRoutes } from './routes/files';
import { handleAuthSessionRoutes } from './routes/session';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { handleDesktopSessionRoutes } from './routes/desktop-sessions';
import { handleAgentRoutes } from './routes/agents';
import { handleMcpRoutes } from './routes/mcp';
import { requireJsonContentType, sendJson, setCorsHeaders } from './route-utils';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const routeHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleChannelRoutes,
  handleCliMarketplaceRoutes,
  handleOpenCliRoutes,
  handleMcpRoutes,
  handleSkillRoutes,
  handleFileRoutes,
  handleAuthSessionRoutes,
  handleDesktopSessionRoutes,
  handleAgentRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleLogRoutes,
  handleUsageRoutes,
];

let hostApiToken = '';

export function getHostApiToken(): string {
  return hostApiToken;
}

export function startHostApiServer(ctx: HostApiContext, port = PORTS.GEECLAW_HOST_API): Server {
  hostApiToken = randomBytes(32).toString('hex');

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      setCorsHeaders(res, origin);

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const authHeader = req.headers.authorization || '';
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : (requestUrl.searchParams.get('token') || '');
      if (bearerToken !== hostApiToken) {
        sendJson(res, 401, { success: false, error: 'Unauthorized' });
        return;
      }

      if (!requireJsonContentType(req)) {
        sendJson(res, 415, { success: false, error: 'Content-Type must be application/json' });
        return;
      }

      for (const handler of routeHandlers) {
        if (await handler(req, res, requestUrl, ctx)) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`Host API server listening on http://127.0.0.1:${port}`);
  });

  return server;
}
