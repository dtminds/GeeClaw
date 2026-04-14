import { providerIcons } from '@/assets/providers';
import {
  getProviderTypeInfo as getSharedProviderTypeInfo,
  getProviderUiInfoList,
} from '../../shared/providers/registry.ts';
import {
  getConfiguredProviderModelEntries as getSharedConfiguredProviderModelEntries,
  getConfiguredProviderModels as getSharedConfiguredProviderModels,
  getDefaultProviderModelEntries as getSharedDefaultProviderModelEntries,
  normalizeProviderModelEntries as normalizeSharedProviderModelEntries,
  normalizeProviderModelList as normalizeSharedProviderModelList,
  resolveEffectiveProviderModelEntries as resolveSharedEffectiveProviderModelEntries,
} from '../../shared/providers/config-models.ts';
export {
  BUILTIN_PROVIDER_TYPES,
  OLLAMA_PLACEHOLDER_API_KEY,
  PROVIDER_TYPES,
  type ProviderAccount,
  type ProviderAuthMode,
  type ProviderCodePlanPreset,
  type ProviderConfig,
  type ProviderModelCatalogMode,
  type ProviderModelCatalogState,
  type ProviderConfiguredModel,
  type ProviderModelEntry,
  type ProviderModelInputModality,
  type ProviderProtocol,
  type ProviderType,
  type ProviderTypeInfo,
  type ProviderVendorCategory,
  type ProviderVendorInfo,
  type ProviderWithKeyInfo,
} from '../../shared/providers/types.ts';
import {
  OLLAMA_PLACEHOLDER_API_KEY,
  type ProviderCodePlanPreset,
  type ProviderConfig,
  type ProviderConfiguredModel,
  type ProviderModelEntry,
  type ProviderType,
  type ProviderTypeInfo,
} from '../../shared/providers/types.ts';

export const PROVIDER_TYPE_INFO: ProviderTypeInfo[] = getProviderUiInfoList();

/** Get the SVG logo URL for a provider type, falls back to undefined */
export function getProviderIconUrl(type: ProviderType | string): string | undefined {
  return providerIcons[type];
}

/** Whether a provider's logo needs CSS invert in dark mode. Defaults to true for monochrome icons. */
export function shouldInvertInDark(type: ProviderType | string): boolean {
  const provider = PROVIDER_TYPE_INFO.find((item) => item.id === type);
  return provider?.invertIconInDark ?? true;
}

/** Provider list shown in the Setup wizard */
export const SETUP_PROVIDERS = PROVIDER_TYPE_INFO.filter((provider) => !provider.hidden);

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return getSharedProviderTypeInfo(type);
}

export function getProviderDocsUrl(
  provider: Pick<ProviderTypeInfo, 'docsUrl' | 'docsUrlZh'> | undefined,
  language: string,
): string | undefined {
  if (!provider?.docsUrl) {
    return undefined;
  }

  if (language.startsWith('zh') && provider.docsUrlZh) {
    return provider.docsUrlZh;
  }

  return provider.docsUrl;
}

export function shouldShowProviderModelId(
  provider: Pick<ProviderTypeInfo, 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  devModeUnlocked: boolean,
): boolean {
  if (!provider?.showModelId) return false;
  if (provider.showModelIdInDevModeOnly && !devModeUnlocked) return false;
  return true;
}

export function getDefaultProviderModelEntries(
  provider: Pick<ProviderTypeInfo, 'defaultModels' | 'defaultModelId'> | undefined,
): ProviderModelEntry[] {
  return getSharedDefaultProviderModelEntries(provider);
}

export function resolveProviderModelForSave(
  provider: Pick<ProviderTypeInfo, 'defaultModelId' | 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  modelId: string,
  devModeUnlocked: boolean,
): string | undefined {
  if (!shouldShowProviderModelId(provider, devModeUnlocked)) {
    return undefined;
  }

  const trimmedModelId = modelId.trim();
  return trimmedModelId || provider?.defaultModelId || undefined;
}

export function getProviderCodePlanPreset(
  provider: Pick<ProviderTypeInfo, 'codePlanPresetBaseUrl' | 'codePlanPresetModelId'> | undefined,
): ProviderCodePlanPreset | null {
  if (!provider?.codePlanPresetBaseUrl || !provider.codePlanPresetModelId) {
    return null;
  }

  return {
    baseUrl: provider.codePlanPresetBaseUrl,
    modelId: provider.codePlanPresetModelId,
  };
}

export function isProviderCodePlanMode(
  baseUrl: string | undefined,
  models: Iterable<string | null | undefined> | string | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (!codePlanPresetBaseUrl || !codePlanPresetModelId) {
    return false;
  }

  const normalizedModels = typeof models === 'string'
    ? normalizeProviderModelList([models])
    : normalizeProviderModelList(models);

  return (
    (baseUrl || '').trim() === codePlanPresetBaseUrl
    && normalizedModels.length === 1
    && normalizedModels[0] === codePlanPresetModelId
  );
}

/** Normalize provider API key before saving; Ollama uses a local placeholder when blank. */
export function resolveProviderApiKeyForSave(type: ProviderType | string, apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (type === 'ollama') {
    return trimmed || OLLAMA_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}

export function normalizeProviderModelList(models?: Iterable<string | null | undefined>): string[] {
  return normalizeSharedProviderModelList(models);
}

export function normalizeProviderModelEntries(
  models?: Iterable<ProviderConfiguredModel | null | undefined>,
): ProviderModelEntry[] {
  return normalizeSharedProviderModelEntries(models);
}

export function providerModelEntriesEqual(
  left?: Iterable<ProviderConfiguredModel | null | undefined>,
  right?: Iterable<ProviderConfiguredModel | null | undefined>,
): boolean {
  const normalizedLeft = normalizeProviderModelEntries(left);
  const normalizedRight = normalizeProviderModelEntries(right);

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function getConfiguredProviderModels(
  provider: Pick<ProviderConfig, 'models' | 'model' | 'fallbackModels'>,
): string[] {
  return getSharedConfiguredProviderModels(provider);
}

export function getConfiguredProviderModelEntries(
  provider: Pick<ProviderConfig, 'models' | 'model' | 'fallbackModels'>,
): ProviderModelEntry[] {
  return getSharedConfiguredProviderModelEntries(provider);
}

export function getEffectiveProviderModelEntries(
  provider: Pick<ProviderConfig, 'models' | 'model' | 'fallbackModels' | 'metadata'>,
  typeInfo: Pick<ProviderTypeInfo, 'defaultModels' | 'defaultModelId'> | undefined,
): ProviderModelEntry[] {
  return resolveSharedEffectiveProviderModelEntries(provider, typeInfo);
}
