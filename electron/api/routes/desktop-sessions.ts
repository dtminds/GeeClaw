import type { IncomingMessage, ServerResponse } from 'http';
import {
  createDesktopSession,
  deleteDesktopSession,
  getDesktopSession,
  listDesktopSessions,
  updateDesktopSession,
} from '../../utils/desktop-sessions';
import { softDeleteOpenClawSession } from '../../utils/openclaw-sessions';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function getSessionIdFromPath(pathname: string): string | null {
  const prefix = '/api/desktop-sessions/';
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length).trim();
  return id ? decodeURIComponent(id) : null;
}

export async function handleDesktopSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/desktop-sessions' && req.method === 'GET') {
    sendJson(res, 200, { sessions: await listDesktopSessions() });
    return true;
  }

  if (url.pathname === '/api/desktop-sessions' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ title?: string; gatewaySessionKey?: string; lastMessagePreview?: string }>(req);
      const session = await createDesktopSession({
        title: body.title,
        gatewaySessionKey: body.gatewaySessionKey,
        lastMessagePreview: body.lastMessagePreview,
      });
      sendJson(res, 200, { success: true, session });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  const sessionId = getSessionIdFromPath(url.pathname);
  if (!sessionId) {
    return false;
  }

  if (req.method === 'GET') {
    const session = await getDesktopSession(sessionId);
    if (!session) {
      sendJson(res, 404, { success: false, error: `Desktop session not found: ${sessionId}` });
      return true;
    }
    sendJson(res, 200, { success: true, session });
    return true;
  }

  if (req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ title?: string; updatedAt?: number; gatewaySessionKey?: string; lastMessagePreview?: string }>(req);
      const session = await updateDesktopSession(sessionId, {
        title: body.title,
        updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : undefined,
        gatewaySessionKey: body.gatewaySessionKey,
        lastMessagePreview: body.lastMessagePreview,
      });
      if (!session) {
        sendJson(res, 404, { success: false, error: `Desktop session not found: ${sessionId}` });
        return true;
      }
      sendJson(res, 200, { success: true, session });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (req.method === 'DELETE') {
    try {
      const deleted = await deleteDesktopSession(sessionId);
      if (!deleted) {
        sendJson(res, 404, { success: false, error: `Desktop session not found: ${sessionId}` });
        return true;
      }

      const gatewayDelete = await softDeleteOpenClawSession(deleted.gatewaySessionKey);
      if (!gatewayDelete.success) {
        sendJson(res, 200, {
          success: true,
          session: deleted,
          gatewayDelete,
        });
        return true;
      }

      sendJson(res, 200, { success: true, session: deleted });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
