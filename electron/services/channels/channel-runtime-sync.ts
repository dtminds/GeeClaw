import { getGeeClawChannelStore } from './store-instance';
import { readOpenClawConfig, reconcileManagedChannelPluginConfig, type OpenClawConfig } from '../../utils/channel-config';
import { mutateOpenClawConfigDocument } from '../../utils/openclaw-config-coordinator';
import { isDeepStrictEqual } from 'node:util';

const MANAGED_PLUGIN_ENTRY_IDS = ['dingtalk', 'wecom-openclaw-plugin', 'openclaw-weixin', 'openclaw-lark'];
const MANAGED_PLUGIN_ENTRY_ID_SET = new Set(MANAGED_PLUGIN_ENTRY_IDS);

const MANAGED_SESSION_DM_SCOPE = 'per-channel-peer';
const MANAGED_SESSION_RESET_MODE = 'idle';
const MANAGED_SESSION_IDLE_MINUTES = 10080;
const MANAGED_SESSION_MAINTENANCE_MODE = 'enforce';
const MANAGED_SESSION_PRUNE_AFTER = '30d';
const MANAGED_SESSION_MAX_ENTRIES = 500;
const MANAGED_SESSION_ROTATE_BYTES = '10mb';
const MANAGED_SESSION_RESET_ARCHIVE_RETENTION = '30d';
const MANAGED_SESSION_MAX_DISK_BYTES = '500mb';
const MANAGED_SESSION_HIGH_WATER_BYTES = '400mb';
const MANAGED_SESSION_THREAD_BINDINGS_ENABLED = true;
const MANAGED_SESSION_THREAD_BINDINGS_IDLE_HOURS = 24;
const MANAGED_SESSION_THREAD_BINDINGS_MAX_AGE_HOURS = 0;
const MANAGED_SESSION_AGENT_TO_AGENT_MAX_PING_PONG_TURNS = 5;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function reconcileManagedSessionConfig(config: OpenClawConfig): boolean {
  const session = (
    config.session && typeof config.session === 'object'
      ? { ...(config.session as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  let modified = false;

  if (session.dmScope !== MANAGED_SESSION_DM_SCOPE) {
    session.dmScope = MANAGED_SESSION_DM_SCOPE;
    modified = true;
  }

  const reset = {
    mode: MANAGED_SESSION_RESET_MODE,
    idleMinutes: MANAGED_SESSION_IDLE_MINUTES,
  };
  if (!isDeepStrictEqual(session.reset, reset)) {
    session.reset = reset;
    modified = true;
  }
  if ('resetByType' in session) {
    delete session.resetByType;
    modified = true;
  }

  const maintenance = (
    session.maintenance && typeof session.maintenance === 'object'
      ? { ...(session.maintenance as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (maintenance.mode !== MANAGED_SESSION_MAINTENANCE_MODE) {
    maintenance.mode = MANAGED_SESSION_MAINTENANCE_MODE;
    modified = true;
  }
  if (maintenance.pruneAfter !== MANAGED_SESSION_PRUNE_AFTER) {
    maintenance.pruneAfter = MANAGED_SESSION_PRUNE_AFTER;
    modified = true;
  }
  if (maintenance.maxEntries !== MANAGED_SESSION_MAX_ENTRIES) {
    maintenance.maxEntries = MANAGED_SESSION_MAX_ENTRIES;
    modified = true;
  }
  if (maintenance.rotateBytes !== MANAGED_SESSION_ROTATE_BYTES) {
    maintenance.rotateBytes = MANAGED_SESSION_ROTATE_BYTES;
    modified = true;
  }
  if (maintenance.resetArchiveRetention !== MANAGED_SESSION_RESET_ARCHIVE_RETENTION) {
    maintenance.resetArchiveRetention = MANAGED_SESSION_RESET_ARCHIVE_RETENTION;
    modified = true;
  }
  if (maintenance.maxDiskBytes !== MANAGED_SESSION_MAX_DISK_BYTES) {
    maintenance.maxDiskBytes = MANAGED_SESSION_MAX_DISK_BYTES;
    modified = true;
  }
  if (maintenance.highWaterBytes !== MANAGED_SESSION_HIGH_WATER_BYTES) {
    maintenance.highWaterBytes = MANAGED_SESSION_HIGH_WATER_BYTES;
    modified = true;
  }
  session.maintenance = maintenance;

  const threadBindings = (
    session.threadBindings && typeof session.threadBindings === 'object'
      ? { ...(session.threadBindings as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (threadBindings.enabled !== MANAGED_SESSION_THREAD_BINDINGS_ENABLED) {
    threadBindings.enabled = MANAGED_SESSION_THREAD_BINDINGS_ENABLED;
    modified = true;
  }
  if (threadBindings.idleHours !== MANAGED_SESSION_THREAD_BINDINGS_IDLE_HOURS) {
    threadBindings.idleHours = MANAGED_SESSION_THREAD_BINDINGS_IDLE_HOURS;
    modified = true;
  }
  if (threadBindings.maxAgeHours !== MANAGED_SESSION_THREAD_BINDINGS_MAX_AGE_HOURS) {
    threadBindings.maxAgeHours = MANAGED_SESSION_THREAD_BINDINGS_MAX_AGE_HOURS;
    modified = true;
  }
  session.threadBindings = threadBindings;

  const agentToAgent = (
    session.agentToAgent && typeof session.agentToAgent === 'object'
      ? { ...(session.agentToAgent as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (agentToAgent.maxPingPongTurns !== MANAGED_SESSION_AGENT_TO_AGENT_MAX_PING_PONG_TURNS) {
    agentToAgent.maxPingPongTurns = MANAGED_SESSION_AGENT_TO_AGENT_MAX_PING_PONG_TURNS;
    modified = true;
  }
  session.agentToAgent = agentToAgent;

  if (modified) {
    config.session = session;
  }

  return modified;
}

export async function syncAllChannelConfigToOpenClaw(): Promise<void> {
  const store = await getGeeClawChannelStore();
  const storedChannels = store.get('channels') as Record<string, unknown> | undefined;
  const storedPlugins = store.get('plugins') as Record<string, unknown> | undefined;
  const managedStoredPlugins = storedPlugins
    ? Object.fromEntries(
        Object.entries(storedPlugins).filter(([pluginId]) => MANAGED_PLUGIN_ENTRY_ID_SET.has(pluginId)),
      )
    : undefined;

  let hasStoredConfigs = false;
  if (storedChannels && Object.keys(storedChannels).length > 0) hasStoredConfigs = true;
  if (managedStoredPlugins && Object.keys(managedStoredPlugins).length > 0) hasStoredConfigs = true;

  if (!hasStoredConfigs) {
    // If the store is empty, but openclaw.json has channels, we should probably 
    // migrate them into the store (first run migration).
    return await migrateOpenClawConfigToStore();
  }

  await mutateOpenClawConfigDocument<void>((document) => {
    const config = document as OpenClawConfig;
    let modified = false;

    if (storedChannels && Object.keys(storedChannels).length > 0) {
      if (!config.channels) config.channels = {};
      for (const [key, value] of Object.entries(storedChannels)) {
        const nextValue = cloneValue(value);
        if (!isDeepStrictEqual(config.channels[key], nextValue)) {
          config.channels[key] = nextValue;
          modified = true;
        }
      }
    }

    if (managedStoredPlugins && Object.keys(managedStoredPlugins).length > 0) {
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.entries) config.plugins.entries = {};
      for (const [key, value] of Object.entries(managedStoredPlugins)) {
        const nextValue = cloneValue(value);
        if (!isDeepStrictEqual(config.plugins.entries[key], nextValue)) {
          config.plugins.entries[key] = nextValue;
          modified = true;
        }
      }
    }

    const allowBefore = JSON.stringify(config.plugins?.allow ?? []);
    const pluginsBefore = JSON.stringify(config.plugins?.entries ?? {});
    reconcileManagedChannelPluginConfig(config);
    if (allowBefore !== JSON.stringify(config.plugins?.allow ?? [])) {
      modified = true;
    }
    if (pluginsBefore !== JSON.stringify(config.plugins?.entries ?? {})) {
      modified = true;
    }

    if (reconcileManagedSessionConfig(config)) {
      modified = true;
    }

    return { changed: modified, result: undefined };
  });
}

async function migrateOpenClawConfigToStore(): Promise<void> {
  const config = await readOpenClawConfig();
  const store = await getGeeClawChannelStore();
  
  let migrated = false;

  if (config.channels && Object.keys(config.channels).length > 0) {
    store.set('channels', JSON.parse(JSON.stringify(config.channels)));
    migrated = true;
  }

  if (config.plugins?.entries && Object.keys(config.plugins.entries).length > 0) {
    // We only care about managed plugin-backed channels here.
    const entriesToSave: Record<string, unknown> = {};
    
    for (const pluginId of MANAGED_PLUGIN_ENTRY_IDS) {
      if (config.plugins.entries[pluginId]) {
        entriesToSave[pluginId] = config.plugins.entries[pluginId];
      }
    }
    
    if (Object.keys(entriesToSave).length > 0) {
      store.set('plugins', JSON.parse(JSON.stringify(entriesToSave)));
      migrated = true;
    }
  }

  if (migrated) {
    console.log('Migrated existing channel configurations from openclaw.json to local store.');
  }
}
