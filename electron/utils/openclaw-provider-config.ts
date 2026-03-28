import { access, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import {
  getProviderEnvVar,
  getProviderDefaultModel,
  getProviderConfig,
} from './provider-registry';
import { getOpenClawConfigDir } from './paths';
import {
  mutateOpenClawConfigDocument,
  readOpenClawConfigDocument,
} from './openclaw-config-coordinator';
import {
  OPENCLAW_PROVIDER_KEY_MOONSHOT,
  isOpenClawOAuthPluginProviderKey,
} from './provider-keys';
import {
  discoverOpenClawAgentIds,
  removeProviderProfilesFromOpenClaw,
} from './openclaw-auth';

function getOAuthPluginId(provider: string): string {
  return `${provider}-auth`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!(await fileExists(filePath))) return null;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return await readOpenClawConfigDocument();
}

export function buildProviderEnvVars(providers: Array<{ type: string; apiKey: string }>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { type, apiKey } of providers) {
    const envVar = getProviderEnvVar(type);
    if (envVar && apiKey) {
      env[envVar] = apiKey;
    }
  }
  return env;
}

export async function removeProviderFromOpenClaw(provider: string): Promise<void> {
  const agentIds = await discoverOpenClawAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  await removeProviderProfilesFromOpenClaw(provider);

  for (const id of agentIds) {
    const modelsPath = join(getOpenClawConfigDir(), 'agents', id, 'agent', 'models.json');
    try {
      if (await fileExists(modelsPath)) {
        const raw = await readFile(modelsPath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const providers = data.providers as Record<string, unknown> | undefined;
        if (providers && providers[provider]) {
          delete providers[provider];
          await writeFile(modelsPath, JSON.stringify(data, null, 2), 'utf-8');
          console.log(`Removed models.json entry for provider "${provider}" (agent "${id}")`);
        }
      }
    } catch (err) {
      console.warn(`Failed to remove provider ${provider} from models.json (agent "${id}"):`, err);
    }
  }

  try {
    await mutateOpenClawConfigDocument<void>((config) => {
      let modified = false;

      const plugins = config.plugins as Record<string, unknown> | undefined;
      const entries = (plugins?.entries ?? {}) as Record<string, Record<string, unknown>>;
      const pluginName = `${provider}-auth`;
      if (entries[pluginName]) {
        entries[pluginName].enabled = false;
        modified = true;
        console.log(`Disabled OpenClaw plugin: ${pluginName}`);
      }

      const models = config.models as Record<string, unknown> | undefined;
      const providers = (models?.providers ?? {}) as Record<string, unknown>;
      if (providers[provider]) {
        delete providers[provider];
        modified = true;
        console.log(`Removed OpenClaw provider config: ${provider}`);
      }

      const auth = (
        config.auth && typeof config.auth === 'object' && !Array.isArray(config.auth)
          ? (config.auth as Record<string, unknown>)
          : null
      );
      const authProfiles = (
        auth?.profiles && typeof auth.profiles === 'object' && !Array.isArray(auth.profiles)
          ? (auth.profiles as Record<string, { provider?: unknown }>)
          : null
      );
      if (authProfiles) {
        for (const [profileId, profile] of Object.entries(authProfiles)) {
          if (profile?.provider !== provider) {
            continue;
          }
          delete authProfiles[profileId];
          modified = true;
          console.log(`Removed OpenClaw auth profile: ${profileId}`);
        }
      }

      return { changed: modified, result: undefined };
    });
  } catch (err) {
    console.warn(`Failed to remove provider ${provider} from openclaw.json:`, err);
  }
}

export async function setOpenClawDefaultModel(
  provider: string,
  modelOverride?: string,
  fallbackModels: string[] = []
): Promise<void> {
  const model = normalizeModelRef(provider, modelOverride);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = extractModelId(provider, model);
  const fallbackModelIds = extractFallbackModelIds(provider, fallbackModels);

  await mutateOpenClawConfigDocument<void>((config) => {
    ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

    const agents = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    defaults.model = {
      primary: model,
      fallbacks: fallbackModels,
    };
    agents.defaults = defaults;
    config.agents = agents;

    const providerCfg = getProviderConfig(provider);
    if (providerCfg) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: providerCfg.baseUrl,
        api: providerCfg.api,
        apiKeyEnv: providerCfg.apiKeyEnv,
        headers: providerCfg.headers,
        modelIds: [modelId, ...fallbackModelIds],
        includeRegistryModels: true,
        mergeExistingModels: true,
      });
      console.log(`Configured models.providers.${provider} with baseUrl=${providerCfg.baseUrl}, model=${modelId}`);
    } else {
      const models = (config.models || {}) as Record<string, unknown>;
      const providers = (models.providers || {}) as Record<string, unknown>;
      if (providers[provider]) {
        delete providers[provider];
        console.log(`Removed stale models.providers.${provider} (built-in provider)`);
        models.providers = providers;
        config.models = models;
      }
    }

    const gateway = (config.gateway || {}) as Record<string, unknown>;
    if (!gateway.mode) gateway.mode = 'local';
    config.gateway = gateway;

    return { changed: true, result: undefined };
  });
  console.log(`Set OpenClaw default model to "${model}" for provider "${provider}"`);
}

export interface RuntimeProviderConfigOverride {
  baseUrl?: string;
  api?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
}

type ProviderEntryBuildOptions = {
  baseUrl: string;
  api: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  modelIds?: string[];
  includeRegistryModels?: boolean;
  mergeExistingModels?: boolean;
};

function normalizeModelRef(provider: string, modelOverride?: string): string | undefined {
  const rawModel = modelOverride || getProviderDefaultModel(provider);
  if (!rawModel) return undefined;
  return rawModel.startsWith(`${provider}/`) ? rawModel : `${provider}/${rawModel}`;
}

function extractModelId(provider: string, modelRef: string): string {
  return modelRef.startsWith(`${provider}/`) ? modelRef.slice(provider.length + 1) : modelRef;
}

function extractFallbackModelIds(provider: string, fallbackModels: string[]): string[] {
  return fallbackModels
    .filter((fallback) => fallback.startsWith(`${provider}/`))
    .map((fallback) => fallback.slice(provider.length + 1));
}

function mergeProviderModels(
  ...groups: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const item of group) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

function withDefaultModelFlags(model: Record<string, unknown>): Record<string, unknown> {
  if (typeof model.reasoning === 'boolean') {
    return model;
  }

  return {
    ...model,
    reasoning: false,
  };
}

function upsertOpenClawProviderEntry(
  config: Record<string, unknown>,
  provider: string,
  options: ProviderEntryBuildOptions,
): void {
  const models = (config.models || {}) as Record<string, unknown>;
  const providers = (models.providers || {}) as Record<string, unknown>;
  const removedLegacyMoonshot = removeLegacyMoonshotProviderEntry(provider, providers);
  const existingProvider = (
    providers[provider] && typeof providers[provider] === 'object'
      ? (providers[provider] as Record<string, unknown>)
      : {}
  );

  const existingModels = options.mergeExistingModels && Array.isArray(existingProvider.models)
    ? (existingProvider.models as Array<Record<string, unknown>>)
    : [];
  const registryModels = options.includeRegistryModels
    ? ((getProviderConfig(provider)?.models ?? []).map((m) => withDefaultModelFlags({ ...m })) as Array<Record<string, unknown>>)
    : [];
  const runtimeModels = (options.modelIds ?? []).map((id) => withDefaultModelFlags({ id, name: id }));

  const nextProvider: Record<string, unknown> = {
    ...existingProvider,
    baseUrl: options.baseUrl,
    api: options.api,
    models: mergeProviderModels(registryModels, existingModels, runtimeModels),
  };
  if (options.apiKeyEnv) nextProvider.apiKey = options.apiKeyEnv;
  if (options.headers && Object.keys(options.headers).length > 0) {
    nextProvider.headers = options.headers;
  } else {
    delete nextProvider.headers;
  }
  if (options.authHeader !== undefined) {
    nextProvider.authHeader = options.authHeader;
  } else {
    delete nextProvider.authHeader;
  }

  providers[provider] = nextProvider;
  models.providers = providers;
  config.models = models;

  if (removedLegacyMoonshot) {
    console.log('Removed legacy models.providers.moonshot alias entry');
  }
}

function removeLegacyMoonshotProviderEntry(
  _provider: string,
  _providers: Record<string, unknown>
): boolean {
  return false;
}

function ensureMoonshotKimiWebSearchCnBaseUrl(config: Record<string, unknown>, provider: string): void {
  if (provider !== OPENCLAW_PROVIDER_KEY_MOONSHOT) return;

  const tools = (config.tools || {}) as Record<string, unknown>;
  const web = (tools.web || {}) as Record<string, unknown>;
  const search = (web.search || {}) as Record<string, unknown>;
  const kimi = (search.kimi && typeof search.kimi === 'object' && !Array.isArray(search.kimi))
    ? (search.kimi as Record<string, unknown>)
    : {};

  delete kimi.apiKey;
  kimi.baseUrl = 'https://api.moonshot.cn/v1';
  search.kimi = kimi;
  web.search = search;
  tools.web = web;
  config.tools = tools;
}

export async function syncProviderConfigToOpenClaw(
  provider: string,
  modelIds: string[] = [],
  override: RuntimeProviderConfigOverride
): Promise<void> {
  await mutateOpenClawConfigDocument<void>((config) => {
    ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

    if (override.baseUrl && override.api) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: override.baseUrl,
        api: override.api,
        apiKeyEnv: override.apiKeyEnv,
        headers: override.headers,
        modelIds,
        includeRegistryModels: true,
      });
    }

    if (isOpenClawOAuthPluginProviderKey(provider)) {
      const plugins = (config.plugins || {}) as Record<string, unknown>;
      const allow = Array.isArray(plugins.allow) ? [...plugins.allow as string[]] : [];
      const pEntries = (plugins.entries || {}) as Record<string, unknown>;
      const pluginId = getOAuthPluginId(provider);
      if (!allow.includes(pluginId)) {
        allow.push(pluginId);
      }
      pEntries[pluginId] = { enabled: true };
      plugins.allow = allow;
      plugins.entries = pEntries;
      config.plugins = plugins;
    }

    return { changed: true, result: undefined };
  });
}

export async function setOpenClawDefaultModelWithOverride(
  provider: string,
  modelOverride: string | undefined,
  override: RuntimeProviderConfigOverride,
  fallbackModels: string[] = []
): Promise<void> {
  const model = normalizeModelRef(provider, modelOverride);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = extractModelId(provider, model);
  const fallbackModelIds = extractFallbackModelIds(provider, fallbackModels);

  await mutateOpenClawConfigDocument<void>((config) => {
    ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

    const agents = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    defaults.model = {
      primary: model,
      fallbacks: fallbackModels,
    };
    agents.defaults = defaults;
    config.agents = agents;

    if (override.baseUrl && override.api) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: override.baseUrl,
        api: override.api,
        apiKeyEnv: override.apiKeyEnv,
        headers: override.headers,
        authHeader: override.authHeader,
        modelIds: [modelId, ...fallbackModelIds],
      });
    }

    const gateway = (config.gateway || {}) as Record<string, unknown>;
    if (!gateway.mode) gateway.mode = 'local';
    config.gateway = gateway;

    if (isOpenClawOAuthPluginProviderKey(provider)) {
      const plugins = (config.plugins || {}) as Record<string, unknown>;
      const allow = Array.isArray(plugins.allow) ? [...plugins.allow as string[]] : [];
      const pEntries = (plugins.entries || {}) as Record<string, unknown>;
      const pluginId = getOAuthPluginId(provider);
      if (!allow.includes(pluginId)) {
        allow.push(pluginId);
      }
      pEntries[pluginId] = { enabled: true };
      plugins.allow = allow;
      plugins.entries = pEntries;
      config.plugins = plugins;
    }

    return { changed: true, result: undefined };
  });
  console.log(
    `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
  );
}

export async function getActiveOpenClawProviders(): Promise<Set<string>> {
  const activeProviders = new Set<string>();

  try {
    const config = await readOpenClawJson();

    const providers = (config.models as Record<string, unknown> | undefined)?.providers;
    if (providers && typeof providers === 'object') {
      for (const key of Object.keys(providers as Record<string, unknown>)) {
        activeProviders.add(key);
      }
    }

    const plugins = (config.plugins as Record<string, unknown> | undefined)?.entries;
    if (plugins && typeof plugins === 'object') {
      for (const [pluginId, meta] of Object.entries(plugins as Record<string, unknown>)) {
        if (pluginId.endsWith('-auth') && (meta as Record<string, unknown>).enabled) {
          activeProviders.add(pluginId.replace(/-auth$/, ''));
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json for active providers:', err);
  }

  return activeProviders;
}

export async function updateAgentModelProvider(
  providerType: string,
  entry: {
    baseUrl?: string;
    api?: string;
    models?: Array<{ id: string; name: string; reasoning?: boolean }>;
    apiKey?: string;
    authHeader?: boolean;
  }
): Promise<void> {
  const agentIds = await discoverOpenClawAgentIds();
  for (const agentId of agentIds) {
    const modelsPath = join(getOpenClawConfigDir(), 'agents', agentId, 'agent', 'models.json');
    let data: Record<string, unknown> = {};
    try {
      data = (await readJsonFile<Record<string, unknown>>(modelsPath)) ?? {};
    } catch {
      // corrupt / missing – start with an empty object
    }

    const providers = (
      data.providers && typeof data.providers === 'object' ? data.providers : {}
    ) as Record<string, Record<string, unknown>>;

    const existing: Record<string, unknown> =
      providers[providerType] && typeof providers[providerType] === 'object'
        ? { ...providers[providerType] }
        : {};

    const existingModels = Array.isArray(existing.models)
      ? (existing.models as Array<Record<string, unknown>>)
      : [];

    const mergedModels = (entry.models ?? []).map((m) => {
      const prev = existingModels.find((e) => e.id === m.id);
      return withDefaultModelFlags(prev ? { ...prev, id: m.id, name: m.name } : { ...m });
    });

    if (entry.baseUrl !== undefined) existing.baseUrl = entry.baseUrl;
    if (entry.api !== undefined) existing.api = entry.api;
    if (mergedModels.length > 0) existing.models = mergedModels;
    if (entry.apiKey !== undefined) existing.apiKey = entry.apiKey;
    if (entry.authHeader !== undefined) existing.authHeader = entry.authHeader;

    providers[providerType] = existing;
    data.providers = providers;

    try {
      await writeJsonFile(modelsPath, data);
      console.log(`Updated models.json for agent "${agentId}" provider "${providerType}"`);
    } catch (err) {
      console.warn(`Failed to update models.json for agent "${agentId}":`, err);
    }
  }
}

export { getProviderEnvVar } from './provider-registry';
