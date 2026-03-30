import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { dirname, join, normalize } from 'path';
import { listConfiguredChannels, readOpenClawConfig } from './channel-config';
import { expandPath, getOpenClawConfigDir } from './paths';
import {
  getManagedAgentDirPath,
  getManagedAgentWorkspacePath,
  resolveManagedAgentWorkspacePath,
} from './managed-agent-workspace';
import { getConfiguredProviderModels, normalizeProviderModelList } from '../shared/providers/config-models';
import { getProviderConfig as getProviderRegistryConfig } from './provider-registry';
import { getOpenClawProviderKeyForType } from './provider-keys';
import { normalizeSpecifiedSkillList, type AgentSkillScope } from './agent-skill-scope';
import { mapWithConcurrency } from './promise-pool';
import { listProviderAccounts, providerAccountToConfig } from '../services/providers/provider-store';
import { getGeeClawAgentStore } from '../services/agents/store-instance';
import { saveAgentRuntimeConfigToStore, syncAllAgentConfigToOpenClaw } from '../services/agents/agent-runtime-sync';
import { getAgentPreset, listAgentPresets } from './agent-presets';
import {
  formatPresetPlatforms,
  isPresetSupportedOnPlatform,
  type AgentPresetPlatform,
} from './agent-preset-platforms';
import * as logger from './logger';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main';
const DEFAULT_ACCOUNT_ID = 'default';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'MEMORY.md',
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
const PRESET_SKILL_WRITE_CONCURRENCY = 16;

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

type ManagedLockedField = 'id' | 'workspace' | 'persona';
type PersonaFieldKey = 'identity' | 'master' | 'soul' | 'memory';
const LOCKED_MANAGED_PERSONA_FILES: PersonaFieldKey[] = ['identity'];
const LOCKED_MANAGED_PERSONA_FILE_SET = new Set<PersonaFieldKey>(LOCKED_MANAGED_PERSONA_FILES);

interface ManagedAgentMetadata {
  agentId: string;
  source: 'preset';
  presetId: string;
  managed: boolean;
  lockedFields: ManagedLockedField[];
  canUnmanage?: boolean;
  presetSkills: string[];
  managedFiles: string[];
  installedAt: string;
  unmanagedAt?: string;
}

export interface AgentSettingsUpdate {
  name?: string;
  skillScope?: AgentSkillScope;
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
  source: 'custom' | 'preset';
  managed: boolean;
  presetId?: string;
  lockedFields: ManagedLockedField[];
  canUnmanage: boolean;
  managedFiles: string[];
  skillScope: AgentSkillScope;
  presetSkills: string[];
  canUseDefaultSkillScope: boolean;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  explicitChannelAccountBindings: Record<string, string>;
}

export interface AgentPersonaFileSnapshot {
  exists: boolean;
  content: string;
}

export interface AgentPersonaSnapshot {
  agentId: string;
  workspace: string;
  editable: boolean;
  lockedFiles: PersonaFieldKey[];
  message?: string;
  files: {
    identity: AgentPersonaFileSnapshot;
    master: AgentPersonaFileSnapshot;
    soul: AgentPersonaFileSnapshot;
    memory: AgentPersonaFileSnapshot;
  };
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

const PERSONA_FILE_MAP = {
  identity: 'IDENTITY.md',
  master: 'USER.md',
  soul: 'SOUL.md',
  memory: 'MEMORY.md',
} as const;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function normalizeSkillScope(scope: unknown): AgentSkillScope {
  if (!scope || typeof scope !== 'object') {
    return { mode: 'default' };
  }

  const mode = (scope as { mode?: unknown }).mode;
  if (mode !== 'specified') {
    return { mode: 'default' };
  }

  const rawSkills = Array.isArray((scope as { skills?: unknown[] }).skills)
    ? (scope as { skills?: unknown[] }).skills ?? []
    : [];
  const normalized = normalizeSpecifiedSkillList(rawSkills, {
    duplicateError: 'Specified skill scope must not contain duplicate skills',
    emptyError: 'Specified skill scope must contain at least 1 skill',
    tooManyError: 'Specified skill scope must not contain more than 6 skills',
  });

  return { mode: 'specified', skills: normalized };
}

export function validateManagedSkillScope(
  presetSkills: string[],
  nextScope: AgentSkillScope,
): void {
  if (nextScope.mode === 'default') {
    if (presetSkills.length > 0) {
      throw new Error('Managed preset agents with preset skills cannot use the default skill scope');
    }
    return;
  }

  const nextSkills = new Set(nextScope.skills);
  for (const presetSkill of presetSkills) {
    if (!nextSkills.has(presetSkill)) {
      throw new Error('Managed agents cannot remove preset-defined skills');
    }
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
  await mkdir(path, { recursive: true });
}

async function readAgentManagementMap(): Promise<Record<string, ManagedAgentMetadata>> {
  const store = await getGeeClawAgentStore();
  const value = store.get('management');
  return value && typeof value === 'object'
    ? cloneValue(value as Record<string, ManagedAgentMetadata>)
    : {};
}

async function writeAgentManagementMap(nextMap: Record<string, ManagedAgentMetadata>): Promise<void> {
  const store = await getGeeClawAgentStore();
  if (Object.keys(nextMap).length === 0) {
    store.delete('management');
    return;
  }

  store.set('management', cloneValue(nextMap));
}

function readAgentSkillScope(entry: AgentListEntry): AgentSkillScope {
  const skills = Array.isArray(entry.skills)
    ? entry.skills
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
    : [];

  return skills.length === 0
    ? { mode: 'default' }
    : { mode: 'specified', skills };
}

function applyAgentSkillScope(entry: AgentListEntry, scope: AgentSkillScope): AgentListEntry {
  const nextEntry = { ...entry };
  if (scope.mode === 'default') {
    delete nextEntry.skills;
    return nextEntry;
  }

  nextEntry.skills = [...scope.skills];
  return nextEntry;
}

async function seedPresetFilesIntoWorkspace(
  workspace: string,
  files: Record<string, string>,
): Promise<void> {
  await ensureDir(workspace);

  for (const [fileName, content] of Object.entries(files)) {
    const destination = join(workspace, fileName);
    if (await fileExists(destination)) {
      throw new Error(`Preset-managed file "${fileName}" already exists in the target workspace`);
    }
    await writeFile(destination, content, 'utf-8');
  }
}

async function seedPresetSkillsIntoWorkspace(
  workspace: string,
  skills: Record<string, Record<string, string>>,
): Promise<void> {
  if (Object.keys(skills).length === 0) {
    return;
  }

  const skillsRoot = join(workspace, 'SKILLS');
  await ensureDir(skillsRoot);

  for (const [skillSlug, files] of Object.entries(skills)) {
    const targetDir = join(skillsRoot, skillSlug);
    if (await fileExists(targetDir)) {
      throw new Error(`Preset skill "${skillSlug}" already exists in the target workspace`);
    }

    await mapWithConcurrency(
      Object.entries(files),
      PRESET_SKILL_WRITE_CONCURRENCY,
      async ([relativePath, content]) => {
        const destination = join(targetDir, relativePath);
        await ensureDir(dirname(destination));
        await writeFile(destination, content, 'utf-8');
      },
    );
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : readLegacyMainWorkspaceFromConfig(config)
      ?? getManagedAgentWorkspacePath(MAIN_AGENT_ID);
}

function readLegacyMainWorkspaceFromConfig(config: AgentConfigDocument): string | undefined {
  const entries = (
    config.agents && typeof config.agents === 'object' && Array.isArray((config.agents as AgentsConfig).list)
      ? (config.agents as AgentsConfig).list
      : []
  ) as AgentListEntry[];
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID);
  return typeof mainEntry?.workspace === 'string' && mainEntry.workspace.trim()
    ? mainEntry.workspace
    : undefined;
}

function getDefaultAgentDirPath(agentId: string): string {
  return getManagedAgentDirPath(agentId);
}

function isRedundantDefaultAgentDir(agentId: string, agentDir: unknown): boolean {
  if (typeof agentDir !== 'string' || !agentDir.trim()) {
    return false;
  }

  const configuredValue = trimTrailingSeparators(agentDir.trim());
  const defaultValue = trimTrailingSeparators(getDefaultAgentDirPath(agentId));
  if (configuredValue === defaultValue) {
    return true;
  }

  return trimTrailingSeparators(normalize(expandPath(configuredValue)))
    === trimTrailingSeparators(normalize(expandPath(defaultValue)));
}

function getDefaultWorkspacePathForAgent(agentId: string): string {
  return getManagedAgentWorkspacePath(agentId);
}

function createImplicitMainEntry(_config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
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
  const defaults = (
    agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
      ? { ...(agentsConfig.defaults as AgentDefaultsConfig) }
      : {}
  ) as AgentDefaultsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];
  const rawMainEntry = rawEntries.find((entry) => entry.id === MAIN_AGENT_ID);
  const migratedMainWorkspace = typeof rawMainEntry?.workspace === 'string' && rawMainEntry.workspace.trim()
    ? rawMainEntry.workspace
    : undefined;
  if (!(typeof defaults.workspace === 'string' && defaults.workspace.trim())) {
    defaults.workspace = migratedMainWorkspace ?? getManagedAgentWorkspacePath(MAIN_AGENT_ID);
  }
  agentsConfig.defaults = defaults;

  const normalizedEntries = rawEntries.map((entry) => {
    const nextEntry = { ...entry };
    if (nextEntry.id === MAIN_AGENT_ID) {
      delete nextEntry.workspace;
    }
    if (isRedundantDefaultAgentDir(nextEntry.id, nextEntry.agentDir)) {
      delete nextEntry.agentDir;
    }
    return nextEntry;
  });

  if (normalizedEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = normalizedEntries.find((entry) => entry.default) ?? normalizedEntries[0];
  return {
    agentsConfig,
    entries: normalizedEntries,
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

  const configuredWorkspaceValue = agent.workspace || getDefaultWorkspacePathForAgent(agent.id);
  const configuredWorkspace = expandPath(configuredWorkspaceValue);
  const managedWorkspaceValue = getDefaultWorkspacePathForAgent(agent.id);
  const managedWorkspace = resolveManagedAgentWorkspacePath(agent.id);
  const normalizedConfiguredValue = trimTrailingSeparators(configuredWorkspaceValue);
  const normalizedManagedValue = trimTrailingSeparators(managedWorkspaceValue);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfiguredValue === normalizedManagedValue || normalizedConfigured === normalizedManaged
    ? configuredWorkspace
    : null;
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
  const management = await readAgentManagementMap();
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
    const managedMetadata = management[entry.id];
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
      source: managedMetadata?.source === 'preset' ? 'preset' : 'custom',
      managed: managedMetadata?.managed === true,
      presetId: managedMetadata?.presetId,
      lockedFields: managedMetadata?.managed ? [...managedMetadata.lockedFields] : [],
      canUnmanage: managedMetadata?.managed ? managedMetadata.canUnmanage !== false : false,
      managedFiles: managedMetadata?.managed ? [...managedMetadata.managedFiles] : [],
      skillScope: readAgentSkillScope(entry),
      presetSkills: managedMetadata?.managed ? [...managedMetadata.presetSkills] : [],
      canUseDefaultSkillScope: !(managedMetadata?.managed) || managedMetadata.presetSkills.length === 0,
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

function getWorkspacePathForEntry(config: AgentConfigDocument, entry: AgentListEntry): string {
  return expandPath(
    entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : getDefaultWorkspacePathForAgent(entry.id)),
  );
}

function getAgentEntryById(config: AgentConfigDocument, agentId: string): AgentListEntry {
  const { entries } = normalizeAgentsConfig(config);
  const entry = entries.find((candidate) => candidate.id === agentId);
  if (!entry) {
    throw new Error(`Agent "${agentId}" not found`);
  }
  return entry;
}

async function readPersonaFileSnapshot(workspace: string, fileName: string): Promise<AgentPersonaFileSnapshot> {
  const filePath = join(workspace, fileName);
  if (!(await fileExists(filePath))) {
    return { exists: false, content: '' };
  }

  return {
    exists: true,
    content: await readFile(filePath, 'utf-8'),
  };
}

async function buildAgentPersonaSnapshot(
  config: AgentConfigDocument,
  agentId: string,
): Promise<AgentPersonaSnapshot> {
  const entry = getAgentEntryById(config, agentId);
  const workspace = getWorkspacePathForEntry(config, entry);
  const management = await readAgentManagementMap();
  const managedMetadata = management[agentId];
  const personaLocked = managedMetadata?.managed && managedMetadata.lockedFields.includes('persona');
  const lockedFiles = personaLocked ? LOCKED_MANAGED_PERSONA_FILES : [];

  return {
    agentId: entry.id,
    workspace,
    editable: lockedFiles.length < Object.keys(PERSONA_FILE_MAP).length,
    lockedFiles,
    message: personaLocked
      ? 'Managed preset agents can edit USER.md, MEMORY.md, and SOUL.md while IDENTITY.md stays locked'
      : undefined,
    files: {
      identity: await readPersonaFileSnapshot(workspace, PERSONA_FILE_MAP.identity),
      master: await readPersonaFileSnapshot(workspace, PERSONA_FILE_MAP.master),
      soul: await readPersonaFileSnapshot(workspace, PERSONA_FILE_MAP.soul),
      memory: await readPersonaFileSnapshot(workspace, PERSONA_FILE_MAP.memory),
    },
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

export async function getAgentPersona(agentId: string): Promise<AgentPersonaSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  return buildAgentPersonaSnapshot(config, agentId);
}

export async function updateAgentPersona(
  agentId: string,
  updates: Partial<Record<keyof typeof PERSONA_FILE_MAP, string>>,
): Promise<AgentPersonaSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const management = await readAgentManagementMap();
  const managed = management[agentId];
  if (managed?.managed && managed.lockedFields.includes('persona')) {
    const lockedKeys = (Object.keys(updates) as Array<keyof typeof PERSONA_FILE_MAP>)
      .filter((key) => typeof updates[key] === 'string' && LOCKED_MANAGED_PERSONA_FILE_SET.has(key));
    if (lockedKeys.length > 0) {
      throw new Error(`Managed preset agents cannot edit locked persona files: ${lockedKeys.join(', ')}`);
    }
  }
  const entry = getAgentEntryById(config, agentId);
  const workspace = getWorkspacePathForEntry(config, entry);

  await ensureDir(workspace);

  for (const [key, fileName] of Object.entries(PERSONA_FILE_MAP) as Array<[keyof typeof PERSONA_FILE_MAP, string]>) {
    const nextContent = updates[key];
    if (typeof nextContent !== 'string') {
      continue;
    }
    await writeFile(join(workspace, fileName), nextContent, 'utf-8');
  }

  return buildAgentPersonaSnapshot(config, agentId);
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

export async function listAgentPresetSummaries(): Promise<Array<{
  presetId: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  managed: boolean;
  platforms?: AgentPresetPlatform[];
  supportedOnCurrentPlatform: boolean;
  agentId: string;
  skillScope: AgentSkillScope;
  presetSkills: string[];
  managedFiles: string[];
}>> {
  const presets = await listAgentPresets();
  return presets.map((preset) => ({
    presetId: preset.meta.presetId,
    name: preset.meta.name,
    description: preset.meta.description,
    emoji: preset.meta.emoji,
    category: preset.meta.category,
    managed: true,
    platforms: preset.meta.platforms ? [...preset.meta.platforms] : undefined,
    supportedOnCurrentPlatform: isPresetSupportedOnPlatform(preset.meta.platforms, process.platform),
    agentId: preset.meta.agent.id,
    skillScope: preset.meta.agent.skillScope,
    presetSkills: preset.meta.agent.skillScope.mode === 'specified'
      ? [...preset.meta.agent.skillScope.skills]
      : [],
    managedFiles: Object.keys(preset.files),
  }));
}

function assertPresetSupportedOnCurrentPlatform(preset: {
  meta: {
    presetId: string;
    platforms?: AgentPresetPlatform[];
  };
}): void {
  const { platforms, presetId } = preset.meta;
  if (!platforms || isPresetSupportedOnPlatform(platforms, process.platform)) {
    return;
  }

  throw new Error(
    `Preset "${presetId}" is only available on ${formatPresetPlatforms(platforms)}`,
  );
}

export async function installPresetAgent(presetId: string): Promise<AgentsSnapshot> {
  const preset = await getAgentPreset(presetId);
  assertPresetSupportedOnCurrentPlatform(preset);
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
  const management = await readAgentManagementMap();
  const nextId = normalizeAgentId(preset.meta.agent.id);
  validateAgentId(nextId);

  const existingIds = new Set(entries.map((entry) => entry.id));
  const diskIds = await listExistingAgentIdsOnDisk();
  if (existingIds.has(nextId) || diskIds.has(nextId)) {
    throw new Error(`Preset agent "${nextId}" is already installed`);
  }

  const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.slice(1)] : [...entries];
  const nextScope = normalizeSkillScope(preset.meta.agent.skillScope);
  const lockedFields = preset.meta.managedPolicy?.lockedFields
    ? [...preset.meta.managedPolicy.lockedFields]
    : ['id', 'workspace', 'persona'];
  const newEntry = applyAgentSkillScope({
    id: nextId,
    name: preset.meta.name,
    workspace: getManagedAgentWorkspacePath(nextId),
    ...(preset.meta.agent.model !== undefined ? { model: cloneValue(preset.meta.agent.model) } : {}),
  }, nextScope);
  nextEntries.push(newEntry);

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };

  await seedPresetFilesIntoWorkspace(
    expandPath(newEntry.workspace || getDefaultWorkspacePathForAgent(nextId)),
    preset.files,
  );
  await seedPresetSkillsIntoWorkspace(
    expandPath(newEntry.workspace || getDefaultWorkspacePathForAgent(nextId)),
    preset.skills,
  );
  await provisionAgentFilesystem(config, newEntry);
  await persistAgentConfigAndPatchRuntime(config);

  management[nextId] = {
    agentId: nextId,
    source: 'preset',
    presetId: preset.meta.presetId,
    managed: true,
    lockedFields,
    canUnmanage: preset.meta.managedPolicy?.canUnmanage !== false,
    presetSkills: nextScope.mode === 'specified' ? [...nextScope.skills] : [],
    managedFiles: Object.keys(preset.files),
    installedAt: new Date().toISOString(),
  };
  await writeAgentManagementMap(management);

  logger.info('Installed preset agent', { agentId: nextId, presetId: preset.meta.presetId });
  return buildSnapshotFromConfig(config);
}

export async function updateAgentSettings(
  agentId: string,
  updates: AgentSettingsUpdate,
): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const management = await readAgentManagementMap();
  const managed = management[agentId];
  const { agentsConfig, entries } = normalizeAgentsConfig(config);
  const index = entries.findIndex((entry) => entry.id === agentId);
  if (index === -1) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  let nextEntry = { ...entries[index] };
  if (typeof updates.name === 'string' && updates.name.trim()) {
    nextEntry.name = normalizeAgentName(updates.name);
  }
  if (updates.skillScope) {
    const nextScope = normalizeSkillScope(updates.skillScope);
    if (managed?.managed) {
      validateManagedSkillScope(managed.presetSkills, nextScope);
    }
    nextEntry = applyAgentSkillScope(nextEntry, nextScope);
  }

  entries[index] = nextEntry;
  config.agents = {
    ...agentsConfig,
    list: entries,
  };

  await persistAgentConfigAndPatchRuntime(config);
  logger.info('Updated agent settings', { agentId });
  return buildSnapshotFromConfig(config);
}

export async function unmanageAgent(agentId: string): Promise<AgentsSnapshot> {
  const management = await readAgentManagementMap();
  const current = management[agentId];
  if (!current?.managed) {
    throw new Error(`Agent "${agentId}" is not managed`);
  }
  if (current.canUnmanage === false) {
    throw new Error(`Managed preset agent "${agentId}" cannot be unmanaged`);
  }

  management[agentId] = {
    ...current,
    managed: false,
    presetSkills: [],
    managedFiles: [],
    unmanagedAt: new Date().toISOString(),
  };
  await writeAgentManagementMap(management);

  const config = await readOpenClawConfig() as AgentConfigDocument;
  logger.info('Unmanaged preset agent', { agentId });
  return buildSnapshotFromConfig(config);
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
  const management = await readAgentManagementMap();
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
  if (management[agentId]) {
    delete management[agentId];
    await writeAgentManagementMap(management);
  }
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
