import { access, readdir, readFile } from 'fs/promises';
import { constants } from 'fs';
import { dirname, join } from 'path';
import { LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS, LEGACY_BUILTIN_PLUGIN_ID_SET } from './legacy-built-in-plugins';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';
import { getManagedAgentWorkspacePath } from './managed-agent-workspace';
import { getOpenClawConfigDir, getOpenClawResolvedDir } from './paths';
import {
  OPENCLAW_PROVIDER_KEY_MOONSHOT,
  OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL,
} from './provider-keys';

const MANAGED_AGENT_HEARTBEAT_EVERY = '2h';
const MANAGED_AGENT_MAX_CONCURRENT = 3;
const CHANNELS_EXCLUDING_TOP_LEVEL_MIRROR = new Set(['dingtalk']);
const CHANNELS_SKIPPING_DEFAULT_ACCOUNT_MIRROR = new Set(['wecom']);
const BUNDLED_ALLOWLIST_PRESERVE_IDS = new Set([
  'lossless-claw',
  'geeclaw-plugin',
  'browser',
  'acpx',
  'memory-core',
]);
const OPTIONAL_PROVIDER_LIKE_BUNDLED_PLUGIN_IDS = new Set([
  'alibaba',
  'deepgram',
  'elevenlabs',
  'groq',
  'microsoft',
  'phone-control',
  'runway',
  'talk-voice',
  'voyage',
]);
const AUTH_PROFILE_PROVIDER_KEY_MAP: Record<string, string> = {
  'openai-codex': 'openai',
  'google-gemini-cli': 'google',
};
const DEPRECATED_PROVIDER_IDS = new Set(['qwen-portal']);

interface BundledPluginManifest {
  id: string;
  enabledByDefault: boolean;
  providers: string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isLegacyBundledPluginPath(pluginEntry: string): boolean {
  return pluginEntry.includes('node_modules/openclaw/extensions');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function sanitizePluginPathList(pathEntries: unknown[]): Promise<{ changed: boolean; paths: string[] }> {
  const validPaths: string[] = [];
  let changed = false;

  for (const pluginEntry of pathEntries) {
    if (typeof pluginEntry !== 'string') {
      changed = true;
      continue;
    }

    if (!pluginEntry.startsWith('/')) {
      validPaths.push(pluginEntry);
      continue;
    }

    if (isLegacyBundledPluginPath(pluginEntry) || !(await fileExists(pluginEntry))) {
      console.log(`[sanitize] Removing stale/bundled plugin path "${pluginEntry}" from openclaw.json`);
      changed = true;
      continue;
    }

    validPaths.push(pluginEntry);
  }

  return { changed, paths: validPaths };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeAuthProfileProviderKey(provider: string): string {
  return AUTH_PROFILE_PROVIDER_KEY_MAP[provider] ?? provider;
}

function getOpenClawExtensionRoots(): string[] {
  const openclawDir = getOpenClawResolvedDir();
  return [
    join(openclawDir, 'dist', 'extensions'),
    join(openclawDir, 'extensions'),
  ];
}

async function discoverBundledPluginManifests(): Promise<BundledPluginManifest[]> {
  const manifests = new Map<string, BundledPluginManifest>();

  for (const root of getOpenClawExtensionRoots()) {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    const manifestResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => readJsonFile<{
          id?: unknown;
          enabledByDefault?: unknown;
          providers?: unknown;
        }>(join(root, entry.name, 'openclaw.plugin.json'))),
    );

    for (const parsed of manifestResults) {
      if (typeof parsed?.id !== 'string' || !parsed.id.trim()) continue;

      const existing = manifests.get(parsed.id) ?? {
        id: parsed.id,
        enabledByDefault: false,
        providers: [],
      };
      const providers = Array.isArray(parsed.providers)
        ? parsed.providers.filter((provider): provider is string => typeof provider === 'string' && provider.trim().length > 0)
        : [];

      existing.enabledByDefault = existing.enabledByDefault || parsed.enabledByDefault === true;
      existing.providers = Array.from(new Set([...existing.providers, ...providers]));
      manifests.set(parsed.id, existing);
    }
  }

  return [...manifests.values()];
}

async function discoverBundledPlugins(): Promise<{
  all: Set<string>;
  enabledByDefault: string[];
  manifestsById: Map<string, BundledPluginManifest>;
}> {
  const all = new Set<string>();
  const enabledByDefault: string[] = [];
  const manifestsById = new Map<string, BundledPluginManifest>();

  for (const manifest of await discoverBundledPluginManifests()) {
    all.add(manifest.id);
    manifestsById.set(manifest.id, manifest);
    if (manifest.enabledByDefault) {
      enabledByDefault.push(manifest.id);
    }
  }

  return { all, enabledByDefault, manifestsById };
}

function addProvidersFromProfileEntries(
  profiles: Record<string, unknown> | undefined,
  target: Set<string>,
): void {
  if (!profiles) return;

  for (const profile of Object.values(profiles)) {
    const provider = isPlainRecord(profile) && typeof profile.provider === 'string'
      ? profile.provider
      : undefined;
    if (!provider) continue;

    target.add(provider);
    target.add(normalizeAuthProfileProviderKey(provider));
  }
}

function collectAgentIdsFromConfig(config: Record<string, unknown>): string[] {
  const ids = new Set<string>(['main']);
  const agents = isPlainRecord(config.agents) ? config.agents : {};
  const agentList = Array.isArray(agents.list) ? agents.list : [];

  for (const agent of agentList) {
    if (!isPlainRecord(agent) || typeof agent.id !== 'string') continue;
    const id = agent.id.trim();
    if (id) ids.add(id);
  }

  return [...ids];
}

async function getProvidersFromAuthProfileStores(config: Record<string, unknown>): Promise<Set<string>> {
  const providers = new Set<string>();

  for (const agentId of collectAgentIdsFromConfig(config)) {
    const store = await readJsonFile<{ profiles?: Record<string, unknown> }>(
      join(getOpenClawConfigDir(), 'agents', agentId, 'agent', 'auth-profiles.json'),
    );
    addProvidersFromProfileEntries(store?.profiles, providers);
  }

  return providers;
}

async function collectActiveProviderIdsFromConfig(config: Record<string, unknown>): Promise<Set<string>> {
  const activeProviders = new Set<string>();
  const providers = isPlainRecord(config.models) && isPlainRecord(config.models.providers)
    ? config.models.providers
    : undefined;
  if (providers) {
    for (const key of Object.keys(providers)) {
      activeProviders.add(key);
      activeProviders.add(normalizeAuthProfileProviderKey(key));
    }
  }

  const plugins = isPlainRecord(config.plugins) && isPlainRecord(config.plugins.entries)
    ? config.plugins.entries
    : undefined;
  if (plugins) {
    for (const [pluginId, meta] of Object.entries(plugins)) {
      if (pluginId.endsWith('-auth') && isPlainRecord(meta) && meta.enabled === true) {
        activeProviders.add(pluginId.replace(/-auth$/, ''));
      }
    }
  }

  const agents = isPlainRecord(config.agents) ? config.agents : undefined;
  const defaults = agents && isPlainRecord(agents.defaults) ? agents.defaults : undefined;
  const modelConfig = defaults && isPlainRecord(defaults.model) ? defaults.model : undefined;
  const primaryModel = typeof modelConfig?.primary === 'string' ? modelConfig.primary : undefined;
  if (primaryModel?.includes('/')) {
    const provider = primaryModel.split('/')[0];
    activeProviders.add(provider);
    activeProviders.add(normalizeAuthProfileProviderKey(provider));
  }

  const auth = isPlainRecord(config.auth) ? config.auth : undefined;
  addProvidersFromProfileEntries(
    auth && isPlainRecord(auth.profiles) ? auth.profiles : undefined,
    activeProviders,
  );

  const authProfileProviders = await getProvidersFromAuthProfileStores(config);
  for (const provider of authProfileProviders) {
    activeProviders.add(provider);
  }

  for (const deprecated of DEPRECATED_PROVIDER_IDS) {
    activeProviders.delete(deprecated);
  }

  return activeProviders;
}

async function discoverInstalledExtensionPluginIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let entries: Awaited<ReturnType<typeof readdir>>;

  try {
    entries = await readdir(join(getOpenClawConfigDir(), 'extensions'), { withFileTypes: true });
  } catch {
    return ids;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const manifest = await readJsonFile<{ id?: unknown }>(
      join(getOpenClawConfigDir(), 'extensions', entry.name, 'openclaw.plugin.json'),
    );
    if (typeof manifest?.id === 'string' && manifest.id.trim()) {
      ids.add(manifest.id.trim());
    }
  }

  return ids;
}

function collectPluginLoadPathsFromConfig(plugins: unknown): string[] {
  const paths: string[] = [];
  const pushPath = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) {
      paths.push(value);
    }
  };

  if (Array.isArray(plugins)) {
    for (const value of plugins) pushPath(value);
    return paths;
  }

  if (!isPlainRecord(plugins)) return paths;

  if (Array.isArray(plugins.load)) {
    for (const value of plugins.load) pushPath(value);
  } else if (isPlainRecord(plugins.load) && Array.isArray(plugins.load.paths)) {
    for (const value of plugins.load.paths) pushPath(value);
  }

  return paths;
}

async function readPluginManifestIdFromPath(pluginPath: string): Promise<string | null> {
  const candidates = [
    join(pluginPath, 'openclaw.plugin.json'),
    join(dirname(pluginPath), 'openclaw.plugin.json'),
  ];

  for (const manifestPath of candidates) {
    const manifest = await readJsonFile<{ id?: unknown }>(manifestPath);
    if (typeof manifest?.id === 'string' && manifest.id.trim()) {
      return manifest.id.trim();
    }
  }

  return null;
}

async function discoverLoadedPluginIdsFromConfig(config: Record<string, unknown>): Promise<Set<string>> {
  const ids = new Set<string>();

  for (const pluginPath of collectPluginLoadPathsFromConfig(config.plugins)) {
    const pluginId = await readPluginManifestIdFromPath(pluginPath);
    if (pluginId) {
      ids.add(pluginId);
    }
  }

  return ids;
}

export async function sanitizeOpenClawConfig(): Promise<void> {
  const modified = await mutateOpenClawConfigDocument<boolean>(async (config) => {
    let changed = false;
    const LEGACY_QWEN_PROVIDER = 'qwen-portal';
    const LEGACY_QWEN_PLUGIN_ID = 'qwen-portal-auth';

    const managedWorkspaceDir = getManagedAgentWorkspacePath('main');
    const agentsForDefaults = (
      config.agents && typeof config.agents === 'object'
        ? (config.agents as Record<string, unknown>)
        : {}
    );
    const defaults = (
      agentsForDefaults.defaults && typeof agentsForDefaults.defaults === 'object'
        ? { ...(agentsForDefaults.defaults as Record<string, unknown>) }
        : {}
    );
    const heartbeat = (
      defaults.heartbeat && typeof defaults.heartbeat === 'object' && !Array.isArray(defaults.heartbeat)
        ? { ...(defaults.heartbeat as Record<string, unknown>) }
        : {}
    );
    let agentDefaultsChanged = false;

    if (defaults.workspace !== managedWorkspaceDir) {
      console.log(
        `[sanitize] Restoring agents.defaults.workspace: "${String(defaults.workspace)}" -> "${managedWorkspaceDir}"`,
      );
      defaults.workspace = managedWorkspaceDir;
      agentDefaultsChanged = true;
    }

    if (heartbeat.every !== MANAGED_AGENT_HEARTBEAT_EVERY) {
      console.log(
        `[sanitize] Restoring agents.defaults.heartbeat.every: "${String(heartbeat.every)}" -> "${MANAGED_AGENT_HEARTBEAT_EVERY}"`,
      );
      heartbeat.every = MANAGED_AGENT_HEARTBEAT_EVERY;
      defaults.heartbeat = heartbeat;
      agentDefaultsChanged = true;
    }

    if (defaults.maxConcurrent !== MANAGED_AGENT_MAX_CONCURRENT) {
      console.log(
        `[sanitize] Restoring agents.defaults.maxConcurrent: "${String(defaults.maxConcurrent)}" -> "${MANAGED_AGENT_MAX_CONCURRENT}"`,
      );
      defaults.maxConcurrent = MANAGED_AGENT_MAX_CONCURRENT;
      agentDefaultsChanged = true;
    }

    if (agentDefaultsChanged) {
      agentsForDefaults.defaults = defaults;
      config.agents = agentsForDefaults;
      changed = true;
    }

    const skills = config.skills;
    if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
      const skillsObj = skills as Record<string, unknown>;
      const knownInvalidSkillsRootKeys = ['enabled', 'disabled'];
      for (const key of knownInvalidSkillsRootKeys) {
        if (key in skillsObj) {
          console.log(`[sanitize] Removing misplaced key "skills.${key}" from openclaw.json`);
          delete skillsObj[key];
          changed = true;
        }
      }
    }

    const plugins = config.plugins;
    if (plugins) {
      if (Array.isArray(plugins)) {
        const { changed: pluginsChanged, paths: validPlugins } = await sanitizePluginPathList(plugins);
        if (pluginsChanged) {
          config.plugins = validPlugins;
          changed = true;
        }
      } else if (typeof plugins === 'object') {
        const pluginsObj = plugins as Record<string, unknown>;
        if (Array.isArray(pluginsObj.load)) {
          const { changed: loadChanged, paths: validLoad } = await sanitizePluginPathList(pluginsObj.load);
          if (loadChanged) {
            pluginsObj.load = validLoad;
            changed = true;
          }
        } else if (pluginsObj.load && typeof pluginsObj.load === 'object' && !Array.isArray(pluginsObj.load)) {
          const loadObj = pluginsObj.load as Record<string, unknown>;
          if (Array.isArray(loadObj.paths)) {
            const { changed: loadChanged, paths: validLoad } = await sanitizePluginPathList(loadObj.paths);
            if (loadChanged) {
              loadObj.paths = validLoad;
              changed = true;
            }
          }
        }

        const allow = Array.isArray(pluginsObj.allow)
          ? pluginsObj.allow.filter((entry): entry is string => typeof entry === 'string')
          : [];
        const entries = (
          pluginsObj.entries && typeof pluginsObj.entries === 'object' && !Array.isArray(pluginsObj.entries)
            ? { ...(pluginsObj.entries as Record<string, unknown>) }
            : {}
        ) as Record<string, unknown>;

        for (const [channelId, legacyPluginIds] of Object.entries(LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS)) {
          for (const pluginId of legacyPluginIds) {
            if (!(pluginId in entries)) continue;
            delete entries[pluginId];
            changed = true;
            console.log(`[sanitize] Removed legacy plugins.entries.${pluginId} for built-in channel ${channelId}`);
          }
        }

        if (LEGACY_QWEN_PLUGIN_ID in entries) {
          delete entries[LEGACY_QWEN_PLUGIN_ID];
          changed = true;
          console.log(`[sanitize] Removed deprecated plugins.entries.${LEGACY_QWEN_PLUGIN_ID}`);
        }

        const bundled = await discoverBundledPlugins();
        const installedExtensionIds = await discoverInstalledExtensionPluginIds();
        const loadedPluginIds = await discoverLoadedPluginIdsFromConfig(config);
        const activeProviderIds = await collectActiveProviderIdsFromConfig(config);

        const explicitlyEnabledBundledPluginIds = Object.keys(entries)
          .filter((pluginId) => {
            if (!bundled.all.has(pluginId)) return false;
            const entry = isPlainRecord(entries[pluginId]) ? entries[pluginId] : {};
            return entry.enabled === true;
          });
        const activeBundledProviderPluginIds = [...bundled.all].filter((pluginId) => {
          const manifest = bundled.manifestsById.get(pluginId);
          const providerIds = manifest?.providers ?? [];
          const isProviderPlugin = providerIds.length > 0
            || OPTIONAL_PROVIDER_LIKE_BUNDLED_PLUGIN_IDS.has(pluginId);
          if (!isProviderPlugin) return false;

          return activeProviderIds.has(pluginId)
            || providerIds.some((providerId) => activeProviderIds.has(providerId));
        });
        const requiredBundledPluginIds = new Set([
          ...BUNDLED_ALLOWLIST_PRESERVE_IDS,
          ...activeBundledProviderPluginIds,
          ...explicitlyEnabledBundledPluginIds,
        ].filter((pluginId) => bundled.all.has(pluginId)));

        const externalPluginIds: string[] = [];
        for (const pluginId of allow) {
          if (
            pluginId === LEGACY_QWEN_PLUGIN_ID
            || LEGACY_BUILTIN_PLUGIN_ID_SET.has(pluginId)
            || bundled.all.has(pluginId)
          ) {
            continue;
          }

          const isConfiguredExternal = Boolean(entries[pluginId]);
          const isInstalledExternal = installedExtensionIds.has(pluginId);
          const isLoadedExternal = loadedPluginIds.has(pluginId);
          if (!isConfiguredExternal && !isInstalledExternal && !isLoadedExternal) {
            console.log(`[sanitize] Removed missing external plugin from plugins.allow: ${pluginId}`);
            changed = true;
            continue;
          }
          externalPluginIds.push(pluginId);
        }

        const retainedBundledPluginIds = allow.filter((pluginId) => requiredBundledPluginIds.has(pluginId));
        const nextAllowSet = new Set([...externalPluginIds, ...retainedBundledPluginIds]);
        if (nextAllowSet.size > 0) {
          for (const pluginId of requiredBundledPluginIds) {
            if (!nextAllowSet.has(pluginId)) {
              nextAllowSet.add(pluginId);
              changed = true;
              console.log(`[sanitize] Preserved required bundled plugin "${pluginId}" in plugins.allow`);
            }
          }
        }
        const nextAllow = [...nextAllowSet];

        if (JSON.stringify(nextAllow) !== JSON.stringify(allow)) {
          if (nextAllow.length > 0) {
            pluginsObj.allow = nextAllow;
          } else {
            delete pluginsObj.allow;
          }
          changed = true;
        }

        if (Array.isArray(pluginsObj.allow) && pluginsObj.allow.length === 0) {
          delete pluginsObj.allow;
          changed = true;
        }

        if (pluginsObj.entries && Object.keys(entries).length === 0) {
          delete pluginsObj.entries;
          changed = true;
        } else if (Object.keys(entries).length > 0) {
          pluginsObj.entries = entries;
        }

        const pluginKeysExcludingEnabled = Object.keys(pluginsObj).filter((key) => key !== 'enabled');
        if (pluginsObj.enabled === true && pluginKeysExcludingEnabled.length === 0) {
          delete pluginsObj.enabled;
          changed = true;
        }

        if (Object.keys(pluginsObj).length === 0) {
          delete config.plugins;
          changed = true;
        }
      }
    }

    const commands = (
      config.commands && typeof config.commands === 'object'
        ? { ...(config.commands as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (commands.restart !== true) {
      commands.restart = true;
      config.commands = commands;
      changed = true;
      console.log('[sanitize] Forcing commands.restart to true');
    }

    const channelsObj = config.channels as Record<string, Record<string, unknown>> | undefined;
    if (channelsObj && typeof channelsObj === 'object') {
      for (const [channelType, section] of Object.entries(channelsObj)) {
        if (!section || typeof section !== 'object') continue;
        if (CHANNELS_EXCLUDING_TOP_LEVEL_MIRROR.has(channelType)) {
          if ('accounts' in section) {
            delete section.accounts;
            changed = true;
            console.log(`[sanitize] Removed incompatible 'accounts' from channels.${channelType}`);
          }
          if ('defaultAccount' in section) {
            delete section.defaultAccount;
            changed = true;
            console.log(`[sanitize] Removed incompatible 'defaultAccount' from channels.${channelType}`);
          }
          continue;
        }

        if (CHANNELS_SKIPPING_DEFAULT_ACCOUNT_MIRROR.has(channelType)) {
          continue;
        }

        const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
        const defaultAccountId =
          typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
            ? section.defaultAccount
            : 'default';
        const defaultAccount = accounts?.[defaultAccountId] ?? accounts?.default;
        if (!defaultAccount || typeof defaultAccount !== 'object') continue;

        let mirrored = false;
        for (const [key, value] of Object.entries(defaultAccount)) {
          if (!(key in section)) {
            section[key] = value;
            mirrored = true;
          }
        }
        if (mirrored) {
          changed = true;
          console.log(`[sanitize] Mirrored ${channelType} default account credentials to top-level channels.${channelType}`);
        }
      }
    }

    const providers = ((config.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined) || {};
    if (providers[LEGACY_QWEN_PROVIDER]) {
      delete providers[LEGACY_QWEN_PROVIDER];
      changed = true;
      console.log(`[sanitize] Removed deprecated models.providers.${LEGACY_QWEN_PROVIDER}`);
    }

    const auth = (
      config.auth && typeof config.auth === 'object' && !Array.isArray(config.auth)
        ? (config.auth as Record<string, unknown>)
        : undefined
    );
    const authProfiles = (
      auth?.profiles && typeof auth.profiles === 'object' && !Array.isArray(auth.profiles)
        ? (auth.profiles as Record<string, unknown>)
        : undefined
    );
    if (authProfiles?.[LEGACY_QWEN_PROVIDER]) {
      delete authProfiles[LEGACY_QWEN_PROVIDER];
      changed = true;
      console.log(`[sanitize] Removed deprecated auth.profiles.${LEGACY_QWEN_PROVIDER}`);
    }

    if (providers[OPENCLAW_PROVIDER_KEY_MOONSHOT] || providers[OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL]) {
      const tools = (config.tools as Record<string, unknown> | undefined) || {};
      const web = (tools.web as Record<string, unknown> | undefined) || {};
      const search = (web.search as Record<string, unknown> | undefined) || {};
      const kimi = (search.kimi as Record<string, unknown> | undefined) || {};
      if ('apiKey' in kimi) {
        console.log('[sanitize] Removing stale key "tools.web.search.kimi.apiKey" from openclaw.json');
        delete kimi.apiKey;
        search.kimi = kimi;
        web.search = search;
        tools.web = web;
        config.tools = tools;
        changed = true;
      }
    }

    return { changed, result: changed };
  });

  if (modified) {
    console.log('[sanitize] openclaw.json sanitized successfully');
  }
}
