import { access, readFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { listAvailableProviderModelGroups, type AvailableProviderModelGroup } from './agent-config';
import { getManagedPlugin } from './managed-plugin-registry';
import { getManagedBundledPluginPolicy } from './plugin-install';
import type { OpenClawConfigDocument } from './openclaw-config-coordinator';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';
import { getOpenClawConfigDir } from './paths';

export const LOSSLESS_CLAW_REQUIRED_VERSION = getManagedPlugin('lossless-claw')?.targetVersion ?? '0.5.2';
const ACTIVE_MEMORY_DEFAULT_AGENTS = ['main'];

type ConfigRecord = Record<string, unknown>;

export type MemoryCardStatus = 'enabled' | 'disabled' | 'not-installed' | 'unavailable';

export type MemorySettingsSnapshot = {
  availableModels: AvailableProviderModelGroup[];
  dreaming: {
    enabled: boolean;
    status: Extract<MemoryCardStatus, 'enabled' | 'disabled' | 'unavailable'>;
  };
  activeMemory: {
    enabled: boolean;
    agents: string[];
    model: string | null;
    modelMode: 'automatic' | 'custom';
    status: Extract<MemoryCardStatus, 'enabled' | 'disabled' | 'unavailable'>;
  };
  losslessClaw: {
    enabled: boolean;
    installedVersion: string | null;
    requiredVersion: string;
    summaryModel: string | null;
    summaryModelMode: 'automatic' | 'custom';
    status: MemoryCardStatus;
  };
};

export type MemorySettingsPatch = {
  dreaming?: {
    enabled?: boolean;
  };
  activeMemory?: {
    enabled?: boolean;
    model?: string | null;
  };
  losslessClaw?: {
    enabled?: boolean;
    summaryModel?: string | null;
  };
};

type LosslessClawInstallState =
  | {
    kind: 'missing';
    installedVersion: null;
  }
  | {
    kind: 'ready';
    installedVersion: string;
  }
  | {
    kind: 'version-mismatch';
    installedVersion: string;
  };

function asRecord(value: unknown): ConfigRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ConfigRecord
    : undefined;
}

function ensureRecord(target: ConfigRecord, key: string): ConfigRecord {
  const existing = asRecord(target[key]);
  if (existing) {
    return existing;
  }

  const next: ConfigRecord = {};
  target[key] = next;
  return next;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function deleteKeyIfPresent(target: ConfigRecord, key: string): boolean {
  if (!(key in target)) {
    return false;
  }
  delete target[key];
  return true;
}

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isRequiredVersionInstalled(installedVersion: string, requiredVersion: string): boolean {
  return installedVersion === requiredVersion;
}

async function readLosslessClawInstallState(): Promise<LosslessClawInstallState> {
  const packageJsonPath = join(getOpenClawConfigDir(), 'extensions', 'lossless-claw', 'package.json');

  try {
    await access(packageJsonPath, constants.F_OK);
  } catch {
    return {
      kind: 'missing',
      installedVersion: null,
    };
  }

  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    const installedVersion = readString(parsed.version);

    if (!installedVersion || !isRequiredVersionInstalled(installedVersion, LOSSLESS_CLAW_REQUIRED_VERSION)) {
      return {
        kind: 'version-mismatch',
        installedVersion: installedVersion ?? '',
      };
    }

    return {
      kind: 'ready',
      installedVersion,
    };
  } catch {
    return {
      kind: 'version-mismatch',
      installedVersion: '',
    };
  }
}

function disableLosslessClawConfig(config: OpenClawConfigDocument): boolean {
  const plugins = ensureRecord(config, 'plugins');
  const slots = ensureRecord(plugins, 'slots');
  const entries = ensureRecord(plugins, 'entries');
  const losslessEntry = ensureRecord(entries, 'lossless-claw');
  let changed = false;

  if (slots.contextEngine === 'lossless-claw') {
    delete slots.contextEngine;
    changed = true;
  }

  if (losslessEntry.enabled !== false) {
    losslessEntry.enabled = false;
    changed = true;
  }

  return changed;
}

function normalizeLosslessClawManagedConfig(losslessEntry: ConfigRecord): boolean {
  const policy = getManagedBundledPluginPolicy('lossless-claw');
  if (!policy?.config) {
    return false;
  }

  let changed = false;

  if ('db' in losslessEntry) {
    delete losslessEntry.db;
    changed = true;
  }

  if ('databasePath' in losslessEntry) {
    delete losslessEntry.databasePath;
    changed = true;
  }

  const currentConfig = asRecord(losslessEntry.config);
  const nextConfig = currentConfig ? { ...currentConfig } : {};

  if (policy.allowedConfigKeys) {
    for (const configKey of Object.keys(nextConfig)) {
      if (!policy.allowedConfigKeys.includes(configKey)) {
        delete nextConfig[configKey];
        changed = true;
      }
    }
  }

  for (const [configKey, configValue] of Object.entries(policy.config)) {
    if (Array.isArray(configValue)) {
      const currentValue = Array.isArray(nextConfig[configKey]) ? nextConfig[configKey] as unknown[] : [];
      if (!arraysEqual(currentValue, configValue)) {
        nextConfig[configKey] = [...configValue];
        changed = true;
      }
      continue;
    }

    if (nextConfig[configKey] !== configValue) {
      nextConfig[configKey] = configValue;
      changed = true;
    }
  }

  if (!currentConfig || changed) {
    losslessEntry.config = nextConfig;
  }

  return changed;
}

function initializeDreamingDefaults(entries: ConfigRecord): boolean {
  const memoryCoreEntry = ensureRecord(entries, 'memory-core');
  const memoryCoreConfig = ensureRecord(memoryCoreEntry, 'config');
  const dreaming = ensureRecord(memoryCoreConfig, 'dreaming');

  if (dreaming.enabled === false || dreaming.enabled === true) {
    return false;
  }

  dreaming.enabled = true;
  return true;
}

function initializeActiveMemoryDefaults(entries: ConfigRecord): boolean {
  const activeMemoryEntry = ensureRecord(entries, 'active-memory');
  const activeMemoryConfig = ensureRecord(activeMemoryEntry, 'config');
  let changed = deleteKeyIfPresent(activeMemoryConfig, 'modelFallbackPolicy');

  const activeMemoryExplicitlyDisabled = activeMemoryEntry.enabled === false || activeMemoryConfig.enabled === false;
  if (activeMemoryExplicitlyDisabled) {
    return changed;
  }

  if (activeMemoryEntry.enabled !== true) {
    activeMemoryEntry.enabled = true;
    changed = true;
  }

  if (activeMemoryConfig.enabled !== true) {
    activeMemoryConfig.enabled = true;
    changed = true;
  }

  const currentAgents = Array.isArray(activeMemoryConfig.agents)
    ? activeMemoryConfig.agents.filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (currentAgents.length !== ACTIVE_MEMORY_DEFAULT_AGENTS.length
    || currentAgents.some((entry, index) => entry !== ACTIVE_MEMORY_DEFAULT_AGENTS[index])) {
    activeMemoryConfig.agents = [...ACTIVE_MEMORY_DEFAULT_AGENTS];
    changed = true;
  }

  return changed;
}

function initializeLosslessClawDefaults(
  entries: ConfigRecord,
  slots: ConfigRecord,
  losslessInstallState: LosslessClawInstallState,
): boolean {
  if (losslessInstallState.kind !== 'ready') {
    return false;
  }

  const losslessEntry = ensureRecord(entries, 'lossless-claw');
  let changed = normalizeLosslessClawManagedConfig(losslessEntry);

  const losslessExplicitlyDisabled = losslessEntry.enabled === false || slots.contextEngine === 'legacy';
  if (losslessExplicitlyDisabled) {
    return changed;
  }

  if (losslessEntry.enabled !== true) {
    losslessEntry.enabled = true;
    changed = true;
  }

  if (slots.contextEngine !== 'lossless-claw') {
    slots.contextEngine = 'lossless-claw';
    changed = true;
  }

  return changed;
}

export async function readMemorySettingsSnapshot(config: OpenClawConfigDocument): Promise<MemorySettingsSnapshot> {
  const plugins = asRecord(config.plugins);
  const slots = asRecord(plugins?.slots);
  const entries = asRecord(plugins?.entries);
  const memoryCoreEntry = asRecord(entries?.['memory-core']);
  const memoryCoreConfig = asRecord(memoryCoreEntry?.config);
  const dreaming = asRecord(memoryCoreConfig?.dreaming);
  const activeMemoryEntry = asRecord(entries?.['active-memory']);
  const activeMemoryConfig = asRecord(activeMemoryEntry?.config);
  const losslessEntry = asRecord(entries?.['lossless-claw']);
  const losslessConfig = asRecord(losslessEntry?.config);
  const losslessInstallState = await readLosslessClawInstallState();
  const availableModels = await listAvailableProviderModelGroups();

  const dreamingEnabled = dreaming?.enabled === true;
  const activeMemoryEnabled = activeMemoryConfig?.enabled === true;
  const activeMemoryAgents = Array.isArray(activeMemoryConfig?.agents)
    ? activeMemoryConfig.agents.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const activeMemoryModel = readString(activeMemoryConfig?.model);
  const losslessSummaryModel = readString(losslessConfig?.summaryModel);

  let losslessStatus: MemoryCardStatus;
  let losslessEnabled = false;
  if (losslessInstallState.kind === 'missing') {
    losslessStatus = 'not-installed';
  } else if (losslessInstallState.kind === 'version-mismatch') {
    losslessStatus = 'unavailable';
  } else if (slots?.contextEngine === 'lossless-claw') {
    losslessStatus = 'enabled';
    losslessEnabled = true;
  } else {
    losslessStatus = 'disabled';
  }

  return {
    availableModels,
    dreaming: {
      enabled: dreamingEnabled,
      status: dreamingEnabled ? 'enabled' : 'disabled',
    },
    activeMemory: {
      enabled: activeMemoryEnabled,
      agents: activeMemoryAgents,
      model: activeMemoryModel,
      modelMode: activeMemoryModel ? 'custom' : 'automatic',
      status: activeMemoryEnabled ? 'enabled' : 'disabled',
    },
    losslessClaw: {
      enabled: losslessEnabled,
      installedVersion: losslessInstallState.installedVersion,
      requiredVersion: LOSSLESS_CLAW_REQUIRED_VERSION,
      summaryModel: losslessSummaryModel,
      summaryModelMode: losslessSummaryModel ? 'custom' : 'automatic',
      status: losslessStatus,
    },
  };
}

export async function applyMemorySettingsPatch(
  config: OpenClawConfigDocument,
  patch: MemorySettingsPatch,
): Promise<boolean> {
  let changed = false;

  if (patch.dreaming && patch.dreaming.enabled !== undefined) {
    const plugins = ensureRecord(config, 'plugins');
    const entries = ensureRecord(plugins, 'entries');
    const memoryCoreEntry = ensureRecord(entries, 'memory-core');
    const memoryCoreConfig = ensureRecord(memoryCoreEntry, 'config');
    const dreaming = ensureRecord(memoryCoreConfig, 'dreaming');

    if (dreaming.enabled !== patch.dreaming.enabled) {
      dreaming.enabled = patch.dreaming.enabled;
      changed = true;
    }
  }

  if (patch.activeMemory) {
    const plugins = ensureRecord(config, 'plugins');
    const entries = ensureRecord(plugins, 'entries');
    const activeMemoryEntry = ensureRecord(entries, 'active-memory');
    const activeMemoryConfig = ensureRecord(activeMemoryEntry, 'config');

    changed = deleteKeyIfPresent(activeMemoryConfig, 'modelFallbackPolicy') || changed;

    if (patch.activeMemory.enabled !== undefined) {
      if (activeMemoryEntry.enabled !== true) {
        activeMemoryEntry.enabled = true;
        changed = true;
      }

      if (activeMemoryConfig.enabled !== patch.activeMemory.enabled) {
        activeMemoryConfig.enabled = patch.activeMemory.enabled;
        changed = true;
      }

      if (patch.activeMemory.enabled) {
        const currentAgents = Array.isArray(activeMemoryConfig.agents)
          ? activeMemoryConfig.agents.filter((entry): entry is string => typeof entry === 'string')
          : [];
        if (currentAgents.length !== ACTIVE_MEMORY_DEFAULT_AGENTS.length
          || currentAgents.some((entry, index) => entry !== ACTIVE_MEMORY_DEFAULT_AGENTS[index])) {
          activeMemoryConfig.agents = [...ACTIVE_MEMORY_DEFAULT_AGENTS];
          changed = true;
        }
      }
    }

    if ('model' in patch.activeMemory) {
      const model = readString(patch.activeMemory.model);
      if (model) {
        if (activeMemoryConfig.model !== model) {
          activeMemoryConfig.model = model;
          changed = true;
        }
      } else {
        changed = deleteKeyIfPresent(activeMemoryConfig, 'model') || changed;
      }
    }
  }

  if (patch.losslessClaw) {
    const losslessInstallState = await readLosslessClawInstallState();
    if (patch.losslessClaw.enabled === true && losslessInstallState.kind !== 'ready') {
      throw new Error('Lossless Content is not available');
    }

    const plugins = ensureRecord(config, 'plugins');
    const slots = ensureRecord(plugins, 'slots');
    const entries = ensureRecord(plugins, 'entries');
    const losslessEntry = ensureRecord(entries, 'lossless-claw');
    const losslessConfig = ensureRecord(losslessEntry, 'config');

    if (patch.losslessClaw.enabled !== undefined) {
      if (patch.losslessClaw.enabled) {
        if (losslessEntry.enabled !== true) {
          losslessEntry.enabled = true;
          changed = true;
        }
        if (slots.contextEngine !== 'lossless-claw') {
          slots.contextEngine = 'lossless-claw';
          changed = true;
        }
      } else if (slots.contextEngine !== 'legacy') {
        slots.contextEngine = 'legacy';
        changed = true;
      }
    }

    if ('summaryModel' in patch.losslessClaw) {
      const summaryModel = readString(patch.losslessClaw.summaryModel);
      if (summaryModel) {
        if (losslessConfig.summaryModel !== summaryModel) {
          losslessConfig.summaryModel = summaryModel;
          changed = true;
        }
      } else {
        changed = deleteKeyIfPresent(losslessConfig, 'summaryModel') || changed;
      }
    }
  }

  return changed;
}

export async function syncLosslessClawInstallStateToOpenClaw(): Promise<boolean> {
  const losslessInstallState = await readLosslessClawInstallState();
  if (losslessInstallState.kind === 'ready') {
    return false;
  }

  return await mutateOpenClawConfigDocument<boolean>((config) => {
    const changed = disableLosslessClawConfig(config);
    return {
      changed,
      result: changed,
    };
  });
}

export async function initializeMemoryDefaultsOnStartup(): Promise<boolean> {
  const losslessInstallState = await readLosslessClawInstallState();

  return await mutateOpenClawConfigDocument<boolean>((config) => {
    const plugins = ensureRecord(config, 'plugins');
    const entries = ensureRecord(plugins, 'entries');
    const slots = ensureRecord(plugins, 'slots');
    let changed = false;

    changed = initializeDreamingDefaults(entries) || changed;
    changed = initializeActiveMemoryDefaults(entries) || changed;
    changed = initializeLosslessClawDefaults(entries, slots, losslessInstallState) || changed;

    return {
      changed,
      result: changed,
    };
  });
}
