import type { GatewayManager } from '../../gateway/manager';
import {
  getDefaultProviderModelEntries,
  normalizeProviderModelEntries,
  resolveEffectiveProviderModelEntries,
} from '../../shared/providers/config-models';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getProviderAccount, listProviderAccounts, providerAccountToConfig } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { getProviderConfig, getProviderDefaultModel, getProviderEnvVar } from '../../utils/provider-registry';
import {
  removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
} from '../../utils/openclaw-auth';
import {
  removeProviderFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
} from '../../utils/openclaw-provider-config';
import { getOpenClawProviderKeyForType, isMultiInstanceProviderType } from '../../utils/provider-keys';
import { getDefaultAgentModelConfig } from '../../utils/agent-config';
import { logger } from '../../utils/logger';
import { getLocalLlmProxyPort } from '../../main/local-llm-proxy';

const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const GEECLAW_PROVIDER_TYPE = 'geeclaw';
const GEECLAW_RUNTIME_PROVIDER = 'geeclaw';
const GEECLAW_ENV_VAR = 'GEECLAW_API_KEY';

function isUnregisteredProviderType(type: string): boolean {
  return isMultiInstanceProviderType(type);
}

function isSupportedRuntimeProviderType(type: string): boolean {
  return Boolean(getProviderDefinition(type)) || isUnregisteredProviderType(type);
}

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
};

type ProviderRuntimeSyncResult = {
  context: RuntimeProviderSyncContext | null;
  removed: boolean;
};

function isGeeClawProvider(config: Pick<ProviderConfig, 'type'>): boolean {
  return config.type === GEECLAW_PROVIDER_TYPE;
}

function isEnvBackedApiKeyProviderType(type: string): boolean {
  return Boolean(getProviderEnvVar(type));
}

function shouldUseEnvBackedApiKeyAuth(
  providerType: string,
  authMode?: 'api_key' | 'oauth_device' | 'oauth_browser' | 'local' | null,
): boolean {
  if (!isEnvBackedApiKeyProviderType(providerType)) {
    return false;
  }

  if (authMode) {
    return authMode === 'api_key';
  }

  // Legacy provider flows do not carry account authMode. For built-in env-backed
  // providers, treat explicit API-key sync as env-backed auth.
  return true;
}

function getGeeClawProxyBaseUrl(): string | undefined {
  const port = getLocalLlmProxyPort();
  return port ? `http://127.0.0.1:${port}/proxy` : undefined;
}

async function resolveProviderApiKey(
  config: ProviderConfig,
  explicitApiKey?: string,
): Promise<string | null> {
  const trimmedExplicitKey = explicitApiKey?.trim();
  if (trimmedExplicitKey) {
    return trimmedExplicitKey;
  }

  const secret = await getProviderSecret(config.id);
  if (secret?.type === 'api_key') {
    return secret.apiKey;
  }
  if (secret?.type === 'local' && secret.apiKey) {
    return secret.apiKey;
  }

  return await getApiKey(config.id);
}

async function removeGeeClawRuntimeProvider(config: ProviderConfig, runtimeProviderKey?: string): Promise<void> {
  await removeDeletedProviderFromOpenClaw(config, config.id, runtimeProviderKey ?? GEECLAW_RUNTIME_PROVIDER);
}

function normalizeProviderBaseUrl(
  config: ProviderConfig,
  baseUrl?: string,
  apiProtocol?: string,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return normalized.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  if (isUnregisteredProviderType(config.type)) {
    const protocol = apiProtocol || config.apiProtocol || 'openai-completions';
    if (protocol === 'openai-responses') {
      return normalized.replace(/\/responses?$/i, '');
    }
    if (protocol === 'openai-completions') {
      return normalized.replace(/\/chat\/completions$/i, '');
    }
    if (protocol === 'anthropic-messages') {
      return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    }
  }

  return normalized;
}

export function getOpenClawProviderKey(
  type: string,
  providerId: string,
  metadata?: ProviderConfig['metadata'],
): string {
  return getOpenClawProviderKeyForType(type, providerId, metadata);
}

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode === 'oauth_browser') {
    if (config.type === 'google') {
      return GOOGLE_OAUTH_RUNTIME_PROVIDER;
    }
    if (config.type === 'openai') {
      return OPENAI_OAUTH_RUNTIME_PROVIDER;
    }
  }
  return getOpenClawProviderKey(config.type, config.id, account?.metadata ?? config.metadata);
}

async function getBrowserOAuthRuntimeProvider(config: ProviderConfig): Promise<string | null> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode !== 'oauth_browser') {
    return null;
  }

  const secret = await getProviderSecret(config.id);
  if (secret?.type !== 'oauth') {
    return null;
  }

  if (config.type === 'google') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (config.type === 'openai') {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return null;
}

export function getProviderModelRef(config: ProviderConfig, providerKeyOverride?: string): string | undefined {
  const providerKey = providerKeyOverride ?? getOpenClawProviderKey(config.type, config.id, config.metadata);
  const configuredModels = resolveEffectiveProviderModelEntries(config, getProviderDefinition(config.type))
    .map((model) => model.id);

  if (configuredModels.length > 0) {
    const primaryModel = configuredModels[0];
    return primaryModel.startsWith(`${providerKey}/`)
      ? primaryModel
      : `${providerKey}/${primaryModel}`;
  }

  const defaultModel = getProviderDefaultModel(config.type);
  if (!defaultModel) {
    return undefined;
  }

  return defaultModel.startsWith(`${providerKey}/`)
    ? defaultModel
    : `${providerKey}/${defaultModel}`;
}

export function getProviderCatalogModelRefs(config: ProviderConfig): string[] {
  const providerKey = getOpenClawProviderKey(config.type, config.id, config.metadata);
  const results: string[] = [];
  const seen = new Set<string>();

  for (const model of resolveEffectiveProviderModelEntries(config, getProviderDefinition(config.type))) {
    const modelRef = model.id.startsWith(`${providerKey}/`)
      ? model.id
      : `${providerKey}/${model.id}`;

    if (seen.has(modelRef)) {
      continue;
    }
    seen.add(modelRef);
    results.push(modelRef);
  }

  return results;
}

export function getProviderCatalogModelIds(config: ProviderConfig): string[] {
  const providerKey = getOpenClawProviderKey(config.type, config.id);
  return getProviderCatalogModelRefs(config)
    .map((modelRef) => (
      modelRef.startsWith(`${providerKey}/`)
        ? modelRef.slice(providerKey.length + 1)
        : modelRef
    ));
}

export function getProviderCatalogModelEntries(config: ProviderConfig) {
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  return resolveEffectiveProviderModelEntries(config, getProviderDefinition(config.type)).map((model) => {
    const normalizedId = model.id.startsWith(`${providerKey}/`)
      ? model.id.slice(providerKey.length + 1)
      : model.id;
    const normalizedName = model.name === model.id
      ? normalizedId
      : model.name;

    return {
      ...model,
      id: normalizedId,
      name: normalizedName,
    };
  });
}

function getDeclaredProviderModelEntries(config: ProviderConfig) {
  const registryModels = normalizeProviderModelEntries(
    getDefaultProviderModelEntries(getProviderDefinition(config.type)),
  );
  const configuredModels = getProviderCatalogModelEntries(config);
  const mergedById = new Map<string, Record<string, unknown>>();
  const orderedIds: string[] = [];

  for (const group of [registryModels, configuredModels]) {
    for (const model of group) {
      if (!mergedById.has(model.id)) {
        orderedIds.push(model.id);
      }
      mergedById.set(model.id, {
        ...(mergedById.get(model.id) ?? {}),
        ...model,
      });
    }
  }

  return orderedIds
    .map((id) => mergedById.get(id))
    .filter((model): model is NonNullable<typeof model> => Boolean(model));
}

function scheduleGatewayRestart(
  gatewayManager: GatewayManager | undefined,
  message: string,
  options?: { delayMs?: number; onlyIfRunning?: boolean },
): void {
  if (!gatewayManager) {
    return;
  }

  if (options?.onlyIfRunning && gatewayManager.getStatus().state === 'stopped') {
    return;
  }

  logger.info(message);
  gatewayManager.debouncedRestart(options?.delayMs);
}

function readDefaultChatModelSelection(snapshot: Awaited<ReturnType<typeof getDefaultAgentModelConfig>>): {
  primary: string | null;
  fallbacks: string[];
} {
  if (snapshot && typeof snapshot === 'object' && 'model' in snapshot) {
    const model = snapshot.model;
    if (model && typeof model === 'object') {
      return {
        primary: typeof model.primary === 'string' && model.primary.trim() ? model.primary.trim() : null,
        fallbacks: Array.isArray(model.fallbacks) ? model.fallbacks : [],
      };
    }
  }

  return {
    primary: typeof snapshot?.primary === 'string' && snapshot.primary.trim() ? snapshot.primary.trim() : null,
    fallbacks: Array.isArray(snapshot?.fallbacks) ? snapshot.fallbacks : [],
  };
}

function mapModelRefToRuntimeProvider(
  config: ProviderConfig,
  runtimeProviderKey: string,
  modelRef?: string | null,
): string | undefined {
  if (!modelRef) {
    return undefined;
  }

  const configuredProviderKey = getOpenClawProviderKey(config.type, config.id);
  if (modelRef.startsWith(`${configuredProviderKey}/`)) {
    return `${runtimeProviderKey}/${modelRef.slice(configuredProviderKey.length + 1)}`;
  }

  return modelRef;
}

function mapFallbackRefsToRuntimeProvider(
  config: ProviderConfig,
  runtimeProviderKey: string,
  fallbackModelRefs: string[],
): string[] {
  return fallbackModelRefs.map((fallbackRef) => (
    mapModelRefToRuntimeProvider(config, runtimeProviderKey, fallbackRef) ?? fallbackRef
  ));
}

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  if (shouldUseEnvBackedApiKeyAuth(providerType)) {
    await removeProviderKeyFromOpenClaw(ock);
  } else {
    await saveProviderKeyToOpenClaw(ock, apiKey);
  }

  const provider = await getProvider(providerId);
  if (provider) {
    const context = await resolveRuntimeSyncContext(provider);
    if (context) {
      await syncAgentProviderModelCatalog(provider, ock, context, apiKey);
    }
  }

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after updating API key for provider "${providerId}"`,
    { onlyIfRunning: true },
  );
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();

  for (const account of accounts) {
    if (account.vendorId === GEECLAW_PROVIDER_TYPE || !isSupportedRuntimeProviderType(account.vendorId)) {
      continue;
    }

    const runtimeProviderKey = await resolveRuntimeProviderKey({
      id: account.id,
      name: account.label,
      type: account.vendorId,
      baseUrl: account.baseUrl,
      model: account.model,
      fallbackModels: account.fallbackModels,
      fallbackProviderIds: account.fallbackAccountIds,
      enabled: account.enabled,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });

    const secret = await getProviderSecret(account.id);
    if (!secret) {
      continue;
    }

    if (secret.type === 'api_key') {
      if (shouldUseEnvBackedApiKeyAuth(account.vendorId, account.authMode)) {
        await removeProviderKeyFromOpenClaw(runtimeProviderKey);
        continue;
      }
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'local' && secret.apiKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'oauth') {
      await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
        access: secret.accessToken,
        refresh: secret.refreshToken,
        expires: secret.expiresAt,
        email: secret.email,
        projectId: secret.subject,
      });
    }
  }
}

async function syncProviderSecretToRuntime(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  const account = await getProviderAccount(config.id);
  if (shouldUseEnvBackedApiKeyAuth(config.type, account?.authMode ?? null)) {
    await removeProviderKeyFromOpenClaw(runtimeProviderKey);
    return;
  }

  const secret = await getProviderSecret(config.id);
  if (apiKey !== undefined) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, trimmedKey);
    }
    return;
  }

  if (secret?.type === 'api_key') {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
    return;
  }

  if (secret?.type === 'oauth') {
    await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
      access: secret.accessToken,
      refresh: secret.refreshToken,
      expires: secret.expiresAt,
      email: secret.email,
      projectId: secret.subject,
    });
    return;
  }

  if (secret?.type === 'local' && secret.apiKey) {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
  }
}

async function resolveRuntimeSyncContext(config: ProviderConfig): Promise<RuntimeProviderSyncContext | null> {
  const runtimeProviderKey = await resolveRuntimeProviderKey(config);
  const meta = getProviderConfig(config.type);
  const api = isUnregisteredProviderType(config.type)
    ? (config.apiProtocol || 'openai-completions')
    : meta?.api;
  if (!api) {
    return null;
  }

  return {
    runtimeProviderKey,
    meta,
    api,
  };
}

async function syncRuntimeProviderConfig(
  config: ProviderConfig,
  context: RuntimeProviderSyncContext,
): Promise<void> {
  if (isGeeClawProvider(config)) {
    const baseUrl = getGeeClawProxyBaseUrl();
    if (!baseUrl) {
      return;
    }

    await syncProviderConfigToOpenClaw(
      context.runtimeProviderKey,
      getProviderCatalogModelEntries(config),
      {
        baseUrl,
        api: context.api,
        apiKeyEnv: GEECLAW_ENV_VAR,
      },
    );
    return;
  }

  await syncProviderConfigToOpenClaw(
    context.runtimeProviderKey,
    getProviderCatalogModelEntries(config),
    {
      baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
      api: context.api,
      apiKeyEnv: context.meta?.apiKeyEnv,
      headers: context.meta?.headers,
    },
  );
}

async function syncAgentProviderModelCatalog(
  config: ProviderConfig,
  runtimeProviderKey: string,
  context: RuntimeProviderSyncContext,
  apiKey: string | undefined,
): Promise<void> {
  const models = getDeclaredProviderModelEntries(config);

  if (isGeeClawProvider(config)) {
    const baseUrl = getGeeClawProxyBaseUrl();
    if (!baseUrl) {
      return;
    }

    await updateAgentModelProvider(runtimeProviderKey, {
      baseUrl,
      api: context.api,
      models,
      apiKey: GEECLAW_ENV_VAR,
    });
    return;
  }
  const baseUrl = normalizeProviderBaseUrl(
    config,
    config.baseUrl || context.meta?.baseUrl,
    isUnregisteredProviderType(config.type)
      ? (config.apiProtocol || 'openai-completions')
      : context.api,
  );

  if (!baseUrl) {
    return;
  }

  if (isUnregisteredProviderType(config.type)) {
    const resolvedKey = apiKey !== undefined ? apiKey.trim() : await getApiKey(config.id);
    if (apiKey === undefined && !resolvedKey) {
      return;
    }

    await updateAgentModelProvider(runtimeProviderKey, {
      baseUrl,
      api: config.apiProtocol || 'openai-completions',
      models,
      apiKey: resolvedKey ?? '',
    });
    return;
  }

  await updateAgentModelProvider(runtimeProviderKey, {
    baseUrl,
    api: context.api,
    models,
    apiKey: context.meta?.apiKeyEnv,
  });
}

async function syncProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
): Promise<ProviderRuntimeSyncResult> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return { context: null, removed: false };
  }

  if (isGeeClawProvider(config)) {
    const resolvedKey = await resolveProviderApiKey(config, apiKey);
    const proxyBaseUrl = getGeeClawProxyBaseUrl();

    if (!config.enabled || !resolvedKey || !proxyBaseUrl) {
      await removeGeeClawRuntimeProvider(config, context.runtimeProviderKey);
      return { context: null, removed: true };
    }
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context);
  await syncAgentProviderModelCatalog(config, context.runtimeProviderKey, context, apiKey);
  return { context, removed: false };
}

async function removeDeletedProviderFromOpenClaw(
  provider: ProviderConfig,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  const keys = new Set<string>();
  keys.add(runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId }));
  keys.add(providerId);

  for (const key of keys) {
    await removeProviderFromOpenClaw(key);
  }
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const result = await syncProviderToRuntime(config, apiKey);
  if (!result.context && !result.removed) {
    return;
  }

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after saving provider "${result.context?.runtimeProviderKey ?? config.id}" config`,
    { onlyIfRunning: true },
  );
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const result = await syncProviderToRuntime(config, apiKey);
  if (!result.context) {
    if (result.removed) {
      scheduleGatewayRestart(
        gatewayManager,
        `Scheduling Gateway restart after removing provider "${config.id}" from runtime`,
      );
    }
    return;
  }

  const ock = result.context.runtimeProviderKey;
  const modelSnapshot = readDefaultChatModelSelection(await getDefaultAgentModelConfig());

  const defaultProviderId = await getDefaultProvider();
  if (defaultProviderId === config.id && modelSnapshot.primary) {
    const modelOverride = mapModelRefToRuntimeProvider(config, ock, modelSnapshot.primary);
    const fallbacks = mapFallbackRefsToRuntimeProvider(config, ock, modelSnapshot.fallbacks);
    if (isGeeClawProvider(config)) {
      const baseUrl = getGeeClawProxyBaseUrl();
      if (baseUrl) {
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl,
          api: 'openai-completions',
          apiKeyEnv: GEECLAW_ENV_VAR,
        }, fallbacks);
      }
    } else if (!isUnregisteredProviderType(config.type)) {
      await setOpenClawDefaultModel(ock, modelOverride, fallbacks);
    } else {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
        api: config.apiProtocol || 'openai-completions',
      }, fallbacks);
    }
  }

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after updating provider "${ock}" config`,
  );
}

export async function syncDeletedProviderToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  gatewayManager?: GatewayManager,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeDeletedProviderFromOpenClaw(provider, providerId, ock);

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after deleting provider "${ock}"`,
  );
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
  gatewayManager?: GatewayManager,
): Promise<void> {
  if (!provider?.type && !runtimeProviderKey) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider!, id: providerId });
  await removeProviderKeyFromOpenClaw(ock);
  if (provider) {
    const context = await resolveRuntimeSyncContext(provider);
    if (context) {
      await syncAgentProviderModelCatalog(provider, ock, context, '');
    }
  }
  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after deleting API key for provider "${providerId}"`,
    { onlyIfRunning: true },
  );
}

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) {
    return;
  }

  if (isGeeClawProvider(provider)) {
    const runtimeProviderKey = await resolveRuntimeProviderKey(provider);
    const providerKey = await resolveProviderApiKey(provider, undefined);
    const modelSnapshot = readDefaultChatModelSelection(await getDefaultAgentModelConfig());
    const runtimePrimaryModel = mapModelRefToRuntimeProvider(provider, runtimeProviderKey, modelSnapshot.primary);
    const runtimeFallbacks = mapFallbackRefsToRuntimeProvider(provider, runtimeProviderKey, modelSnapshot.fallbacks);
    const baseUrl = getGeeClawProxyBaseUrl();

    if (!provider.enabled || !providerKey || !baseUrl) {
      await removeGeeClawRuntimeProvider(provider, runtimeProviderKey);
      scheduleGatewayRestart(
        gatewayManager,
        `Scheduling Gateway restart after removing provider "${runtimeProviderKey}" from runtime`,
        { onlyIfRunning: true },
      );
      return;
    }

    if (runtimePrimaryModel) {
      await setOpenClawDefaultModelWithOverride(runtimeProviderKey, runtimePrimaryModel, {
        baseUrl,
        api: 'openai-completions',
        apiKeyEnv: GEECLAW_ENV_VAR,
      }, runtimeFallbacks);
    }

    const context = await resolveRuntimeSyncContext(provider);
    if (context) {
      await syncRuntimeProviderConfig(provider, context);
      await syncAgentProviderModelCatalog(provider, runtimeProviderKey, context, providerKey);
    }

    scheduleGatewayRestart(
      gatewayManager,
      `Scheduling Gateway restart after provider switch to "${runtimeProviderKey}"`,
      { onlyIfRunning: true },
    );
    return;
  }

  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const modelSnapshot = readDefaultChatModelSelection(await getDefaultAgentModelConfig());
  const runtimePrimaryModel = mapModelRefToRuntimeProvider(provider, ock, modelSnapshot.primary);
  const runtimeFallbacks = mapFallbackRefsToRuntimeProvider(provider, ock, modelSnapshot.fallbacks);
  const oauthTypes = ['minimax-portal', 'minimax-portal-cn'];
  const browserOAuthRuntimeProvider = await getBrowserOAuthRuntimeProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || Boolean(browserOAuthRuntimeProvider);
  const account = await getProviderAccount(provider.id);
  const useEnvBackedApiKeyAuth = shouldUseEnvBackedApiKeyAuth(provider.type, account?.authMode ?? null);

  if (!isOAuthProvider) {
    if (runtimePrimaryModel) {
      if (isUnregisteredProviderType(provider.type)) {
        await setOpenClawDefaultModelWithOverride(ock, runtimePrimaryModel, {
          baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
          api: provider.apiProtocol || 'openai-completions',
        }, runtimeFallbacks);
      } else {
        await setOpenClawDefaultModel(ock, runtimePrimaryModel, runtimeFallbacks);
      }
    }

    if (useEnvBackedApiKeyAuth) {
      await removeProviderKeyFromOpenClaw(ock);
    } else if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }

    const context = await resolveRuntimeSyncContext(provider);
    if (context) {
      await syncAgentProviderModelCatalog(provider, ock, context, providerKey ?? undefined);
    }
  } else {
    if (browserOAuthRuntimeProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(browserOAuthRuntimeProvider, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      if (runtimePrimaryModel) {
        await setOpenClawDefaultModel(browserOAuthRuntimeProvider, runtimePrimaryModel, runtimeFallbacks);
        logger.info(`Configured openclaw.json for browser OAuth provider "${provider.id}"`);
        scheduleGatewayRestart(
          gatewayManager,
          `Scheduling Gateway restart after provider switch to "${browserOAuthRuntimeProvider}"`,
        );
        return;
      }

      scheduleGatewayRestart(
        gatewayManager,
        `Scheduling Gateway restart after provider switch to "${browserOAuthRuntimeProvider}"`,
      );
      return;
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : 'https://api.minimaxi.com/anthropic';
    const api = 'anthropic-messages' as const;

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    const targetProviderKey = 'minimax-portal';

    if (runtimePrimaryModel) {
      await setOpenClawDefaultModelWithOverride(targetProviderKey, runtimePrimaryModel, {
        baseUrl,
        api,
        authHeader: true,
        apiKeyEnv: 'minimax-oauth',
      }, runtimeFallbacks);

      logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);
    }

    try {
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: true,
        apiKey: 'minimax-oauth',
        models: getDeclaredProviderModelEntries(provider),
      });
    } catch (err) {
      logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
    }
  }

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after provider switch to "${ock}"`,
    { onlyIfRunning: true },
  );
}

/**
 * Sync ALL provider configs (auth keys/tokens + model catalog + default model)
 * from the electron-store to openclaw.json.
 *
 * Called once on every gateway startup (via `syncGatewayConfigBeforeLaunch`)
 * to repair any config drift introduced by openclaw's doctor/auto-repair.
 * Does NOT schedule a gateway restart.
 */
export async function syncAllProviderRuntimeConfigToOpenClaw(): Promise<void> {
  // 1. Sync auth keys / OAuth tokens for every configured provider.
  try {
    await syncAllProviderAuthToRuntime();
  } catch (err) {
    logger.warn('[startup-sync] Failed to sync provider auth to openclaw:', err);
  }

  // 2. Sync model catalog (models.providers.*) for every provider.
  const accounts = await listProviderAccounts();
  for (const account of accounts) {
    const config = providerAccountToConfig(account);
    let result: ProviderRuntimeSyncResult;
    try {
      result = await syncProviderToRuntime(config, undefined);
    } catch (err) {
      logger.warn(`[startup-sync] Failed to sync provider model catalog for "${account.id}":`, err);
      continue;
    }
    if (!result.context && !result.removed) continue;
  }

  // 3. Sync the default provider's primary model (agents.defaults.model).
  //    Pass no gatewayManager so it writes without scheduling a restart.
  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      await syncDefaultProviderToRuntime(defaultProviderId, undefined);
    }
  } catch (err) {
    logger.warn('[startup-sync] Failed to sync default provider model to openclaw.json:', err);
  }
}
