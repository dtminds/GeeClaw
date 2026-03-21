import { access } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';
import { getOpenClawConfigDir } from './paths';
import { OPENCLAW_PROVIDER_KEY_MOONSHOT } from './provider-keys';

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

    const managedWorkspaceDir = join(getOpenClawConfigDir(), 'workspace');
    const agentsForWorkspace = (
      config.agents && typeof config.agents === 'object'
        ? (config.agents as Record<string, unknown>)
        : {}
    );
    const defaultsForWorkspace = (
      agentsForWorkspace.defaults && typeof agentsForWorkspace.defaults === 'object'
        ? { ...(agentsForWorkspace.defaults as Record<string, unknown>) }
        : {}
    );
    if (defaultsForWorkspace.workspace !== managedWorkspaceDir) {
      console.log(
        `[sanitize] Restoring agents.defaults.workspace: "${String(defaultsForWorkspace.workspace)}" -> "${managedWorkspaceDir}"`,
      );
      defaultsForWorkspace.workspace = managedWorkspaceDir;
      agentsForWorkspace.defaults = defaultsForWorkspace;
      config.agents = agentsForWorkspace;
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
      console.log('[sanitize] Enabling commands.restart for graceful reload support');
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
