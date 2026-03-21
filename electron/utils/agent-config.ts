import { access, copyFile, mkdir, readdir, rm } from 'fs/promises';
import { constants } from 'fs';
import { join, normalize } from 'path';
import { listConfiguredChannels, readOpenClawConfig } from './channel-config';
import { expandPath, getOpenClawConfigDir } from './paths';
import { getConfiguredProviderModels, normalizeProviderModelList } from '../shared/providers/config-models';
import { getProviderConfig as getProviderRegistryConfig } from './provider-registry';
import { getOpenClawProviderKeyForType } from './provider-keys';
import { listProviderAccounts, providerAccountToConfig } from '../services/providers/provider-store';
import { saveAgentRuntimeConfigToStore, syncAllAgentConfigToOpenClaw } from '../services/agents/agent-runtime-sync';
import * as logger from './logger';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main';
const DEFAULT_ACCOUNT_ID = 'default';
const MANAGED_OPENCLAW_HOME = '~/.openclaw-geeclaw';
const DEFAULT_WORKSPACE_PATH = `${MANAGED_OPENCLAW_HOME}/workspace`;
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface ChannelSectionConfig extends Record<string, unknown> {
  accounts?: Record<string, Record<string, unknown>>;
  defaultAccount?: string;
  enabled?: boolean;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelSectionConfig>;
  session?: {
    mainKey?: string;
    [key: string]: unknown;
  };
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  channelAccounts: Array<{ channelType: string; accountId: string }>;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  explicitChannelAccountBindings: Record<string, string>;
}

export interface AvailableProviderModelGroup {
  providerId: string;
  providerName: string;
  modelRefs: string[];
}

export interface DefaultAgentModelConfigSnapshot {
  primary: string | null;
  fallbacks: string[];
  availableModels: AvailableProviderModelGroup[];
}

function formatModelLabel(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    const trimmed = model.trim();
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      const parts = primary.trim().split('/');
      return parts[parts.length - 1] || primary.trim();
    }
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function normalizeAgentId(agentId: string): string {
  return agentId.trim().toLowerCase();
}

function validateAgentId(agentId: string): void {
  // lowercase letters, numbers, and internal hyphens; no leading/trailing hyphen
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentId);
  if (!valid) {
    throw new Error('Invalid Agent ID. Use lowercase letters, numbers, and hyphens only.');
  }
  if (agentId === MAIN_AGENT_ID) {
    throw new Error('Agent ID "main" is reserved.');
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `${MANAGED_OPENCLAW_HOME}/agents/${agentId}/agent`;
}

function getDefaultWorkspacePathForAgent(agentId: string): string {
  if (agentId === MAIN_AGENT_ID) {
    return DEFAULT_WORKSPACE_PATH;
  }

  return `${MANAGED_OPENCLAW_HOME}/workspace-${agentId}`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  if (typeof candidate.match.channel !== 'string' || !candidate.match.channel) return false;
  const keys = Object.keys(candidate.match);
  if (keys.length === 1 && keys[0] === 'channel') return true;
  if (keys.length === 2 && keys.includes('channel') && keys.includes('accountId')) return true;
  return false;
}

function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'main';
}

function readDefaultAgentModelConfig(
  config: AgentConfigDocument,
): { primary: string | null; fallbacks: string[] } {
  const defaults = (
    config.agents && typeof config.agents === 'object'
      ? (config.agents as AgentsConfig).defaults
      : undefined
  );
  const modelConfig = defaults?.model;

  if (typeof modelConfig === 'string') {
    return {
      primary: modelConfig.trim() || null,
      fallbacks: [],
    };
  }

  if (modelConfig && typeof modelConfig === 'object') {
    const primary = typeof modelConfig.primary === 'string' && modelConfig.primary.trim()
      ? modelConfig.primary.trim()
      : null;
    const fallbacks = normalizeProviderModelList(
      Array.isArray((modelConfig as Record<string, unknown>).fallbacks)
        ? ((modelConfig as Record<string, unknown>).fallbacks as Array<string | null | undefined>)
        : [],
    );
    return { primary, fallbacks };
  }

  return { primary: null, fallbacks: [] };
}

function getRegistryProviderModelRefs(providerId: string, providerKey: string): string[] {
  return normalizeProviderModelList(
    (getProviderRegistryConfig(providerId)?.models ?? []).map((model) => {
      const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
      if (!modelId) {
        return undefined;
      }
      return `${providerKey}/${modelId}`;
    }),
  );
}

function getConfiguredProviderModelRefs(
  provider: { id: string; type: string; models?: string[]; model?: string; fallbackModels?: string[] },
  providerKey: string,
): string[] {
  return normalizeProviderModelList(
    getConfiguredProviderModels(provider).map((model) => (
      model.startsWith(`${providerKey}/`) ? model : `${providerKey}/${model}`
    )),
  );
}

async function listAvailableProviderModelGroups(): Promise<AvailableProviderModelGroup[]> {
  const providers = (await listProviderAccounts()).map(providerAccountToConfig);

  return providers
    .map((provider) => {
      const providerKey = getOpenClawProviderKeyForType(provider.type, provider.id);
      const modelRefs = normalizeProviderModelList([
        ...getConfiguredProviderModelRefs(provider, providerKey),
        ...getRegistryProviderModelRefs(provider.type, providerKey),
      ]);

      return {
        providerId: provider.id,
        providerName: provider.name,
        modelRefs,
      };
    })
    .filter((provider) => provider.modelRefs.length > 0)
    .sort((left, right) => left.providerName.localeCompare(right.providerName));
}

function buildAgentMainSessionKey(config: AgentConfigDocument, agentId: string): string {
  return `agent:${normalizeAgentIdForBinding(agentId) || MAIN_AGENT_ID}:${normalizeMainKey(config.session?.mainKey)}`;
}

function getChannelBindingMap(bindings: unknown): {
  channelToAgent: Map<string, string>;
  accountToAgent: Map<string, string>;
} {
  const channelToAgent = new Map<string, string>();
  const accountToAgent = new Map<string, string>();
  if (!Array.isArray(bindings)) return { channelToAgent, accountToAgent };

  for (const binding of bindings) {
    if (!isChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    if (!agentId || !channel) continue;

    const accountId = binding.match?.accountId;
    if (accountId) {
      accountToAgent.set(`${channel}:${accountId}`, agentId);
    } else {
      channelToAgent.set(channel, agentId);
    }
  }

  return { channelToAgent, accountToAgent };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string,
): BindingConfig[] | undefined {
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      if (binding.match?.channel !== channelType) return true;
      if (accountId) {
        return binding.match?.accountId !== accountId;
      }
      return Boolean(binding.match?.accountId);
    })
    : [];

  if (agentId) {
    const match: BindingMatch = { channel: channelType };
    if (accountId) {
      match.accountId = accountId;
    }
    nextBindings.push({ agentId, match });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || getDefaultWorkspacePathForAgent(agent.id));
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

async function removeAgentWorkspaceDirectory(agent: AgentListEntry): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(config: AgentConfigDocument, agent: AgentListEntry): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || getDefaultWorkspacePathForAgent(agent.id));
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  if (targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

export function resolveAccountIdForAgent(agentId: string): string {
  return agentId === MAIN_AGENT_ID ? DEFAULT_ACCOUNT_ID : agentId;
}

function listConfiguredAccountIdsForChannel(config: AgentConfigDocument, channelType: string): string[] {
  const channelSection = config.channels?.[channelType];
  if (!channelSection || channelSection.enabled === false) {
    return [];
  }

  const accounts = channelSection.accounts;
  if (!accounts || typeof accounts !== 'object' || Object.keys(accounts).length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return Object.keys(accounts)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === DEFAULT_ACCOUNT_ID) return -1;
      if (b === DEFAULT_ACCOUNT_ID) return 1;
      return a.localeCompare(b);
    });
}

async function buildSnapshotFromConfig(config: AgentConfigDocument): Promise<AgentsSnapshot> {
  const { entries, defaultAgentId } = normalizeAgentsConfig(config);
  const configuredChannels = await listConfiguredChannels();
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};
  const explicitChannelAccountBindings: Record<string, string> = {};
  const agentChannelSets = new Map<string, Set<string>>();
  const agentChannelAccountSets = new Map<string, Set<string>>();

  for (const channelType of configuredChannels) {
    const accountIds = listConfiguredAccountIdsForChannel(config, channelType);
    let primaryOwner: string | undefined;

    for (const accountId of accountIds) {
      const explicitOwner =
        accountToAgent.get(`${channelType}:${accountId}`)
        || (accountId === DEFAULT_ACCOUNT_ID ? channelToAgent.get(channelType) : undefined);
      const owner =
        explicitOwner
        || (accountId === DEFAULT_ACCOUNT_ID ? defaultAgentIdNorm : undefined);

      if (!owner) {
        continue;
      }

      channelAccountOwners[`${channelType}:${accountId}`] = owner;
      if (explicitOwner) {
        explicitChannelAccountBindings[`${channelType}:${accountId}`] = explicitOwner;
      }
      primaryOwner ??= owner;
      const existing = agentChannelSets.get(owner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(owner, existing);
      const existingAccounts = agentChannelAccountSets.get(owner) ?? new Set();
      existingAccounts.add(`${channelType}:${accountId}`);
      agentChannelAccountSets.set(owner, existingAccounts);
    }

    if (!primaryOwner) {
      primaryOwner = channelToAgent.get(channelType) || defaultAgentIdNorm;
      const existing = agentChannelSets.get(primaryOwner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(primaryOwner, existing);
    }

    channelOwners[channelType] = primaryOwner;
  }

  const defaultModelLabel = formatModelLabel((config.agents as AgentsConfig | undefined)?.defaults?.model);
  const agents: AgentSummary[] = entries.map((entry) => {
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !formatModelLabel(entry.model) && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const ownedChannels = agentChannelSets.get(entryIdNorm) ?? new Set<string>();
    const ownedChannelAccounts = [...(agentChannelAccountSets.get(entryIdNorm) ?? new Set<string>())]
      .map((entryKey) => {
        const [channelType, accountId] = entryKey.split(':');
        return { channelType, accountId };
      })
      .sort((left, right) => left.channelType.localeCompare(right.channelType) || left.accountId.localeCompare(right.accountId));
    return {
      id: entry.id,
      name: entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      inheritedModel,
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : getDefaultWorkspacePathForAgent(entry.id)),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      mainSessionKey: buildAgentMainSessionKey(config, entry.id),
      channelTypes: configuredChannels.filter((ct) => ownedChannels.has(ct)),
      channelAccounts: ownedChannelAccounts,
    };
  });

  return {
    agents,
    defaultAgentId,
    configuredChannelTypes: configuredChannels,
    channelOwners,
    channelAccountOwners,
    explicitChannelAccountBindings,
  };
}

async function persistAgentConfigAndPatchRuntime(config: AgentConfigDocument): Promise<void> {
  await saveAgentRuntimeConfigToStore({
    agents: config.agents,
    bindings: config.bindings,
  });
  await syncAllAgentConfigToOpenClaw();
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  return buildSnapshotFromConfig(config);
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [MAIN_AGENT_ID];
}

export async function getDefaultAgentModelConfig(): Promise<DefaultAgentModelConfigSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { primary, fallbacks } = readDefaultAgentModelConfig(config);
  return {
    primary,
    fallbacks,
    availableModels: await listAvailableProviderModelGroups(),
  };
}

export async function updateDefaultAgentFallbacks(
  fallbacks: string[],
): Promise<DefaultAgentModelConfigSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const normalizedFallbacks = normalizeProviderModelList(fallbacks);
  const availableModels = await listAvailableProviderModelGroups();
  const availableRefs = new Set(availableModels.flatMap((provider) => provider.modelRefs));
  const invalidRefs = normalizedFallbacks.filter((modelRef) => !availableRefs.has(modelRef));

  if (invalidRefs.length > 0) {
    throw new Error(`Unknown fallback models: ${invalidRefs.join(', ')}`);
  }

  const defaults = (
    config.agents && typeof config.agents === 'object'
      ? (((config.agents as AgentsConfig).defaults ?? {}) as AgentDefaultsConfig)
      : {}
  );
  const current = readDefaultAgentModelConfig(config);

  defaults.model = {
    primary: current.primary ?? undefined,
    fallbacks: normalizedFallbacks,
  };

  config.agents = {
    ...(config.agents && typeof config.agents === 'object' ? (config.agents as AgentsConfig) : {}),
    defaults,
  };

  await persistAgentConfigAndPatchRuntime(config);

  return {
    primary: current.primary,
    fallbacks: normalizedFallbacks,
    availableModels,
  };
}

export async function createAgent(name: string, requestedId: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
  const normalizedName = normalizeAgentName(name);
  const normalizedRequestedId = normalizeAgentId(requestedId);
  validateAgentId(normalizedRequestedId);
  const existingIds = new Set(entries.map((entry) => entry.id));
  const diskIds = await listExistingAgentIdsOnDisk();
  if (existingIds.has(normalizedRequestedId) || diskIds.has(normalizedRequestedId)) {
    throw new Error(`Agent ID "${normalizedRequestedId}" already exists.`);
  }
  const nextId = normalizedRequestedId;

  const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)] : [...entries];
  const newAgent: AgentListEntry = {
    id: nextId,
    name: normalizedName,
    workspace: getDefaultWorkspacePathForAgent(nextId),
    agentDir: getDefaultAgentDirPath(nextId),
  };

  if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
    nextEntries.unshift(createImplicitMainEntry(config));
  }
  nextEntries.push(newAgent);

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };

  await provisionAgentFilesystem(config, newAgent);
  await persistAgentConfigAndPatchRuntime(config);
  logger.info('Created agent config entry', { agentId: nextId });
  return buildSnapshotFromConfig(config);
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries } = normalizeAgentsConfig(config);
  const normalizedName = normalizeAgentName(name);
  const index = entries.findIndex((entry) => entry.id === agentId);
  if (index === -1) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  entries[index] = {
    ...entries[index],
    name: normalizedName,
  };

  config.agents = {
    ...agentsConfig,
    list: entries,
  };

  await persistAgentConfigAndPatchRuntime(config);
  logger.info('Updated agent name', { agentId, name: normalizedName });
  return buildSnapshotFromConfig(config);
}

export async function deleteAgentConfig(agentId: string): Promise<AgentsSnapshot> {
  if (agentId === MAIN_AGENT_ID) {
    throw new Error('The main agent cannot be deleted');
  }

  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
  const removedEntry = entries.find((entry) => entry.id === agentId);
  const nextEntries = entries.filter((entry) => entry.id !== agentId);
  if (!removedEntry || nextEntries.length === entries.length) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };
  config.bindings = Array.isArray(config.bindings)
    ? config.bindings.filter((binding) => !(isChannelBinding(binding) && binding.agentId === agentId))
    : undefined;

  if (defaultAgentId === agentId && nextEntries.length > 0) {
    nextEntries[0] = {
      ...nextEntries[0],
      default: true,
    };
  }

  await persistAgentConfigAndPatchRuntime(config);
  await removeAgentRuntimeDirectory(agentId);
  await removeAgentWorkspaceDirectory(removedEntry);
  logger.info('Deleted agent config entry', { agentId });
  return buildSnapshotFromConfig(config);
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  return assignChannelAccountToAgent(agentId, channelType, DEFAULT_ACCOUNT_ID);
}

export async function assignChannelAccountToAgent(
  agentId: string,
  channelType: string,
  accountId: string,
): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  if (!entries.some((entry) => entry.id === agentId)) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
  await persistAgentConfigAndPatchRuntime(config);
  logger.info('Assigned channel to agent', { agentId, channelType, accountId });
  return buildSnapshotFromConfig(config);
}

export async function clearChannelBinding(channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
  await persistAgentConfigAndPatchRuntime(config);
  logger.info('Cleared channel binding', { channelType, accountId });
  return buildSnapshotFromConfig(config);
}

export async function clearAllBindingsForChannel(channelType: string): Promise<void> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  if (!Array.isArray(config.bindings)) return;

  const nextBindings = config.bindings.filter((binding) => {
    if (!isChannelBinding(binding)) return true;
    return binding.match?.channel !== channelType;
  });

  config.bindings = nextBindings.length > 0 ? nextBindings : undefined;
  await persistAgentConfigAndPatchRuntime(config);
  logger.info('Cleared all bindings for channel', { channelType });
}
