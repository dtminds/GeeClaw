import { access } from 'fs/promises';
import { constants } from 'fs';
import { LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS, LEGACY_BUILTIN_PLUGIN_ID_SET } from './legacy-built-in-plugins';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';
import { getManagedAgentWorkspacePath } from './managed-agent-workspace';
import { OPENCLAW_PROVIDER_KEY_MOONSHOT } from './provider-keys';

const MANAGED_AGENT_HEARTBEAT_EVERY = '2h';
const MANAGED_AGENT_MAX_CONCURRENT = 3;

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

        const externalPluginIds = allow.filter(
          (pluginId) => (
            pluginId !== LEGACY_QWEN_PLUGIN_ID
            && !LEGACY_BUILTIN_PLUGIN_ID_SET.has(pluginId)
          ),
        );
        const nextAllow = [...externalPluginIds];

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
    if (commands.restart !== false) {
      commands.restart = false;
      config.commands = commands;
      changed = true;
      console.log('[sanitize] Forcing commands.restart to false');
    }

    const channelsObj = config.channels as Record<string, Record<string, unknown>> | undefined;
    if (channelsObj && typeof channelsObj === 'object') {
      for (const [channelType, section] of Object.entries(channelsObj)) {
        if (!section || typeof section !== 'object') continue;
        const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
        const defaultAccount = accounts?.default;
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

    if (providers[OPENCLAW_PROVIDER_KEY_MOONSHOT]) {
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
