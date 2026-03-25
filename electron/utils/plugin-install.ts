import { app } from 'electron';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';

interface BundledPluginSpec {
  pluginId: string;
  npmName: string;
  displayName: string;
}

export interface BundledPluginSourceResult {
  installed: boolean;
  warning?: string;
  sourceDir?: string;
}

const ALL_BUNDLED_PLUGINS: BundledPluginSpec[] = [
  { pluginId: 'dingtalk', npmName: '@soimy/dingtalk', displayName: '钉钉' },
  { pluginId: 'wecom-openclaw-plugin', npmName: '@wecom/wecom-openclaw-plugin', displayName: '企业微信' },
  { pluginId: 'openclaw-weixin', npmName: '@tencent-weixin/openclaw-weixin', displayName: '微信' },
  { pluginId: 'qqbot', npmName: '@sliverp/qqbot', displayName: 'QQ Bot' },
  { pluginId: 'openclaw-lark', npmName: '@larksuite/openclaw-lark', displayName: '飞书' },
  { pluginId: 'lossless-claw', npmName: '@martian-engineering/lossless-claw', displayName: 'Lossless Claw' },
  { pluginId: 'qmemory', npmName: 'qmemory', displayName: 'QMemory' },
  { pluginId: 'cron-delivery-guard', npmName: 'cron-delivery-guard', displayName: 'Cron 投递降级守卫' },
];

export const ALWAYS_ENABLED_BUNDLED_PLUGIN_IDS = ['lossless-claw', 'qmemory', 'cron-delivery-guard'] as const;

const ALWAYS_ENABLED_BUNDLED_PLUGIN_POLICIES: Record<string, {
  allowedConfigKeys?: string[];
  config?: Record<string, unknown>;
  slots?: Record<string, string>;
}> = {
  'lossless-claw': {
    allowedConfigKeys: [
      'contextThreshold',
      'incrementalMaxDepth',
      'freshTailCount',
      'leafMinFanout',
      'condensedMinFanout',
      'condensedMinFanoutHard',
      'dbPath',
      'ignoreSessionPatterns',
      'statelessSessionPatterns',
      'skipStatelessSessions',
      'largeFileThresholdTokens',
      'summaryModel',
      'summaryProvider',
      'expansionModel',
      'expansionProvider',
    ],
    config: {
      ignoreSessionPatterns: [
        'agent:*:cron:**',
        'agent:*:subagent:**',
      ],
      statelessSessionPatterns: [
        'agent:*:subagent:**',
        'agent:ops:subagent:**',
      ],
      skipStatelessSessions: true,
    },
    slots: {
      contextEngine: 'lossless-claw',
    },
  },
};

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }

  return result;
}

function maybeRealpath(candidatePath: string): string {
  try {
    return realpathSync(candidatePath);
  } catch {
    return candidatePath;
  }
}

const MANAGED_BUNDLED_PLUGIN_ROOT_PATTERNS = [
  '/openclaw-plugins',
  '/build/openclaw-plugins',
  '/plugins/openclaw',
] as const;

function hasPluginManifest(candidatePath: string): boolean {
  return existsSync(join(candidatePath, 'openclaw.plugin.json'));
}

function getCandidateBundledPluginMirrorSources(
  pluginId: string,
  appPath: string,
  currentWorkingDirectory: string,
): string[] {
  if (app.isPackaged) {
    return [
      join(process.resourcesPath, 'openclaw-plugins', pluginId),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginId),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginId),
    ];
  }

  return [
    join(appPath, 'build', 'openclaw-plugins', pluginId),
    join(currentWorkingDirectory, 'build', 'openclaw-plugins', pluginId),
    join(__dirname, '../../build/openclaw-plugins', pluginId),
    join(appPath, 'plugins', 'openclaw', pluginId),
    join(currentWorkingDirectory, 'plugins', 'openclaw', pluginId),
    join(__dirname, '../../plugins/openclaw', pluginId),
  ];
}

function getCandidateNodeModulesRoots(appPath: string, currentWorkingDirectory: string): string[] {
  return [
    join(appPath, 'node_modules'),
    join(currentWorkingDirectory, 'node_modules'),
    join(__dirname, '../../node_modules'),
  ];
}

function getCandidateNodeModulesPluginSources(
  npmName: string,
  appPath: string,
  currentWorkingDirectory: string,
): string[] {
  if (app.isPackaged) {
    return [];
  }

  return getCandidateNodeModulesRoots(appPath, currentWorkingDirectory).map((nodeModulesRoot) => (
    maybeRealpath(join(nodeModulesRoot, ...npmName.split('/')))
  ));
}

function resolveBundledPluginSource(
  plugin: BundledPluginSpec,
  options?: {
    appPath?: string;
    cwd?: string;
  },
): BundledPluginSourceResult {
  const appPath = options?.appPath ?? app.getAppPath();
  const currentWorkingDirectory = options?.cwd ?? process.cwd();
  const candidates = dedupePaths([
    ...getCandidateBundledPluginMirrorSources(plugin.pluginId, appPath, currentWorkingDirectory),
    ...getCandidateNodeModulesPluginSources(plugin.npmName, appPath, currentWorkingDirectory),
  ]);

  const sourceDir = candidates.find(hasPluginManifest);
  if (sourceDir) {
    return { installed: true, sourceDir };
  }

  return {
    installed: false,
    warning: `Bundled ${plugin.displayName} plugin source not found. Checked: ${candidates.join(' | ')}`,
  };
}

function isManagedBundledPluginPath(pathEntry: string): boolean {
  const normalized = pathEntry.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  if (MANAGED_BUNDLED_PLUGIN_ROOT_PATTERNS.some((pattern) => normalized.endsWith(pattern))) {
    return true;
  }

  return ALL_BUNDLED_PLUGINS.some((plugin) => {
    if (!normalized.endsWith(`/${plugin.pluginId}`)) {
      return false;
    }

    return (
      MANAGED_BUNDLED_PLUGIN_ROOT_PATTERNS.some((pattern) => normalized.includes(`${pattern}/`)) ||
      normalized.includes('/node_modules/') ||
      normalized.includes('/extensions/')
    );
  });
}

function getCurrentLoadPaths(plugins: Record<string, unknown>): string[] {
  if (Array.isArray(plugins.load)) {
    return plugins.load.filter((entry): entry is string => typeof entry === 'string');
  }

  if (plugins.load && typeof plugins.load === 'object' && !Array.isArray(plugins.load)) {
    const loadObject = plugins.load as Record<string, unknown>;
    if (Array.isArray(loadObject.paths)) {
      return loadObject.paths.filter((entry): entry is string => typeof entry === 'string');
    }
  }

  return [];
}

function getManagedBundledPluginInstallPaths(): string[] {
  const extensionsDir = join(getOpenClawConfigDir(), 'extensions');
  return ALL_BUNDLED_PLUGINS.map((plugin) => join(extensionsDir, plugin.pluginId));
}

function getCompactBundledPluginRoots(
  resolvedSources: Array<{ pluginId: string; sourceDir: string }>,
): string[] | null {
  if (resolvedSources.length === 0) {
    return [];
  }

  const parentDirs = dedupePaths(resolvedSources.map(({ sourceDir }) => dirname(sourceDir)));
  if (parentDirs.length !== 1) {
    return null;
  }

  const [parentDir] = parentDirs;
  const canUseParentDir = resolvedSources.every(({ pluginId, sourceDir }) => {
    if (basename(sourceDir) !== pluginId) {
      return false;
    }
    return hasPluginManifest(join(parentDir, pluginId));
  });

  return canUseParentDir ? [parentDir] : null;
}

export function reconcileBundledPluginLoadPaths(
  config: Record<string, unknown>,
  options?: {
    appPath?: string;
    cwd?: string;
  },
): { changed: boolean; warnings: string[] } {
  let changed = false;
  const warnings: string[] = [];

  const resolvedSources = ALL_BUNDLED_PLUGINS.map((plugin) => {
    const result = resolveBundledPluginSource(plugin, options);
    if (!result.installed && result.warning) {
      warnings.push(result.warning);
    }
    return result.sourceDir ? { pluginId: plugin.pluginId, sourceDir: result.sourceDir } : null;
  }).filter((entry): entry is { pluginId: string; sourceDir: string } => entry !== null);

  const compactBundledRoots = getCompactBundledPluginRoots(resolvedSources);
  const desiredLoadPaths = dedupePaths(
    compactBundledRoots ?? resolvedSources.map(({ sourceDir }) => sourceDir),
  );
  const managedInstallPaths = new Set(getManagedBundledPluginInstallPaths());

  const plugins = (
    config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)
      ? config.plugins as Record<string, unknown>
      : {}
  );

  const existingLoadPaths = getCurrentLoadPaths(plugins);
  const preservedLoadPaths = existingLoadPaths.filter((entry) => (
    !managedInstallPaths.has(entry) && !isManagedBundledPluginPath(entry)
  ));
  const nextLoadPaths = dedupePaths([...preservedLoadPaths, ...desiredLoadPaths]);

  if (!config.plugins || config.plugins !== plugins) {
    config.plugins = plugins;
    changed = true;
  }

  const nextLoadObject = (
    plugins.load && typeof plugins.load === 'object' && !Array.isArray(plugins.load)
      ? { ...(plugins.load as Record<string, unknown>) }
      : {}
  );
  nextLoadObject.paths = nextLoadPaths;

  if (JSON.stringify(existingLoadPaths) !== JSON.stringify(nextLoadPaths) || !plugins.load || Array.isArray(plugins.load)) {
    plugins.load = nextLoadObject;
    changed = true;
  }

  if (plugins.installs && typeof plugins.installs === 'object' && !Array.isArray(plugins.installs)) {
    const nextInstalls = { ...(plugins.installs as Record<string, unknown>) };
    let installsChanged = false;

    for (const plugin of ALL_BUNDLED_PLUGINS) {
      if (plugin.pluginId in nextInstalls) {
        delete nextInstalls[plugin.pluginId];
        installsChanged = true;
      }
    }

    if (installsChanged) {
      if (Object.keys(nextInstalls).length === 0) {
        delete plugins.installs;
      } else {
        plugins.installs = nextInstalls;
      }
      changed = true;
    }
  }

  return { changed, warnings };
}

export async function syncBundledPluginLoadPathsToOpenClaw(): Promise<void> {
  const warnings = await mutateOpenClawConfigDocument<string[]>((document) => {
    const { changed, warnings: nextWarnings } = reconcileBundledPluginLoadPaths(document);
    return { changed, result: nextWarnings };
  });

  for (const warning of warnings) {
    logger.warn(`[plugin] ${warning}`);
  }
}

export function getAlwaysEnabledBundledPluginIds(): string[] {
  return [...ALWAYS_ENABLED_BUNDLED_PLUGIN_IDS];
}

function getManagedBundledPluginPolicy(pluginId: string): {
  allowedConfigKeys?: string[];
  config?: Record<string, unknown>;
  slots?: Record<string, string>;
} | undefined {
  const policy = ALWAYS_ENABLED_BUNDLED_PLUGIN_POLICIES[pluginId];
  if (!policy) {
    return undefined;
  }

  if (pluginId !== 'lossless-claw') {
    return policy;
  }

  return {
    ...policy,
    config: {
      ...(policy.config ?? {}),
      dbPath: join(getOpenClawConfigDir(), 'lcm.db'),
    },
  };
}

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export async function ensureAlwaysEnabledBundledPluginsConfigured(): Promise<{
  success: boolean;
  updated: string[];
  error?: string;
}> {
  try {
    const policyPluginIds = getAlwaysEnabledBundledPluginIds();
    if (policyPluginIds.length === 0) {
      return { success: true, updated: [] };
    }

    const updated = await mutateOpenClawConfigDocument<string[]>((config) => {
      const plugins = (
        config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)
          ? config.plugins as Record<string, unknown>
          : {}
      );
      const allow = Array.isArray(plugins.allow)
        ? plugins.allow.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const entries = (
        plugins.entries && typeof plugins.entries === 'object' && !Array.isArray(plugins.entries)
          ? { ...(plugins.entries as Record<string, unknown>) }
          : {}
      );
      const slots = (
        plugins.slots && typeof plugins.slots === 'object' && !Array.isArray(plugins.slots)
          ? { ...(plugins.slots as Record<string, unknown>) }
          : {}
      );

      const nextUpdated: string[] = [];
      const nextAllow = [...allow];
      const nextSlots = { ...slots };
      for (const pluginId of policyPluginIds) {
        const policy = getManagedBundledPluginPolicy(pluginId);
        const entry = (
          entries[pluginId] && typeof entries[pluginId] === 'object' && !Array.isArray(entries[pluginId])
            ? { ...(entries[pluginId] as Record<string, unknown>) }
            : {}
        );
        let entryChanged = false;

        if (entry.enabled !== true) {
          entry.enabled = true;
          entryChanged = true;
        }

        if ('db' in entry) {
          delete entry.db;
          entryChanged = true;
        }

        if ('databasePath' in entry) {
          delete entry.databasePath;
          entryChanged = true;
        }

        if (policy?.config) {
          const currentConfig = (
            entry.config && typeof entry.config === 'object' && !Array.isArray(entry.config)
              ? { ...(entry.config as Record<string, unknown>) }
              : {}
          );
          const nextConfig = { ...currentConfig };

          if (policy.allowedConfigKeys) {
            for (const configKey of Object.keys(nextConfig)) {
              if (!policy.allowedConfigKeys.includes(configKey)) {
                delete nextConfig[configKey];
                entryChanged = true;
              }
            }
          }

          for (const [configKey, configValue] of Object.entries(policy.config)) {
            if (Array.isArray(configValue)) {
              const currentValue = Array.isArray(nextConfig[configKey]) ? nextConfig[configKey] as unknown[] : [];
              if (!arraysEqual(currentValue, configValue)) {
                nextConfig[configKey] = [...configValue];
                entryChanged = true;
              }
              continue;
            }

            if (nextConfig[configKey] !== configValue) {
              nextConfig[configKey] = configValue;
              entryChanged = true;
            }
          }

          entry.config = nextConfig;
        }

        if (entryChanged) {
          entries[pluginId] = entry;
          nextUpdated.push(pluginId);
        }

        if (!nextAllow.includes(pluginId)) {
          nextAllow.push(pluginId);
          if (!nextUpdated.includes(pluginId)) {
            nextUpdated.push(pluginId);
          }
        }

        if (policy?.slots) {
          for (const [slotKey, slotValue] of Object.entries(policy.slots)) {
            if (nextSlots[slotKey] !== slotValue) {
              nextSlots[slotKey] = slotValue;
              if (!nextUpdated.includes(pluginId)) {
                nextUpdated.push(pluginId);
              }
            }
          }
        }
      }

      if (nextUpdated.length > 0) {
        plugins.allow = nextAllow;
        plugins.entries = entries;
        plugins.slots = nextSlots;
        config.plugins = plugins;
      }

      return {
        changed: nextUpdated.length > 0,
        result: nextUpdated,
      };
    });

    return { success: true, updated };
  } catch (err) {
    console.error('Failed to enforce always-enabled bundled plugins:', err);
    return { success: false, updated: [], error: String(err) };
  }
}

export function ensureDingTalkPluginInstalled(): BundledPluginSourceResult {
  return resolveBundledPluginSource(ALL_BUNDLED_PLUGINS[0]);
}

export function ensureWeComPluginInstalled(): BundledPluginSourceResult {
  return resolveBundledPluginSource(ALL_BUNDLED_PLUGINS[1]);
}

export function ensureWeixinPluginInstalled(): BundledPluginSourceResult {
  return resolveBundledPluginSource(ALL_BUNDLED_PLUGINS[2]);
}

export function ensureQQBotPluginInstalled(): BundledPluginSourceResult {
  return resolveBundledPluginSource(ALL_BUNDLED_PLUGINS[3]);
}

export function ensureFeishuPluginInstalled(): BundledPluginSourceResult {
  return resolveBundledPluginSource(ALL_BUNDLED_PLUGINS[4]);
}
