import type { OpenClawConfigDocument } from './openclaw-config-coordinator';
import {
  listWebSearchProviderDescriptors,
  type WebSearchProviderDescriptor,
  type WebSearchProviderId,
} from './openclaw-web-search-provider-registry';

type WebSearchSharedField = 'maxResults' | 'timeoutSeconds' | 'cacheTtlMinutes';
const WEB_SEARCH_SHARED_FIELDS = ['maxResults', 'timeoutSeconds', 'cacheTtlMinutes'] satisfies WebSearchSharedField[];

export type WebSearchSettingsSnapshot = {
  search: {
    enabled: boolean;
    provider?: WebSearchProviderId;
    maxResults?: number;
    timeoutSeconds?: number;
    cacheTtlMinutes?: number;
  };
  providerConfigByProvider: Record<string, Record<string, unknown>>;
};

export type WebSearchProviderAvailability = {
  available: boolean;
  source: 'saved' | 'environment' | 'built-in' | 'runtime-prereq' | 'missing';
};

export type WebSearchProviderEnvVarStatusMap = Record<WebSearchProviderId, Record<string, boolean>>;

export type WebSearchSettingsPatch = {
  enabled?: boolean;
  provider?: WebSearchProviderId | null;
  shared?: Partial<Record<WebSearchSharedField, number | null>>;
  providerConfig?: {
    providerId: WebSearchProviderId;
    values: Record<string, unknown>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedProviderId(value: unknown): value is WebSearchProviderId {
  return listWebSearchProviderDescriptors().some((descriptor) => descriptor.providerId === value);
}

function cloneConfigObject(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

function findDescriptor(providerId: WebSearchProviderId): WebSearchProviderDescriptor {
  const descriptor = listWebSearchProviderDescriptors().find((entry) => entry.providerId === providerId);
  if (!descriptor) {
    throw new Error(`Unsupported web search provider: ${providerId}`);
  }
  return descriptor;
}

function isEmptyRecord(value: Record<string, unknown> | undefined): boolean {
  return !value || Object.keys(value).length === 0;
}

function updatePluginEntry(
  config: OpenClawConfigDocument,
  pluginId: string,
  mutate: (entry: Record<string, unknown>) => boolean,
): boolean {
  const existingPlugins = cloneConfigObject(config.plugins);
  const existingEntries = cloneConfigObject(existingPlugins?.entries);
  const existingEntry = cloneConfigObject(existingEntries?.[pluginId]);
  const nextEntry = existingEntry ?? {};

  if (!mutate(nextEntry)) {
    return false;
  }

  const nextEntries = existingEntries ?? {};
  nextEntries[pluginId] = nextEntry;

  const nextPlugins = existingPlugins ?? {};
  nextPlugins.entries = nextEntries;
  config.plugins = nextPlugins;
  return true;
}

function shallowCopy(source: Record<string, unknown>): Record<string, unknown> {
  return { ...source };
}

export {
  listWebSearchProviderDescriptors,
  type WebSearchProviderDescriptor,
  type WebSearchProviderId,
};

function hasConfiguredAvailabilityValue(
  descriptor: WebSearchProviderDescriptor,
  providerConfig: Record<string, unknown> | undefined,
): boolean {
  if (!providerConfig || !descriptor.availabilityFieldKey) {
    return false;
  }

  if (descriptor.availabilityKind === 'config' || descriptor.availabilityKind === 'secret') {
    const value = providerConfig[descriptor.availabilityFieldKey];
    return typeof value === 'string' && value.trim().length > 0;
  }

  return false;
}

function hasEnvironmentAvailabilityValue(
  descriptor: WebSearchProviderDescriptor,
  runtimeEnv: Record<string, string | undefined>,
): boolean {
  if (descriptor.availabilityKind !== 'secret' && descriptor.availabilityKind !== 'config') {
    return false;
  }

  return descriptor.envVars.some((envVar) => {
    const value = runtimeEnv[envVar];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function buildWebSearchProviderEnvVarStatusMap(
  runtimeEnv: Record<string, string | undefined>,
): WebSearchProviderEnvVarStatusMap {
  const envVarStatusByProvider = {} as WebSearchProviderEnvVarStatusMap;

  for (const descriptor of listWebSearchProviderDescriptors()) {
    envVarStatusByProvider[descriptor.providerId] = Object.fromEntries(
      descriptor.envVars.map((envVar) => {
        const value = runtimeEnv[envVar];
        return [envVar, typeof value === 'string' && value.trim().length > 0];
      }),
    );
  }

  return envVarStatusByProvider;
}

export function buildWebSearchProviderAvailabilityMap(
  providerConfigByProvider: Record<string, Record<string, unknown>>,
  runtimeEnv: Record<string, string | undefined>,
): Record<WebSearchProviderId, WebSearchProviderAvailability> {
  const availabilityByProvider = {} as Record<WebSearchProviderId, WebSearchProviderAvailability>;

  for (const descriptor of listWebSearchProviderDescriptors()) {
    const providerConfig = providerConfigByProvider[descriptor.providerId];
    if (descriptor.availabilityKind === 'none') {
      availabilityByProvider[descriptor.providerId] = {
        available: true,
        source: 'built-in',
      };
      continue;
    }

    if (descriptor.availabilityKind === 'runtime') {
      availabilityByProvider[descriptor.providerId] = {
        available: false,
        source: 'runtime-prereq',
      };
      continue;
    }

    if (hasConfiguredAvailabilityValue(descriptor, providerConfig)) {
      availabilityByProvider[descriptor.providerId] = {
        available: true,
        source: 'saved',
      };
      continue;
    }

    if (hasEnvironmentAvailabilityValue(descriptor, runtimeEnv)) {
      availabilityByProvider[descriptor.providerId] = {
        available: true,
        source: 'environment',
      };
      continue;
    }

    availabilityByProvider[descriptor.providerId] = {
      available: false,
      source: 'missing',
    };
  }

  return availabilityByProvider;
}

export function readWebSearchSettingsSnapshot(config: OpenClawConfigDocument): WebSearchSettingsSnapshot {
  const tools = cloneConfigObject(config.tools);
  const web = cloneConfigObject(tools?.web);
  const search = cloneConfigObject(web?.search);
  const plugins = cloneConfigObject(config.plugins);
  const entries = cloneConfigObject(plugins?.entries);

  const providerConfigByProvider: Record<string, Record<string, unknown>> = {};
  for (const descriptor of listWebSearchProviderDescriptors()) {
    const pluginEntry = cloneConfigObject(entries?.[descriptor.pluginId]);
    const pluginConfig = cloneConfigObject(pluginEntry?.config);
    const providerConfig = cloneConfigObject(pluginConfig?.webSearch);

    if (providerConfig && Object.keys(providerConfig).length > 0) {
      providerConfigByProvider[descriptor.providerId] = shallowCopy(providerConfig);
    }
  }

  const snapshot: WebSearchSettingsSnapshot = {
    search: {
      enabled: search?.enabled !== false,
    },
    providerConfigByProvider,
  };

  if (isSupportedProviderId(search?.provider)) {
    snapshot.search.provider = search.provider;
  }

  for (const field of WEB_SEARCH_SHARED_FIELDS) {
    const value = search?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      snapshot.search[field] = value;
    }
  }

  return snapshot;
}

export function applyWebSearchSettingsPatch(
  config: OpenClawConfigDocument,
  patch: WebSearchSettingsPatch,
): boolean {
  let changed = false;

  if (patch.enabled !== undefined || 'provider' in patch || patch.shared) {
    const existingTools = cloneConfigObject(config.tools);
    const existingWeb = cloneConfigObject(existingTools?.web);
    const existingSearch = cloneConfigObject(existingWeb?.search);

    const nextTools = existingTools ?? {};
    const nextWeb = existingWeb ?? {};
    const nextSearch = existingSearch ?? {};

    let searchChanged = false;

    if (patch.enabled !== undefined && nextSearch.enabled !== patch.enabled) {
      nextSearch.enabled = patch.enabled;
      searchChanged = true;
    }

    if ('provider' in patch) {
      if (patch.provider === null) {
        if ('provider' in nextSearch) {
          delete nextSearch.provider;
          searchChanged = true;
        }
      } else if (patch.provider !== undefined && nextSearch.provider !== patch.provider) {
        nextSearch.provider = patch.provider;
        searchChanged = true;
      }
    }

    if (patch.shared) {
      for (const field of WEB_SEARCH_SHARED_FIELDS) {
        if (!(field in patch.shared)) {
          continue;
        }

        const value = patch.shared[field];
        if (value === null) {
          if (field in nextSearch) {
            delete nextSearch[field];
            searchChanged = true;
          }
          continue;
        }

        if (typeof value === 'number' && Number.isFinite(value) && nextSearch[field] !== value) {
          nextSearch[field] = value;
          searchChanged = true;
        }
      }
    }

    if (searchChanged) {
      nextWeb.search = nextSearch;
      nextTools.web = nextWeb;
      config.tools = nextTools;
      changed = true;
    }
  }

  if (patch.providerConfig) {
    const descriptor = findDescriptor(patch.providerConfig.providerId);
    const providerEntryChanged = updatePluginEntry(config, descriptor.pluginId, (entry) => {
      const existingConfig = cloneConfigObject(entry.config);
      const existingWebSearch = cloneConfigObject(existingConfig?.webSearch);
      const nextConfig = existingConfig ?? {};
      const nextWebSearch = existingWebSearch ?? {};
      let webSearchChanged = false;

      for (const [key, value] of Object.entries(patch.providerConfig?.values ?? {})) {
        if (value === null || value === '') {
          if (key in nextWebSearch) {
            delete nextWebSearch[key];
            webSearchChanged = true;
          }
          continue;
        }

        if (nextWebSearch[key] !== value) {
          nextWebSearch[key] = value;
          webSearchChanged = true;
        }
      }

      if (!webSearchChanged) {
        return false;
      }

      nextConfig.webSearch = nextWebSearch;
      entry.config = nextConfig;
      return true;
    });

    changed = providerEntryChanged || changed;
  }

  if (patch.provider) {
    const descriptor = findDescriptor(patch.provider);
    if (!descriptor.enablePluginOnSelect) {
      return changed;
    }

    const providerEnableChanged = updatePluginEntry(config, descriptor.pluginId, (entry) => {
      if (entry.enabled === true) {
        return false;
      }

      entry.enabled = true;
      return true;
    });
    changed = providerEnableChanged || changed;
  }

  return changed;
}

export function deleteWebSearchProviderConfig(
  config: OpenClawConfigDocument,
  providerId: WebSearchProviderId,
): boolean {
  const descriptor = findDescriptor(providerId);
  const plugins = cloneConfigObject(config.plugins);
  const entries = cloneConfigObject(plugins?.entries);
  const entry = cloneConfigObject(entries?.[descriptor.pluginId]);
  const entryConfig = cloneConfigObject(entry?.config);
  const webSearch = cloneConfigObject(entryConfig?.webSearch);

  if (!entry || !entryConfig || !webSearch) {
    return false;
  }

  delete entryConfig.webSearch;

  if (isEmptyRecord(entryConfig)) {
    delete entry.config;
  } else {
    entry.config = entryConfig;
  }

  const nextEntries = entries ?? {};
  nextEntries[descriptor.pluginId] = entry;

  const nextPlugins = plugins ?? {};
  nextPlugins.entries = nextEntries;
  config.plugins = nextPlugins;
  return true;
}
