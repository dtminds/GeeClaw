import {
  getProviderEnvVar,
  getProviderDefaultModel,
  getProviderConfig,
} from './provider-registry';
import {
  mutateOpenClawConfigDocument,
  readOpenClawConfigDocument,
} from './openclaw-config-coordinator';
import {
  OPENCLAW_PROVIDER_KEY_MOONSHOT,
  OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL,
  isOpenClawOAuthPluginProviderKey,
} from './provider-keys';
import {
  removeProviderProfilesFromOpenClaw,
} from './openclaw-auth';
import type { ProviderConfiguredModel } from '../shared/providers/types';
import { normalizeProviderModelEntries } from '../shared/providers/config-models';

function getOAuthPluginBinding(provider: string): { activeId: string; legacyIds: string[] } {
  if (provider === 'minimax-portal') {
    return {
      activeId: 'minimax',
      legacyIds: ['minimax-portal-auth'],
    };
  }

  return {
    activeId: `${provider}-auth`,
    legacyIds: [],
  };
}

function ensureOAuthPluginEnabled(config: Record<string, unknown>, provider: string): void {
  const plugins = (config.plugins || {}) as Record<string, unknown>;
  const allow = Array.isArray(plugins.allow) ? [...plugins.allow as string[]] : [];
  const entries = (plugins.entries || {}) as Record<string, unknown>;
  const { activeId, legacyIds } = getOAuthPluginBinding(provider);

  const nextAllow = allow.filter((pluginId) => !legacyIds.includes(pluginId));
  if (!nextAllow.includes(activeId)) {
    nextAllow.push(activeId);
  }

  for (const legacyId of legacyIds) {
    delete entries[legacyId];
  }

  const existingEntry = (
    entries[activeId] && typeof entries[activeId] === 'object'
      ? (entries[activeId] as Record<string, unknown>)
      : {}
  );
  entries[activeId] = {
    ...existingEntry,
    enabled: true,
  };

  plugins.allow = nextAllow;
  plugins.entries = entries;
  config.plugins = plugins;
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
  await removeProviderProfilesFromOpenClaw(provider);

  try {
    await mutateOpenClawConfigDocument<void>((config) => {
      let modified = false;

      const plugins = config.plugins as Record<string, unknown> | undefined;
      const entries = (plugins?.entries ?? {}) as Record<string, Record<string, unknown>>;
      const { activeId, legacyIds } = getOAuthPluginBinding(provider);
      for (const pluginName of [activeId, ...legacyIds]) {
        if (!entries[pluginName]) {
          continue;
        }

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
    ensureMoonshotKimiWebSearchBaseUrl(config, provider);

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
  models?: ProviderConfiguredModel[];
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
  const mergedById = new Map<string, Record<string, unknown>>();
  const orderedIds: string[] = [];

  for (const group of groups) {
    for (const item of group) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!id) continue;
      if (!mergedById.has(id)) {
        orderedIds.push(id);
      }
      mergedById.set(id, {
        ...(mergedById.get(id) ?? {}),
        ...item,
      });
    }
  }

  return orderedIds
    .map((id) => mergedById.get(id))
    .filter((item): item is Record<string, unknown> => Boolean(item));
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

function normalizeRuntimeProviderModels(
  models?: Iterable<ProviderConfiguredModel | null | undefined>,
): Array<Record<string, unknown>> {
  return normalizeProviderModelEntries(models).map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : false,
    ...(model.input ? { input: model.input } : {}),
    ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
  }));
}

function formatProviderApiKeyReference(provider: string, apiKeyValue: string): string {
  const envVar = getProviderEnvVar(provider);
  if (envVar && apiKeyValue === envVar) {
    return `\${${envVar}}`;
  }

  return apiKeyValue;
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
  const runtimeModels = normalizeRuntimeProviderModels(options.models).map((model) => withDefaultModelFlags(model));

  const nextProvider: Record<string, unknown> = {
    ...existingProvider,
    baseUrl: options.baseUrl,
    api: options.api,
    models: mergeProviderModels(registryModels, existingModels, runtimeModels),
  };
  if (options.apiKeyEnv) nextProvider.apiKey = formatProviderApiKeyReference(provider, options.apiKeyEnv);
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

function getMoonshotKimiWebSearchBaseUrl(provider: string): string | undefined {
  if (
    provider !== OPENCLAW_PROVIDER_KEY_MOONSHOT
    && provider !== OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL
  ) {
    return undefined;
  }

  return getProviderConfig(provider)?.baseUrl;
}

function ensureMoonshotKimiWebSearchBaseUrl(config: Record<string, unknown>, provider: string): void {
  const baseUrl = getMoonshotKimiWebSearchBaseUrl(provider);
  if (!baseUrl) return;

  const plugins = (config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins))
    ? (config.plugins as Record<string, unknown>)
    : {};
  const entries = (plugins.entries && typeof plugins.entries === 'object' && !Array.isArray(plugins.entries))
    ? (plugins.entries as Record<string, unknown>)
    : {};
  const moonshotPluginEntry = (
    entries.moonshot && typeof entries.moonshot === 'object' && !Array.isArray(entries.moonshot)
      ? (entries.moonshot as Record<string, unknown>)
      : {}
  );
  const moonshotPluginConfig = (
    moonshotPluginEntry.config && typeof moonshotPluginEntry.config === 'object' && !Array.isArray(moonshotPluginEntry.config)
      ? (moonshotPluginEntry.config as Record<string, unknown>)
      : {}
  );
  const webSearch = (
    moonshotPluginConfig.webSearch && typeof moonshotPluginConfig.webSearch === 'object' && !Array.isArray(moonshotPluginConfig.webSearch)
      ? (moonshotPluginConfig.webSearch as Record<string, unknown>)
      : {}
  );

  webSearch.baseUrl = baseUrl;
  moonshotPluginConfig.webSearch = webSearch;
  moonshotPluginEntry.config = moonshotPluginConfig;
  entries.moonshot = moonshotPluginEntry;
  plugins.entries = entries;
  config.plugins = plugins;
}

export async function syncProviderConfigToOpenClaw(
  provider: string,
  models: ProviderConfiguredModel[] = [],
  override: RuntimeProviderConfigOverride
): Promise<void> {
  await mutateOpenClawConfigDocument<void>((config) => {
    ensureMoonshotKimiWebSearchBaseUrl(config, provider);

    if (override.baseUrl && override.api) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: override.baseUrl,
        api: override.api,
        apiKeyEnv: override.apiKeyEnv,
        headers: override.headers,
        models,
        includeRegistryModels: true,
      });
    }

    if (isOpenClawOAuthPluginProviderKey(provider)) {
      ensureOAuthPluginEnabled(config, provider);
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
    ensureMoonshotKimiWebSearchBaseUrl(config, provider);

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
        models: [modelId, ...fallbackModelIds],
      });
    }

    const gateway = (config.gateway || {}) as Record<string, unknown>;
    if (!gateway.mode) gateway.mode = 'local';
    config.gateway = gateway;

    if (isOpenClawOAuthPluginProviderKey(provider)) {
      ensureOAuthPluginEnabled(config, provider);
    }

    return { changed: true, result: undefined };
  });
  console.log(
    `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
  );
}

export async function getActiveOpenClawProviders(): Promise<Set<string>> {
  const activeProviders = new Set<string>();
  const deprecatedProviders = new Set(['qwen-portal']);

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

  for (const provider of deprecatedProviders) {
    activeProviders.delete(provider);
  }

  return activeProviders;
}

export async function updateAgentModelProvider(
  providerType: string,
  entry: {
    baseUrl?: string;
    api?: string;
    models?: ProviderConfiguredModel[];
    apiKey?: string;
    authHeader?: boolean;
  }
): Promise<void> {
  void providerType;
  void entry;
}

export { getProviderEnvVar } from './provider-registry';
