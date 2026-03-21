import type { IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  getDefaultAgentModelConfig,
  deleteAgentConfig,
  listAgentsSnapshot,
  updateDefaultAgentFallbacks,
  updateAgentName,
} from '../../utils/agent-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawConfigDir } from '../../utils/paths';

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await listAgentsSnapshot()) });
    return true;
  }

  if (url.pathname === '/api/agents/default-model' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await getDefaultAgentModelConfig()) });
    return true;
  }

  if (url.pathname === '/api/agents/default-model' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ fallbacks?: string[] }>(req);
      const snapshot = await updateDefaultAgentFallbacks(body.fallbacks ?? []);
      scheduleGatewayReload(ctx, 'update-default-agent-model');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string; id: string }>(req);
      const snapshot = await createAgent(body.name, body.id);
      scheduleGatewayReload(ctx, 'create-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{ name: string }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentName(agentId, body.name);
        scheduleGatewayReload(ctx, 'update-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const snapshot = await assignChannelToAgent(agentId, channelType);
        scheduleGatewayReload(ctx, 'assign-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await deleteAgentConfig(agentId);
        scheduleGatewayReload(ctx, 'delete-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const channelType = decodeURIComponent(parts[2]);
        const snapshot = await clearChannelBinding(channelType);
        scheduleGatewayReload(ctx, 'remove-agent-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'GET') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);
    if (parts.length === 2 && parts[1] === 'sessions') {
      const agentId = decodeURIComponent(parts[0]);
      try {
        const sessionsPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
        const raw = await readFile(sessionsPath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, {
          deliveryContext?: { channel?: string; to?: string; accountId?: string };
          origin?: { label?: string };
          chatType?: string;
        }>;
        const sessions = Object.entries(data)
          .filter(([, v]) => v.deliveryContext?.channel && v.deliveryContext?.to)
          .map(([sessionKey, v]) => ({
            sessionKey,
            label: v.origin?.label || sessionKey,
            channel: v.deliveryContext!.channel!,
            to: v.deliveryContext!.to!,
            accountId: v.deliveryContext?.accountId || 'default',
            chatType: v.chatType,
          }));
        sendJson(res, 200, { success: true, sessions });
      } catch {
        sendJson(res, 200, { success: true, sessions: [] });
      }
      return true;
    }
  }

  return false;
}
