import { getGeeClawChannelStore } from './store-instance';
import { readOpenClawConfig, reconcileManagedChannelPluginConfig, type OpenClawConfig } from '../../utils/channel-config';
import { mutateOpenClawConfigDocument } from '../../utils/openclaw-config-coordinator';
import { isDeepStrictEqual } from 'node:util';

const MANAGED_SESSION_DM_SCOPE = 'per-channel-peer';
const MANAGED_SESSION_RESET_MODE = 'daily';
const MANAGED_SESSION_RESET_AT_HOUR = 4;
const MANAGED_SESSION_DIRECT_RESET_MODE = 'idle';
const MANAGED_SESSION_DIRECT_IDLE_MINUTES = 960;
const MANAGED_SESSION_GROUP_RESET_MODE = 'idle';
const MANAGED_SESSION_GROUP_IDLE_MINUTES = 240;
const MANAGED_SESSION_THREAD_RESET_MODE = 'daily';
const MANAGED_SESSION_THREAD_AT_HOUR = 4;
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

  const reset = (
    session.reset && typeof session.reset === 'object'
      ? { ...(session.reset as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (reset.mode !== MANAGED_SESSION_RESET_MODE) {
    reset.mode = MANAGED_SESSION_RESET_MODE;
    modified = true;
  }
  if (reset.atHour !== MANAGED_SESSION_RESET_AT_HOUR) {
    reset.atHour = MANAGED_SESSION_RESET_AT_HOUR;
    modified = true;
  }
  session.reset = reset;

  const resetByType = (
    session.resetByType && typeof session.resetByType === 'object'
      ? { ...(session.resetByType as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  const directReset = (
    resetByType.direct && typeof resetByType.direct === 'object'
      ? { ...(resetByType.direct as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (directReset.mode !== MANAGED_SESSION_DIRECT_RESET_MODE) {
    directReset.mode = MANAGED_SESSION_DIRECT_RESET_MODE;
    modified = true;
  }
  if (directReset.idleMinutes !== MANAGED_SESSION_DIRECT_IDLE_MINUTES) {
    directReset.idleMinutes = MANAGED_SESSION_DIRECT_IDLE_MINUTES;
    modified = true;
  }
  resetByType.direct = directReset;

  const groupReset = (
    resetByType.group && typeof resetByType.group === 'object'
      ? { ...(resetByType.group as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (groupReset.mode !== MANAGED_SESSION_GROUP_RESET_MODE) {
    groupReset.mode = MANAGED_SESSION_GROUP_RESET_MODE;
    modified = true;
  }
  if (groupReset.idleMinutes !== MANAGED_SESSION_GROUP_IDLE_MINUTES) {
    groupReset.idleMinutes = MANAGED_SESSION_GROUP_IDLE_MINUTES;
    modified = true;
  }
  resetByType.group = groupReset;

  const threadReset = (
    resetByType.thread && typeof resetByType.thread === 'object'
      ? { ...(resetByType.thread as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  if (threadReset.mode !== MANAGED_SESSION_THREAD_RESET_MODE) {
    threadReset.mode = MANAGED_SESSION_THREAD_RESET_MODE;
    modified = true;
  }
  if (threadReset.atHour !== MANAGED_SESSION_THREAD_AT_HOUR) {
    threadReset.atHour = MANAGED_SESSION_THREAD_AT_HOUR;
    modified = true;
  }
  resetByType.thread = threadReset;
  session.resetByType = resetByType;

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

  let hasStoredConfigs = false;
  if (storedChannels && Object.keys(storedChannels).length > 0) hasStoredConfigs = true;
  if (storedPlugins && Object.keys(storedPlugins).length > 0) hasStoredConfigs = true;

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

    if (storedPlugins && Object.keys(storedPlugins).length > 0) {
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.entries) config.plugins.entries = {};
      for (const [key, value] of Object.entries(storedPlugins)) {
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
    // We only care about plugin channels like whatsapp, feishu
    const pluginChannels = ['whatsapp', 'wecom', 'feishu', 'dingtalk', 'qqbot'];
    const entriesToSave: Record<string, unknown> = {};
    
    for (const type of pluginChannels) {
      if (config.plugins.entries[type]) {
        entriesToSave[type] = config.plugins.entries[type];
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
