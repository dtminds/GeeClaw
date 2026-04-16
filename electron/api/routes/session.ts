import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { logger } from '../../utils/logger';
import {
  getSessionState,
  loginWithWechat,
  logoutSession,
  mockLogin,
  mockLogout,
} from '../../utils/session-store';

export async function handleAuthSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/session' && req.method === 'GET') {
    const state = await getSessionState();
    logger.info(`[SessionRoute] GET /api/session -> status=${state.status}, accountId=${state.account?.id || '(none)'}`);
    sendJson(res, 200, state);
    return true;
  }

  if (url.pathname === '/api/session/wechat/login' && req.method === 'POST') {
    try {
      logger.info('[SessionRoute] POST /api/session/wechat/login called');
      await parseJsonBody<Record<string, never>>(req).catch(() => undefined);
      const state = await loginWithWechat(ctx.mainWindow);
      logger.info(`[SessionRoute] WeChat login success -> status=${state.status}, accountId=${state.account?.id || '(none)'}`);
      sendJson(res, 200, state);
    } catch (error) {
      logger.error('[SessionRoute] WeChat login failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session/logout' && req.method === 'POST') {
    try {
      logger.info('[SessionRoute] POST /api/session/logout called');
      await parseJsonBody<Record<string, never>>(req).catch(() => undefined);
      const state = await logoutSession();
      logger.info(`[SessionRoute] Logout success -> status=${state.status}`);
      sendJson(res, 200, state);
    } catch (error) {
      logger.error('[SessionRoute] Logout failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session/mock-login' && req.method === 'POST') {
    try {
      await parseJsonBody<Record<string, never>>(req).catch(() => undefined);
      sendJson(res, 200, await mockLogin());
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/session/mock-logout' && req.method === 'POST') {
    try {
      await parseJsonBody<Record<string, never>>(req).catch(() => undefined);
      sendJson(res, 200, await mockLogout());
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
