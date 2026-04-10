/**
 * Tests for openclaw.json config sanitization before Gateway start.
 *
 * The sanitizeOpenClawConfig() function in openclaw-config-sanitize.ts relies on
 * Electron-specific helpers (readOpenClawJson / writeOpenClawJson) that
 * read from ~/.openclaw/openclaw.json.  To avoid mocking Electron + the
 * real HOME directory, this test uses a standalone version of the
 * sanitization logic that mirrors the production code exactly, operating
 * on a temp directory with real file I/O.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { access, mkdir, mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let configPath: string;

async function writeConfig(data: unknown): Promise<void> {
  await writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
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
      changed = true;
      continue;
    }

    validPaths.push(pluginEntry);
  }

  return { changed, paths: validPaths };
}

/**
 * Standalone mirror of the sanitization logic in openclaw-config-sanitize.ts.
 * Uses the same blocklist approach as the production code.
 */
async function sanitizeConfig(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return false;
  }

  const config = JSON.parse(raw) as Record<string, unknown>;
  let modified = false;
  const LEGACY_BUILTIN_PLUGIN_IDS: Record<string, string[]> = {
    qqbot: ['openclaw-qqbot'],
  };
  const CHANNELS_EXCLUDING_TOP_LEVEL_MIRROR = new Set(['dingtalk']);

  // Mirror of the production blocklist logic
  const skills = config.skills;
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    const skillsObj = skills as Record<string, unknown>;
    const KNOWN_INVALID_SKILLS_ROOT_KEYS = ['enabled', 'disabled'];
    for (const key of KNOWN_INVALID_SKILLS_ROOT_KEYS) {
      if (key in skillsObj) {
        delete skillsObj[key];
        modified = true;
      }
    }
  }

  const plugins = config.plugins;
  if (plugins) {
    if (Array.isArray(plugins)) {
      const result = await sanitizePluginPathList(plugins);
      if (result.changed) {
        config.plugins = result.paths;
        modified = true;
      }
    } else if (typeof plugins === 'object') {
      const pluginsObj = plugins as Record<string, unknown>;
      if (Array.isArray(pluginsObj.load)) {
        const result = await sanitizePluginPathList(pluginsObj.load);
        if (result.changed) {
          pluginsObj.load = result.paths;
          modified = true;
        }
      } else if (pluginsObj.load && typeof pluginsObj.load === 'object' && !Array.isArray(pluginsObj.load)) {
        const loadObj = pluginsObj.load as Record<string, unknown>;
        if (Array.isArray(loadObj.paths)) {
          const result = await sanitizePluginPathList(loadObj.paths);
          if (result.changed) {
            loadObj.paths = result.paths;
            modified = true;
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

      for (const legacyPluginIds of Object.values(LEGACY_BUILTIN_PLUGIN_IDS)) {
        for (const pluginId of legacyPluginIds) {
          if (!(pluginId in entries)) continue;
          delete entries[pluginId];
          modified = true;
        }
      }

      const externalPluginIds = allow.filter((pluginId) => pluginId !== 'openclaw-qqbot');
      const nextAllow = [...externalPluginIds];

      if (JSON.stringify(nextAllow) !== JSON.stringify(allow)) {
        if (nextAllow.length > 0) {
          pluginsObj.allow = nextAllow;
        } else {
          delete pluginsObj.allow;
        }
        modified = true;
      }

      if (Array.isArray(pluginsObj.allow) && pluginsObj.allow.length === 0) {
        delete pluginsObj.allow;
        modified = true;
      }

      if (pluginsObj.entries && Object.keys(entries).length === 0) {
        delete pluginsObj.entries;
        modified = true;
      } else if (Object.keys(entries).length > 0) {
        pluginsObj.entries = entries;
      }

      const pluginKeysExcludingEnabled = Object.keys(pluginsObj).filter((key) => key !== 'enabled');
      if (pluginsObj.enabled === true && pluginKeysExcludingEnabled.length === 0) {
        delete pluginsObj.enabled;
        modified = true;
      }

      if (Object.keys(pluginsObj).length === 0) {
        delete config.plugins;
        modified = true;
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
    modified = true;
  }

  const channelsObj = config.channels as Record<string, Record<string, unknown>> | undefined;
  if (channelsObj && typeof channelsObj === 'object') {
    for (const [channelType, section] of Object.entries(channelsObj)) {
      if (!section || typeof section !== 'object') continue;

      if (CHANNELS_EXCLUDING_TOP_LEVEL_MIRROR.has(channelType)) {
        if ('accounts' in section) {
          delete section.accounts;
          modified = true;
        }
        if ('defaultAccount' in section) {
          delete section.defaultAccount;
          modified = true;
        }
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
        modified = true;
      }
    }
  }

  // Mirror: remove stale tools.web.search.kimi.apiKey when moonshot provider exists.
  const providers = ((config.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined) || {};
  if (providers.moonshot) {
    const tools = (config.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const kimi = (search.kimi as Record<string, unknown> | undefined) || {};
    if ('apiKey' in kimi) {
      delete kimi.apiKey;
      search.kimi = kimi;
      web.search = search;
      tools.web = web;
      config.tools = tools;
      modified = true;
    }
  }

  if (modified) {
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }
  return modified;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'geeclaw-test-'));
  configPath = join(tempDir, 'openclaw.json');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('sanitizeOpenClawConfig (blocklist approach)', () => {
  it('removes skills.enabled at the root level of skills', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        entries: {
          'my-skill': { enabled: true, apiKey: 'abc' },
        },
      },
      gateway: { mode: 'local' },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    // Root-level "enabled" should be gone
    expect(result.skills).not.toHaveProperty('enabled');
    // entries[key].enabled must be preserved
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['my-skill'].enabled).toBe(true);
    expect(entries['my-skill'].apiKey).toBe('abc');
    // Other top-level sections are untouched
    expect(result.gateway).toEqual({ mode: 'local' });
  });

  it('removes skills.disabled at the root level of skills', async () => {
    await writeConfig({
      skills: {
        disabled: false,
        entries: { 'x': { enabled: false } },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.skills).not.toHaveProperty('disabled');
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['x'].enabled).toBe(false);
  });

  it('removes both enabled and disabled when present together', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        disabled: false,
        entries: { 'a': { enabled: true } },
        allowBundled: ['web-search'],
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const skills = result.skills as Record<string, unknown>;
    expect(skills).not.toHaveProperty('enabled');
    expect(skills).not.toHaveProperty('disabled');
    // Valid keys are preserved
    expect(skills.allowBundled).toEqual(['web-search']);
    expect(skills.entries).toBeDefined();
  });

  it('does nothing when config is already valid', async () => {
    const original = {
      commands: {
        restart: false,
      },
      skills: {
        entries: { 'my-skill': { enabled: true } },
        allowBundled: ['web-search'],
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('preserves unknown valid keys (forward-compatible)', async () => {
    // If OpenClaw adds new valid keys to skills in the future,
    // the blocklist approach should NOT strip them.
    const original = {
      commands: {
        restart: false,
      },
      skills: {
        entries: { 'x': { enabled: true } },
        allowBundled: ['web-search'],
        load: { extraDirs: ['/my/dir'], watch: true },
        install: { preferBrew: false },
        limits: { maxSkillsInPrompt: 5 },
        futureNewKey: { some: 'value' },  // hypothetical future key
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('handles config with no skills section', async () => {
    const original = {
      commands: {
        restart: false,
      },
      gateway: { mode: 'local' },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('handles empty config', async () => {
    await writeConfig({});

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result).toEqual({
      commands: {
        restart: false,
      },
    });
  });

  it('returns false for missing config file', async () => {
    const modified = await sanitizeConfig(join(tempDir, 'nonexistent.json'));
    expect(modified).toBe(false);
  });

  it('handles skills being an array (no-op, no crash)', async () => {
    // Edge case: skills is not an object
    await writeConfig({
      commands: {
        restart: false,
      },
      skills: ['something'],
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('preserves all other top-level config sections', async () => {
    await writeConfig({
      skills: { enabled: true, entries: {} },
      channels: { discord: { token: 'abc', enabled: true } },
      plugins: { entries: { customPlugin: { enabled: true } } },
      gateway: { mode: 'local', auth: { token: 'xyz' } },
      agents: { defaults: { model: { primary: 'gpt-4' } } },
      models: { providers: { openai: { baseUrl: 'https://api.openai.com' } } },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    // skills.enabled removed
    expect(result.skills).not.toHaveProperty('enabled');
    // All other sections unchanged
    expect(result.channels).toEqual({ discord: { token: 'abc', enabled: true } });
    expect(result.plugins).toEqual({ entries: { customPlugin: { enabled: true } } });
    expect(result.gateway).toEqual({ mode: 'local', auth: { token: 'xyz' } });
    expect(result.agents).toEqual({ defaults: { model: { primary: 'gpt-4' } } });
  });

  it('preserves canonical channel plugin ids while removing legacy qqbot plugin ids', async () => {
    await writeConfig({
      plugins: {
        enabled: true,
        allow: ['whatsapp', 'qqbot', 'openclaw-qqbot', 'customPlugin'],
        entries: {
          whatsapp: { enabled: true },
          'openclaw-qqbot': { enabled: true },
          customPlugin: { enabled: true },
        },
      },
      channels: {
        discord: { enabled: true, token: 'abc' },
        qqbot: { enabled: true, appId: 'abc' },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.channels).toEqual({
      discord: { enabled: true, token: 'abc' },
      qqbot: { enabled: true, appId: 'abc' },
    });
    expect(result.plugins).toEqual({
      enabled: true,
      allow: ['whatsapp', 'qqbot', 'customPlugin'],
      entries: {
        whatsapp: { enabled: true },
        customPlugin: { enabled: true },
      },
    });
  });

  it('removes tools.web.search.kimi.apiKey when moonshot provider exists', async () => {
    await writeConfig({
      models: {
        providers: {
          moonshot: { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'stale-inline-key',
              baseUrl: 'https://api.moonshot.cn/v1',
            },
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const kimi = ((((result.tools as Record<string, unknown>).web as Record<string, unknown>).search as Record<string, unknown>).kimi as Record<string, unknown>);
    expect(kimi).not.toHaveProperty('apiKey');
    expect(kimi.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('keeps tools.web.search.kimi.apiKey when moonshot provider is absent', async () => {
    const original = {
      commands: {
        restart: false,
      },
      models: {
        providers: {
          openrouter: { baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'should-stay',
            },
          },
        },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('removes stale plugin load paths from plugins.load.paths while preserving existing ones', async () => {
    const existingPluginDir = join(tempDir, 'plugins', 'wecom-openclaw-plugin');
    await mkdir(existingPluginDir, { recursive: true });
    const stalePluginDir = join(tempDir, 'plugins', 'missing-plugin');
    const legacyBundledPath = '/tmp/node_modules/openclaw/extensions/legacy-plugin';

    await writeConfig({
      plugins: {
        load: {
          paths: [
            existingPluginDir,
            stalePluginDir,
            legacyBundledPath,
            'relative-plugin-path',
          ],
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.plugins).toEqual({
      load: {
        paths: [
          existingPluginDir,
          'relative-plugin-path',
        ],
      },
    });
  });

  it('mirrors the configured default account credentials to the channel top level', async () => {
    await writeConfig({
      channels: {
        telegram: {
          enabled: true,
          defaultAccount: 'helper',
          accounts: {
            helper: {
              botToken: 'telegram-token',
              enabled: true,
            },
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.channels).toEqual({
      telegram: {
        enabled: true,
        defaultAccount: 'helper',
        accounts: {
          helper: {
            botToken: 'telegram-token',
            enabled: true,
          },
        },
        botToken: 'telegram-token',
      },
    });
  });

  it('strips dingtalk multi-account metadata while preserving flat credentials', async () => {
    await writeConfig({
      channels: {
        dingtalk: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: {
              clientId: 'nested-client-id',
              clientSecret: 'nested-client-secret',
              enabled: true,
            },
          },
          clientId: 'dt-client-id',
          clientSecret: 'dt-client-secret',
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.channels).toEqual({
      dingtalk: {
        enabled: true,
        clientId: 'dt-client-id',
        clientSecret: 'dt-client-secret',
      },
    });
  });
});

describe('sanitizeOpenClawConfig (managed agent defaults guard)', () => {
  const MANAGED_WORKSPACE = '/managed/home/geeclaw/workspace';
  const MANAGED_HEARTBEAT_EVERY = '2h';
  const MANAGED_MAX_CONCURRENT = 3;

  /**
   * Standalone mirror of the managed agent defaults guard logic added to sanitizeOpenClawConfig.
   * Operates on a real temp file, matching the existing test helper pattern.
   */
  async function sanitizeWorkspace(filePath: string, managedWorkspaceDir: string): Promise<boolean> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return false;
    }

    const config = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

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
    const heartbeat = (
      defaultsForWorkspace.heartbeat &&
      typeof defaultsForWorkspace.heartbeat === 'object' &&
      !Array.isArray(defaultsForWorkspace.heartbeat)
        ? { ...(defaultsForWorkspace.heartbeat as Record<string, unknown>) }
        : {}
    );
    let agentDefaultsModified = false;

    if (defaultsForWorkspace.workspace !== managedWorkspaceDir) {
      defaultsForWorkspace.workspace = managedWorkspaceDir;
      agentDefaultsModified = true;
    }

    if (heartbeat.every !== MANAGED_HEARTBEAT_EVERY) {
      heartbeat.every = MANAGED_HEARTBEAT_EVERY;
      defaultsForWorkspace.heartbeat = heartbeat;
      agentDefaultsModified = true;
    }

    if (defaultsForWorkspace.maxConcurrent !== MANAGED_MAX_CONCURRENT) {
      defaultsForWorkspace.maxConcurrent = MANAGED_MAX_CONCURRENT;
      agentDefaultsModified = true;
    }

    if (agentDefaultsModified) {
      agentsForWorkspace.defaults = defaultsForWorkspace;
      config.agents = agentsForWorkspace;
      modified = true;
    }

    if (modified) {
      await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
    }
    return modified;
  }

  it('restores wrong managed agent defaults while preserving other settings', async () => {
    await writeConfig({
      agents: {
        defaults: {
          workspace: '/wrong/path/workspace',
          heartbeat: {
            every: '30m',
            jitter: '5m',
          },
          maxConcurrent: 1,
          model: { primary: 'openai/gpt-4' },
        },
      },
    });

    const modified = await sanitizeWorkspace(configPath, MANAGED_WORKSPACE);
    expect(modified).toBe(true);

    const result = await readConfig();
    const defaults = ((result.agents as Record<string, unknown>).defaults as Record<string, unknown>);
    expect(defaults.workspace).toBe(MANAGED_WORKSPACE);
    expect(defaults.maxConcurrent).toBe(MANAGED_MAX_CONCURRENT);
    expect(defaults.heartbeat).toEqual({
      every: MANAGED_HEARTBEAT_EVERY,
      jitter: '5m',
    });
    expect(defaults.model).toEqual({ primary: 'openai/gpt-4' });
  });

  it('creates missing managed agent defaults when keys are absent', async () => {
    await writeConfig({
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-4' },
        },
      },
    });

    const modified = await sanitizeWorkspace(configPath, MANAGED_WORKSPACE);
    expect(modified).toBe(true);

    const result = await readConfig();
    const defaults = ((result.agents as Record<string, unknown>).defaults as Record<string, unknown>);
    expect(defaults.workspace).toBe(MANAGED_WORKSPACE);
    expect(defaults.maxConcurrent).toBe(MANAGED_MAX_CONCURRENT);
    expect(defaults.heartbeat).toEqual({ every: MANAGED_HEARTBEAT_EVERY });
  });

  it('creates the full agents.defaults structure when agents section is absent', async () => {
    await writeConfig({ gateway: { mode: 'local' } });

    const modified = await sanitizeWorkspace(configPath, MANAGED_WORKSPACE);
    expect(modified).toBe(true);

    const result = await readConfig();
    const defaults = ((result.agents as Record<string, unknown>).defaults as Record<string, unknown>);
    expect(defaults.workspace).toBe(MANAGED_WORKSPACE);
    expect(defaults.maxConcurrent).toBe(MANAGED_MAX_CONCURRENT);
    expect(defaults.heartbeat).toEqual({ every: MANAGED_HEARTBEAT_EVERY });
    expect(result.gateway).toEqual({ mode: 'local' });
  });

  it('forces commands.restart to false', async () => {
    await writeConfig({
      commands: {
        restart: true,
        retained: 'value',
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.commands).toEqual({
      restart: false,
      retained: 'value',
    });
  });

  it('does nothing when managed agent defaults are already correct', async () => {
    await writeConfig({
      agents: {
        defaults: {
          workspace: MANAGED_WORKSPACE,
          heartbeat: {
            every: MANAGED_HEARTBEAT_EVERY,
            jitter: '5m',
          },
          maxConcurrent: MANAGED_MAX_CONCURRENT,
          model: { primary: 'openai/gpt-4' },
        },
      },
    });

    const modified = await sanitizeWorkspace(configPath, MANAGED_WORKSPACE);
    expect(modified).toBe(false);

    const result = await readConfig();
    const defaults = ((result.agents as Record<string, unknown>).defaults as Record<string, unknown>);
    expect(defaults.workspace).toBe(MANAGED_WORKSPACE);
    expect(defaults.maxConcurrent).toBe(MANAGED_MAX_CONCURRENT);
    expect(defaults.heartbeat).toEqual({
      every: MANAGED_HEARTBEAT_EVERY,
      jitter: '5m',
    });
  });
});
