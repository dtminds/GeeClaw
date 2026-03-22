import type { IncomingMessage, ServerResponse } from 'http';
import {
  deleteChannelConfig,
  deleteChannelAccountConfig,
  getChannelFormValues,
  listConfiguredChannelAccounts,
  listConfiguredChannels,
  saveChannelConfig,
  setDefaultChannelAccount,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import { assignChannelAccountToAgent, clearAllBindingsForChannel, clearChannelBinding } from '../../utils/agent-config';
import { refreshGatewayAfterConfigChange } from '../../utils/gateway-refresh';
import { whatsAppLoginManager } from '../../utils/whatsapp-login';
import { weComLoginManager } from '../../utils/wecom-login';
import { weixinLoginManager } from '../../utils/weixin-login';
import {
  ensureDingTalkPluginInstalled,
  ensureFeishuPluginInstalled,
  ensureQQBotPluginInstalled,
  ensureWeComPluginInstalled,
  ensureWeixinPluginInstalled,
} from '../../utils/plugin-install';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function scheduleGatewayChannelRestart(ctx: HostApiContext, reason: string): void {
  refreshGatewayAfterConfigChange(ctx.gatewayManager, reason);
}

export async function handleChannelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/channels/configured' && req.method === 'GET') {
    sendJson(res, 200, { success: true, channels: await listConfiguredChannels() });
    return true;
  }

  if (url.pathname === '/api/channels/configured-accounts' && req.method === 'GET') {
    sendJson(res, 200, { success: true, channels: await listConfiguredChannelAccounts() });
    return true;
  }

  if (url.pathname === '/api/channels/config/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelConfig(body.channelType)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/credentials/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, string> }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelCredentials(body.channelType, body.config)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      await whatsAppLoginManager.start(body.accountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/cancel' && req.method === 'POST') {
    try {
      await whatsAppLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/wecom/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      await weComLoginManager.start(body.accountId || 'default');
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/wecom/cancel' && req.method === 'POST') {
    try {
      await weComLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/openclaw-weixin/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      await weixinLoginManager.start(body.accountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/openclaw-weixin/cancel' && req.method === 'POST') {
    try {
      await weixinLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        channelType: string;
        config: Record<string, unknown>;
        accountId?: string;
      }>(req);
      if (body.channelType === 'dingtalk') {
        const installResult = await ensureDingTalkPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'DingTalk bundled plugin unavailable' });
          return true;
        }
      }
      if (body.channelType === 'wecom') {
        const installResult = await ensureWeComPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeCom bundled plugin unavailable' });
          return true;
        }
      }
      if (body.channelType === 'feishu') {
        const installResult = await ensureFeishuPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'Feishu bundled plugin unavailable' });
          return true;
        }
      }
      if (body.channelType === 'qqbot') {
        const installResult = await ensureQQBotPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'QQ Bot bundled plugin unavailable' });
          return true;
        }
      }
      if (body.channelType === 'openclaw-weixin') {
        const installResult = await ensureWeixinPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'Weixin bundled plugin unavailable' });
          return true;
        }
      }
      await saveChannelConfig(body.channelType, body.config, body.accountId);
      scheduleGatewayChannelRestart(ctx, `channel:saveConfig:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/enabled' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; enabled: boolean }>(req);
      await setChannelEnabled(body.channelType, body.enabled);
      scheduleGatewayChannelRestart(ctx, `channel:setEnabled:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'GET') {
    const suffix = url.pathname.slice('/api/channels/config/'.length);
    const parts = suffix.split('/').filter(Boolean);
    if (parts.length !== 1) {
      return false;
    }

    try {
      const channelType = decodeURIComponent(parts[0]);
      const accountId = url.searchParams.get('accountId') || undefined;
      sendJson(res, 200, {
        success: true,
        values: await getChannelFormValues(channelType, accountId),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/channels/config/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 2 && parts[1] === 'default-account') {
      try {
        const channelType = decodeURIComponent(parts[0]);
        const body = await parseJsonBody<{ accountId: string }>(req);
        await setDefaultChannelAccount(channelType, body.accountId);
        scheduleGatewayChannelRestart(ctx, `channel:setDefaultAccount:${channelType}:${body.accountId}`);
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 4 && parts[1] === 'accounts' && parts[3] === 'agent') {
      try {
        const channelType = decodeURIComponent(parts[0]);
        const accountId = decodeURIComponent(parts[2]);
        const body = await parseJsonBody<{ agentId?: string | null }>(req);
        if (body.agentId) {
          const snapshot = await assignChannelAccountToAgent(body.agentId, channelType, accountId);
          scheduleGatewayChannelRestart(ctx, `channel:bindAgent:${channelType}:${accountId}:${body.agentId}`);
          sendJson(res, 200, { success: true, ...snapshot });
        } else {
          const snapshot = await clearChannelBinding(channelType, accountId);
          scheduleGatewayChannelRestart(ctx, `channel:unbindAgent:${channelType}:${accountId}`);
          sendJson(res, 200, { success: true, ...snapshot });
        }
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/channels/config/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 3 && parts[1] === 'accounts') {
      try {
        const channelType = decodeURIComponent(parts[0]);
        const accountId = decodeURIComponent(parts[2]);
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(channelType, accountId);
        scheduleGatewayChannelRestart(ctx, `channel:deleteAccount:${channelType}:${accountId}`);
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length !== 1) {
      return false;
    }

    try {
      const channelType = decodeURIComponent(parts[0]);
      await deleteChannelConfig(channelType);
      await clearAllBindingsForChannel(channelType);
      scheduleGatewayChannelRestart(ctx, `channel:deleteConfig:${channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
