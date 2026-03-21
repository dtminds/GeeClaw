import type { GatewayManager } from '../../gateway/manager';
import { getConfiguredProviderModels } from '../../shared/providers/config-models';
import { getProviderAccount, listProviderAccounts, providerAccountToConfig } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { getProviderConfig, getProviderDefaultModel } from '../../utils/provider-registry';
import {
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
import { getDefaultAgentModelConfig } from '../../utils/agent-config';
import { logger } from '../../utils/logger';

const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL_REF = `${GOOGLE_OAUTH_RUNTIME_PROVIDER}/gemini-3-pro-preview`;

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
};

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

  if (config.type === 'custom' || config.type === 'ollama') {
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

export function getOpenClawProviderKey(type: string, providerId: string): string {
  if (type === 'custom' || type === 'ollama') {
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }
  if (type === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return type;
}

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (config.type === 'google' && account?.authMode === 'oauth_browser') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  return getOpenClawProviderKey(config.type, config.id);
}

async function isGoogleBrowserOAuthProvider(config: ProviderConfig): Promise<boolean> {
  const account = await getProviderAccount(config.id);
  if (config.type !== 'google' || account?.authMode !== 'oauth_browser') {
    return false;
  }

  const secret = await getProviderSecret(config.id);
  return secret?.type === 'oauth';
}

export function getProviderModelRef(config: ProviderConfig, providerKeyOverride?: string): string | undefined {
  const providerKey = providerKeyOverride ?? getOpenClawProviderKey(config.type, config.id);
  const configuredModels = getConfiguredProviderModels(config);

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
  const providerKey = getOpenClawProviderKey(config.type, config.id);
  const results: string[] = [];
  const seen = new Set<string>();

  for (const model of getConfiguredProviderModels(config)) {
    const modelRef = model.startsWith(`${providerKey}/`)
      ? model
      : `${providerKey}/${model}`;

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

function getRegistryProviderModelIds(config: ProviderConfig): string[] {
  return (getProviderConfig(config.type)?.models ?? [])
    .map((model) => (typeof model?.id === 'string' ? model.id.trim() : ''))
    .filter(Boolean);
}

function getDeclaredProviderModelIds(config: ProviderConfig): string[] {
  const providerKey = getOpenClawProviderKey(config.type, config.id);
  const results: string[] = [];
  const seen = new Set<string>();

  for (const modelId of [
    ...getRegistryProviderModelIds(config),
    ...getProviderCatalogModelIds(config),
  ]) {
    const normalized = modelId.startsWith(`${providerKey}/`)
      ? modelId.slice(providerKey.length + 1)
      : modelId;
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
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

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  await saveProviderKeyToOpenClaw(ock, apiKey);
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();

  for (const account of accounts) {
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
  const api = config.type === 'custom' || config.type === 'ollama'
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
  await syncProviderConfigToOpenClaw(
    context.runtimeProviderKey,
    getProviderCatalogModelIds(config),
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
  const models = getDeclaredProviderModelIds(config).map((id) => ({ id, name: id, reasoning: false }));
  const baseUrl = normalizeProviderBaseUrl(
    config,
    config.baseUrl || context.meta?.baseUrl,
    config.type === 'custom' || config.type === 'ollama'
      ? (config.apiProtocol || 'openai-completions')
      : context.api,
  );

  if (!baseUrl) {
    return;
  }

  if (config.type === 'custom' || config.type === 'ollama') {
    const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
    if (!resolvedKey) {
      return;
    }

    await updateAgentModelProvider(runtimeProviderKey, {
      baseUrl,
      api: config.apiProtocol || 'openai-completions',
      models,
      apiKey: resolvedKey,
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
): Promise<RuntimeProviderSyncContext | null> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return null;
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context);
  await syncAgentProviderModelCatalog(config, context.runtimeProviderKey, context, apiKey);
  return context;
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after saving provider "${context.runtimeProviderKey}" config`,
    { onlyIfRunning: true },
  );
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  const ock = context.runtimeProviderKey;
  const { fallbacks } = await getDefaultAgentModelConfig();

  const defaultProviderId = await getDefaultProvider();
  if (defaultProviderId === config.id) {
    const modelOverride = getProviderModelRef(config);
    if (config.type !== 'custom' && config.type !== 'ollama') {
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
  await removeProviderFromOpenClaw(ock);

  scheduleGatewayRestart(
    gatewayManager,
    `Scheduling Gateway restart after deleting provider "${ock}"`,
  );
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderFromOpenClaw(ock);
}

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) {
    return;
  }

  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const { fallbacks } = await getDefaultAgentModelConfig();
  const oauthTypes = ['qwen-portal', 'minimax-portal', 'minimax-portal-cn'];
  const isGoogleOAuthProvider = await isGoogleBrowserOAuthProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || isGoogleOAuthProvider;

  if (!isOAuthProvider) {
    const modelOverride = getProviderModelRef(provider);

    if (provider.type === 'custom' || provider.type === 'ollama') {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
        api: provider.apiProtocol || 'openai-completions',
      }, fallbacks);
    } else {
      await setOpenClawDefaultModel(ock, modelOverride, fallbacks);
    }

    if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }

    const context = await resolveRuntimeSyncContext(provider);
    if (context) {
      await syncAgentProviderModelCatalog(provider, ock, context, providerKey ?? undefined);
    }
  } else {
    if (isGoogleOAuthProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(GOOGLE_OAUTH_RUNTIME_PROVIDER, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      const modelOverride = getProviderModelRef(provider, GOOGLE_OAUTH_RUNTIME_PROVIDER)
        ?? GOOGLE_OAUTH_DEFAULT_MODEL_REF;

      await setOpenClawDefaultModel(GOOGLE_OAUTH_RUNTIME_PROVIDER, modelOverride, fallbacks);
      logger.info(`Configured openclaw.json for Google browser OAuth provider "${provider.id}"`);
      scheduleGatewayRestart(
        gatewayManager,
        `Scheduling Gateway restart after provider switch to "${GOOGLE_OAUTH_RUNTIME_PROVIDER}"`,
      );
      return;
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : (provider.type === 'minimax-portal-cn' ? 'https://api.minimaxi.com/anthropic' : 'https://portal.qwen.ai/v1');
    const api: 'anthropic-messages' | 'openai-completions' =
      (provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn')
        ? 'anthropic-messages'
        : 'openai-completions';

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if ((provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn') && baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    const targetProviderKey = (provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn')
      ? 'minimax-portal'
      : provider.type;

    await setOpenClawDefaultModelWithOverride(targetProviderKey, getProviderModelRef(provider), {
      baseUrl,
      api,
      authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
      apiKeyEnv: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
    }, fallbacks);

    logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);

    try {
      const models = getProviderCatalogModelIds(provider).map((id) => ({ id, name: id, reasoning: false }));
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
        apiKey: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
        models,
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
    let context: Awaited<ReturnType<typeof resolveRuntimeSyncContext>>;
    try {
      context = await resolveRuntimeSyncContext(config);
    } catch (err) {
      logger.warn(`[startup-sync] Failed to resolve runtime context for "${account.id}":`, err);
      continue;
    }
    if (!context) continue;
    try {
      await syncRuntimeProviderConfig(config, context);
    } catch (err) {
      logger.warn(`[startup-sync] Failed to sync provider model catalog for "${account.id}":`, err);
    }
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
