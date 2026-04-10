import type { IncomingMessage, ServerResponse } from 'http';
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  getDefaultAgentModelConfig,
  getAgentPersona,
  installMarketplaceAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
  unmanageAgent,
  updateMarketplaceAgent,
  updateAgentPersona,
  updateAgentSettings,
  updateDefaultAgentFallbacks,
} from '../../utils/agent-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawConfigDir } from '../../utils/paths';

const execAsync = promisify(exec);

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

/**
 * Force a full Gateway process restart after agent deletion.
 *
 * An in-process reload is not sufficient here because channel plugins may
 * keep long-lived connections for accounts that were removed from config.
 */
export async function restartGatewayForAgentDeletion(ctx: HostApiContext): Promise<void> {
  const status = ctx.gatewayManager.getStatus();
  if (status.state === 'stopped') {
    return;
  }

  try {
    const pid = status.pid;
    const port = status.port;
    console.log('[agents] Triggering Gateway restart (kill+respawn) after agent deletion', { pid, port });

    if (pid) {
      try {
        if (process.platform === 'win32') {
          await execAsync(`taskkill /F /PID ${pid} /T`);
        } else {
          process.kill(pid, 'SIGTERM');
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            process.kill(pid, 0);
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process already exited.
          }
        }
      } catch {
        // Process is already gone.
      }
    } else {
      try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
          const { stdout } = await execAsync(`lsof -t -i :${port} -sTCP:LISTEN`);
          const pids = stdout.trim().split('\n').filter(Boolean);
          for (const listenerPid of pids) {
            try {
              process.kill(parseInt(listenerPid, 10), 'SIGTERM');
            } catch {
              // Ignore listeners that have already exited.
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          for (const listenerPid of pids) {
            try {
              process.kill(parseInt(listenerPid, 10), 'SIGKILL');
            } catch {
              // Ignore listeners that have already exited.
            }
          }
        } else if (process.platform === 'win32') {
          const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
          const lines = stdout.trim().split('\n');
          const pids = new Set<string>();
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
              pids.add(parts[4]);
            }
          }
          for (const listenerPid of pids) {
            try {
              await execAsync(`taskkill /F /PID ${listenerPid} /T`);
            } catch {
              // Ignore listeners that have already exited.
            }
          }
        }
      } catch {
        // Listener may already be gone.
      }
    }

    await ctx.gatewayManager.restart();
    console.log('[agents] Gateway restart completed after agent deletion');
  } catch (error) {
    console.warn('[agents] Gateway restart after agent deletion failed:', error);
  }
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

  if (url.pathname === '/api/agents/presets' && req.method === 'GET') {
    sendJson(res, 200, { success: true, presets: await listAgentPresetSummaries() });
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
      const body = await parseJsonBody<{ name: string; id: string; avatarPresetId?: string }>(req);
      const snapshot = await createAgent(body.name, body.id, body.avatarPresetId);
      scheduleGatewayReload(ctx, 'create-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/agents/marketplace/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ agentId: string }>(req);
      const result = await installMarketplaceAgent(body.agentId);
      scheduleGatewayReload(ctx, 'install-marketplace-agent');
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/agents/marketplace/update' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ agentId: string }>(req);
      const result = await updateMarketplaceAgent(body.agentId);
      scheduleGatewayReload(ctx, 'update-marketplace-agent');
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'POST') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 2 && parts[1] === 'unmanage') {
      try {
        const snapshot = await unmanageAgent(decodeURIComponent(parts[0]));
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{
          name?: string;
          avatarPresetId?: string;
          skillScope?: { mode: 'default' | 'specified'; skills?: string[] };
        }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentSettings(agentId, {
          name: body.name,
          avatarPresetId: body.avatarPresetId,
          skillScope: body.skillScope?.mode === 'specified'
            ? { mode: 'specified', skills: body.skillScope.skills ?? [] }
            : body.skillScope?.mode === 'default'
              ? { mode: 'default' }
              : undefined,
        });
        scheduleGatewayReload(ctx, 'update-agent-settings');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 2 && parts[1] === 'persona') {
      try {
        const body = await parseJsonBody<{ identity?: string; master?: string; soul?: string; memory?: string }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentPersona(agentId, {
          identity: body.identity,
          master: body.master,
          soul: body.soul,
          memory: body.memory,
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
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
        const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
        await restartGatewayForAgentDeletion(ctx);
        try {
          await removeAgentWorkspaceDirectory(removedEntry);
        } catch (error) {
          console.warn('[agents] Failed to remove workspace after agent deletion:', error);
        }
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
    if (parts.length === 2 && parts[1] === 'persona') {
      const agentId = decodeURIComponent(parts[0]);
      try {
        sendJson(res, 200, { success: true, ...(await getAgentPersona(agentId)) });
      } catch (error) {
        sendJson(res, 404, { success: false, error: String(error) });
      }
      return true;
    }

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
