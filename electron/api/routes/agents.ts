import type { IncomingMessage, ServerResponse } from 'http';
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
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
  updateDefaultAgentModelConfig,
} from '../../utils/agent-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawConfigDir } from '../../utils/paths';

const execAsync = promisify(exec);

type AgentSessionRecord = {
  deliveryContext?: { channel?: string; to?: string; accountId?: string };
  origin?: { label?: string; to?: string; accountId?: string };
  chatType?: string;
  sessionFile?: string;
  file?: string;
  fileName?: string;
  path?: string;
  sessionId?: string;
  id?: string;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  channel?: string;
};

type AgentSessionSuggestion = {
  sessionKey: string;
  label: string;
  channel: string;
  to: string;
  accountId: string;
  chatType?: string;
};

type SenderMetadataSuggestion = {
  to: string;
  label: string;
};

type ChannelDefaultEntry = {
  to?: unknown;
};

type ChannelAccountDefaults = Record<string, ChannelDefaultEntry>;
type ChannelDefaultValue = ChannelDefaultEntry | ChannelAccountDefaults;
type ChannelDefaultsFile = Record<string, Record<string, ChannelDefaultValue>>;

const SENDER_METADATA_RE = /Sender \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/;
const CONVERSATION_METADATA_RE = /Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/;

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = readString(value);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function isInvalidPathSegment(value: string): boolean {
  return value.includes('..')
    || value.includes('/')
    || value.includes('\\')
    || isAbsolute(value);
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isChannelDefaultEntry(value: unknown): value is ChannelDefaultEntry {
  return isRecord(value) && Boolean(readString(value.to));
}

function extractTextContent(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      return readString((item as Record<string, unknown>).text) ?? '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractSenderMetadataSuggestionFromText(text: string): SenderMetadataSuggestion | undefined {
  const senderMatch = text.match(SENDER_METADATA_RE);
  if (!senderMatch?.[1]) {
    return undefined;
  }

  const sender = parseJsonObject(senderMatch[1]);
  if (!sender) {
    return undefined;
  }

  const conversationMatch = text.match(CONVERSATION_METADATA_RE);
  const conversation = conversationMatch?.[1]
    ? parseJsonObject(conversationMatch[1])
    : undefined;
  const to = firstString(
    sender.id,
    sender.senderId,
    sender.sender_id,
    sender.userId,
    sender.user_id,
    sender.openId,
    sender.open_id,
    conversation?.sender_id,
    conversation?.sender,
  );

  if (!to || to === 'gateway-client') {
    return undefined;
  }

  return {
    to,
    label: firstString(sender.label, sender.name, sender.username, conversation?.sender) ?? to,
  };
}

async function readSenderMetadataSuggestion(sessionFile: string | undefined): Promise<SenderMetadataSuggestion | undefined> {
  if (!sessionFile) {
    return undefined;
  }

  try {
    const raw = await readFile(sessionFile, 'utf-8');
    let latest: SenderMetadataSuggestion | undefined;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.includes('Sender (untrusted metadata):')) {
        continue;
      }
      const outer = parseJsonObject(line);
      const maybeMessage = outer?.message;
      const message = maybeMessage && typeof maybeMessage === 'object' && !Array.isArray(maybeMessage)
        ? maybeMessage as Record<string, unknown>
        : outer;
      if (!message || readString(message.role) !== 'user') {
        continue;
      }
      const suggestion = extractSenderMetadataSuggestionFromText(extractTextContent(message));
      if (suggestion) {
        latest = suggestion;
      }
    }
    return latest;
  } catch {
    return undefined;
  }
}

function resolveSessionFile(sessionsDir: string, record: AgentSessionRecord): string | undefined {
  const explicitPath = firstString(record.sessionFile, record.file, record.fileName, record.path);
  if (explicitPath) {
    return isAbsolute(explicitPath) ? explicitPath : join(sessionsDir, explicitPath);
  }

  const sessionId = firstString(record.sessionId, record.id);
  if (!sessionId) {
    return undefined;
  }

  return join(sessionsDir, sessionId.endsWith('.jsonl') ? sessionId : `${sessionId}.jsonl`);
}

async function buildChannelDefaultSuggestions(agentId: string): Promise<AgentSessionSuggestion[]> {
  const defaultsPath = join(getOpenClawConfigDir(), 'channel-defaults.json');
  let data: ChannelDefaultsFile;
  try {
    data = JSON.parse(await readFile(defaultsPath, 'utf-8')) as ChannelDefaultsFile;
  } catch {
    return [];
  }

  const agentDefaults = data && typeof data === 'object' && !Array.isArray(data)
    ? data[agentId]
    : undefined;
  if (!agentDefaults || typeof agentDefaults !== 'object' || Array.isArray(agentDefaults)) {
    return [];
  }

  const suggestions: AgentSessionSuggestion[] = [];
  for (const [channel, value] of Object.entries(agentDefaults)) {
    if (isChannelDefaultEntry(value)) {
      const to = readString(value.to);
      if (to) {
        suggestions.push({
          sessionKey: `agent:${agentId}:${channel}:default`,
          label: to,
          channel,
          to,
          accountId: 'default',
          chatType: 'direct',
        });
      }
      continue;
    }

    if (!isRecord(value)) {
      continue;
    }

    for (const [accountId, entry] of Object.entries(value)) {
      if (!isChannelDefaultEntry(entry)) {
        continue;
      }
      const to = readString(entry.to);
      if (!to) {
        continue;
      }
      suggestions.push({
        sessionKey: `agent:${agentId}:${channel}:${accountId}`,
        label: to,
        channel,
        to,
        accountId,
        chatType: 'direct',
      });
    }
  }

  return suggestions;
}

export async function buildAgentSessionSuggestions(agentId: string): Promise<AgentSessionSuggestion[]> {
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const sessionsPath = join(sessionsDir, 'sessions.json');
  const raw = await readFile(sessionsPath, 'utf-8');
  const data = JSON.parse(raw) as Record<string, AgentSessionRecord>;
  const suggestions: AgentSessionSuggestion[] = [];

  for (const [sessionKey, record] of Object.entries(data)) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    const channel = firstString(record.deliveryContext?.channel, record.lastChannel, record.channel);
    if (!channel) {
      continue;
    }

    const senderSuggestion = (!record.deliveryContext?.to && !record.lastTo && !record.origin?.to)
      ? await readSenderMetadataSuggestion(resolveSessionFile(sessionsDir, record))
      : undefined;
    const to = firstString(record.deliveryContext?.to, record.lastTo, record.origin?.to, senderSuggestion?.to);
    if (!to) {
      continue;
    }

    suggestions.push({
      sessionKey,
      label: firstString(senderSuggestion?.label, record.origin?.label) ?? sessionKey,
      channel,
      to,
      accountId: firstString(record.deliveryContext?.accountId, record.lastAccountId, record.origin?.accountId) ?? 'default',
      chatType: record.chatType,
    });
  }

  return suggestions;
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
      const body = await parseJsonBody(req);
      const snapshot = await updateDefaultAgentModelConfig(body);
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
          activeMemoryEnabled?: boolean;
          activeEvolutionEnabled?: boolean;
          manualSkills?: string[];
          skillScope?: { mode: 'default' | 'specified'; skills?: string[] };
        }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentSettings(agentId, {
          name: body.name,
          avatarPresetId: body.avatarPresetId,
          activeMemoryEnabled: typeof body.activeMemoryEnabled === 'boolean' ? body.activeMemoryEnabled : undefined,
          activeEvolutionEnabled: typeof body.activeEvolutionEnabled === 'boolean' ? body.activeEvolutionEnabled : undefined,
          manualSkills: Array.isArray(body.manualSkills) ? body.manualSkills : undefined,
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
      if (isInvalidPathSegment(agentId)) {
        sendJson(res, 400, { success: false, error: 'Invalid agent ID', code: 'INVALID_AGENT_ID' });
        return true;
      }
      try {
        // channel-defaults.json is currently the source of truth for cron
        // delivery suggestions. Keep buildAgentSessionSuggestions() available
        // above so we can restore or merge the sessions.json/history fallback
        // later if needed.
        // const sessions = await buildAgentSessionSuggestions(agentId);
        sendJson(res, 200, { success: true, sessions: await buildChannelDefaultSuggestions(agentId) });
      } catch {
        sendJson(res, 200, { success: true, sessions: [] });
      }
      return true;
    }
  }

  return false;
}
