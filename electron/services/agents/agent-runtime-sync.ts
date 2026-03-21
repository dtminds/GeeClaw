import { getGeeClawAgentStore } from './store-instance';
import { readOpenClawConfig, type OpenClawConfig } from '../../utils/channel-config';
import { mutateOpenClawConfigDocument } from '../../utils/openclaw-config-coordinator';
import { isDeepStrictEqual } from 'node:util';

interface StoredAgentRuntimeConfig {
  agents?: Record<string, unknown>;
  bindings?: Array<Record<string, unknown>>;
}

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main';
const MANAGED_OPENCLAW_HOME = '~/.openclaw-geeclaw';

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getManagedMainWorkspace(defaults: Record<string, unknown>): string {
  return typeof defaults.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : `${MANAGED_OPENCLAW_HOME}/workspace`;
}

function getManagedMainAgentDir(): string {
  return `${MANAGED_OPENCLAW_HOME}/agents/${MAIN_AGENT_ID}/agent`;
}

function normalizeAgentListWithMainEntry(
  entries: unknown,
  defaults: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const normalizedEntries = Array.isArray(entries)
    ? entries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => cloneValue(entry))
    : [];

  const mainIndex = normalizedEntries.findIndex((entry) => entry.id === MAIN_AGENT_ID);
  const hasDefaultAgent = normalizedEntries.some((entry) => entry.default === true);
  const mainEntry = {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: !hasDefaultAgent,
    workspace: getManagedMainWorkspace(defaults),
    agentDir: getManagedMainAgentDir(),
  } satisfies Record<string, unknown>;

  if (mainIndex === -1) {
    normalizedEntries.unshift(mainEntry);
  } else {
    const existing = normalizedEntries[mainIndex];
    normalizedEntries[mainIndex] = {
      ...mainEntry,
      ...existing,
      id: MAIN_AGENT_ID,
      name: typeof existing.name === 'string' && existing.name.trim() ? existing.name : MAIN_AGENT_NAME,
      workspace: typeof existing.workspace === 'string' && existing.workspace.trim()
        ? existing.workspace
        : mainEntry.workspace,
      agentDir: typeof existing.agentDir === 'string' && existing.agentDir.trim()
        ? existing.agentDir
        : mainEntry.agentDir,
    };
  }

  if (!normalizedEntries.some((entry) => entry.default === true)) {
    const currentMainIndex = normalizedEntries.findIndex((entry) => entry.id === MAIN_AGENT_ID);
    if (currentMainIndex >= 0) {
      normalizedEntries[currentMainIndex] = {
        ...normalizedEntries[currentMainIndex],
        default: true,
      };
    }
  }

  return normalizedEntries;
}

export async function readStoredAgentRuntimeConfig(): Promise<StoredAgentRuntimeConfig> {
  const store = await getGeeClawAgentStore();
  const agents = store.get('agents') as Record<string, unknown> | undefined;
  const bindings = store.get('bindings') as Array<Record<string, unknown>> | undefined;

  return {
    agents: agents ? cloneValue(agents) : undefined,
    bindings: bindings ? cloneValue(bindings) : undefined,
  };
}

export async function saveAgentRuntimeConfigToStore(config: {
  agents?: unknown;
  bindings?: unknown;
}): Promise<void> {
  const store = await getGeeClawAgentStore();

  if (config.agents && typeof config.agents === 'object') {
    store.set('agents', cloneValue(config.agents));
  } else {
    store.delete('agents');
  }

  if (Array.isArray(config.bindings)) {
    store.set('bindings', cloneValue(config.bindings));
  } else {
    store.delete('bindings');
  }
}

function applyStoredAgentRuntimeConfig(
  config: OpenClawConfig,
  storedConfig: StoredAgentRuntimeConfig,
): boolean {
  const { agents: storedAgents, bindings: storedBindings } = storedConfig;
  let modified = false;

  if (storedAgents && Object.keys(storedAgents).length > 0) {
    const currentAgents = (
      config.agents && typeof config.agents === 'object'
        ? cloneValue(config.agents as Record<string, unknown>)
        : {}
    ) as Record<string, unknown>;
    const stored = cloneValue(storedAgents);
    const existingDefaults = (
      currentAgents.defaults && typeof currentAgents.defaults === 'object'
        ? cloneValue(currentAgents.defaults as Record<string, unknown>)
        : {}
    ) as Record<string, unknown>;
    const storedDefaults = (
      stored.defaults && typeof stored.defaults === 'object'
        ? cloneValue(stored.defaults as Record<string, unknown>)
        : {}
    ) as Record<string, unknown>;

    const nextAgents = { ...currentAgents };
    const nextDefaults = { ...existingDefaults, ...storedDefaults };

    nextAgents.defaults = nextDefaults;

    if (Array.isArray(stored.list) || !Array.isArray(nextAgents.list)) {
      nextAgents.list = normalizeAgentListWithMainEntry(stored.list, nextDefaults);
    }

    for (const [key, value] of Object.entries(stored)) {
      if (key === 'defaults' || key === 'list') {
        continue;
      }
      nextAgents[key] = cloneValue(value);
    }

    if (!isDeepStrictEqual(config.agents, nextAgents)) {
      config.agents = nextAgents;
      modified = true;
    }
  }

  if (Array.isArray(storedBindings)) {
    const nextBindings = storedBindings.length > 0 ? cloneValue(storedBindings) : undefined;
    if (!isDeepStrictEqual(config.bindings, nextBindings)) {
      config.bindings = nextBindings;
      modified = true;
    }
  } else if (config.bindings !== undefined) {
    config.bindings = undefined;
    modified = true;
  }

  return modified;
}

export async function syncAllAgentConfigToOpenClaw(): Promise<void> {
  const { agents: storedAgents, bindings: storedBindings } = await readStoredAgentRuntimeConfig();

  let hasStoredConfigs = false;
  if (storedAgents && Object.keys(storedAgents).length > 0) hasStoredConfigs = true;
  if (storedBindings && storedBindings.length > 0) hasStoredConfigs = true;

  if (!hasStoredConfigs) {
    return await migrateOpenClawConfigToStore();
  }

  const modified = await mutateOpenClawConfigDocument<boolean>((config) => {
    const changed = applyStoredAgentRuntimeConfig(config as OpenClawConfig, {
      agents: storedAgents,
      bindings: storedBindings,
    });

    return { changed, result: changed };
  });

  if (modified) {
    return;
  }
}

async function migrateOpenClawConfigToStore(): Promise<void> {
  const config = await readOpenClawConfig();
  const store = await getGeeClawAgentStore();
  
  let migrated = false;

  if (config.agents && Object.keys(config.agents).length > 0) {
    store.set('agents', JSON.parse(JSON.stringify(config.agents)));
    migrated = true;
  }

  if (config.bindings && Array.isArray(config.bindings) && config.bindings.length > 0) {
    store.set('bindings', JSON.parse(JSON.stringify(config.bindings)));
    migrated = true;
  }

  if (migrated) {
    console.log('Migrated existing agent configurations from openclaw.json to local store.');
  }
}
