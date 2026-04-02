import type { ProviderConfig } from '../../shared/providers/types';
import type { ProviderAccount } from '../../shared/providers/types';
import {
  getDefaultProviderAccountId,
  providerConfigToAccount,
  saveProviderAccount,
} from './provider-store';
import { getGeeClawProviderStore } from './store-instance';

const PROVIDER_STORE_SCHEMA_VERSION = 2;
const LEGACY_QWEN_PROVIDER = 'qwen-portal';
const MODELSTUDIO_PROVIDER = 'modelstudio';
const MODELSTUDIO_DEFAULT_MODEL_REF = 'modelstudio/qwen3.6-plus';

function normalizeLegacyQwenModelRef(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  if (!value.startsWith(`${LEGACY_QWEN_PROVIDER}/`)) {
    return value;
  }

  const modelId = value.slice(LEGACY_QWEN_PROVIDER.length + 1);
  const nextModelId = !modelId || modelId === 'coder-model' ? 'qwen3.6-plus' : modelId;
  return `${MODELSTUDIO_PROVIDER}/${nextModelId}`;
}

function normalizeLegacyQwenModelRefs(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const next = value
    .map((item) => normalizeLegacyQwenModelRef(item))
    .filter((item): item is string => typeof item === 'string');
  return next.length > 0 ? next : [MODELSTUDIO_DEFAULT_MODEL_REF];
}

function migrateLegacyQwenProviderConfig(
  provider: ProviderConfig,
): ProviderConfig {
  if (provider.type !== LEGACY_QWEN_PROVIDER) {
    return provider;
  }

  return {
    ...provider,
    type: MODELSTUDIO_PROVIDER,
    model: normalizeLegacyQwenModelRef(provider.model) as string | undefined ?? MODELSTUDIO_DEFAULT_MODEL_REF,
    models: normalizeLegacyQwenModelRefs(provider.models) as string[] | undefined,
    fallbackModels: normalizeLegacyQwenModelRefs(provider.fallbackModels) as string[] | undefined,
  };
}

function migrateLegacyQwenProviderAccount(
  account: ProviderAccount,
): ProviderAccount {
  if (account.vendorId !== LEGACY_QWEN_PROVIDER) {
    return account;
  }

  return {
    ...account,
    vendorId: MODELSTUDIO_PROVIDER,
    authMode: 'api_key',
    model: normalizeLegacyQwenModelRef(account.model) as string | undefined ?? MODELSTUDIO_DEFAULT_MODEL_REF,
    models: normalizeLegacyQwenModelRefs(account.models) as string[] | undefined,
    fallbackModels: normalizeLegacyQwenModelRefs(account.fallbackModels) as string[] | undefined,
  };
}

export async function ensureProviderStoreMigrated(): Promise<void> {
  const store = await getGeeClawProviderStore();
  const schemaVersion = Number(store.get('schemaVersion') ?? 0);
  const legacyProviders = (store.get('providers') ?? {}) as Record<string, ProviderConfig>;
  const migratedProviders = Object.fromEntries(
    Object.entries(legacyProviders).map(([providerId, provider]) => [
      providerId,
      migrateLegacyQwenProviderConfig(provider),
    ]),
  );
  if (JSON.stringify(migratedProviders) !== JSON.stringify(legacyProviders)) {
    store.set('providers', migratedProviders);
  }

  const existingAccounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  const migratedAccounts = Object.fromEntries(
    Object.entries(existingAccounts).map(([accountId, account]) => [
      accountId,
      migrateLegacyQwenProviderAccount(account),
    ]),
  );
  if (JSON.stringify(migratedAccounts) !== JSON.stringify(existingAccounts)) {
    store.set('providerAccounts', migratedAccounts);
  }

  if (schemaVersion >= PROVIDER_STORE_SCHEMA_VERSION) {
    return;
  }

  const defaultProviderId = (store.get('defaultProvider') ?? null) as string | null;
  const existingDefaultAccountId = await getDefaultProviderAccountId();

  for (const provider of Object.values(migratedProviders)) {
    const account = providerConfigToAccount(provider, {
      isDefault: provider.id === defaultProviderId,
    });
    await saveProviderAccount(account);
  }

  if (!existingDefaultAccountId && defaultProviderId) {
    store.set('defaultProviderAccountId', defaultProviderId);
  }

  store.set('schemaVersion', PROVIDER_STORE_SCHEMA_VERSION);
}
