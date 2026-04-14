import { providerIcons } from '@/assets/providers';
import {
  getProviderTypeInfo as getSharedProviderTypeInfo,
  getProviderUiInfoList,
} from '../../shared/providers/registry.ts';
export {
  BUILTIN_PROVIDER_TYPES,
  OLLAMA_PLACEHOLDER_API_KEY,
  PROVIDER_TYPES,
  type ProviderAccount,
  type ProviderAuthMode,
  type ProviderCodePlanPreset,
  type ProviderConfig,
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
  type ProviderModelInputModality,
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
  if (provider?.defaultModels && provider.defaultModels.length > 0) {
    return normalizeProviderModelEntries(provider.defaultModels);
  }

  if (provider?.defaultModelId) {
    return normalizeProviderModelEntries([provider.defaultModelId]);
  }

  return [];
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
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of models ?? []) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function normalizeProviderModelModalities(
  input?: Iterable<ProviderModelInputModality | null | undefined>,
): ProviderModelInputModality[] | undefined {
  const normalized = Array.from(new Set(
    Array.from(input ?? [])
      .filter((value): value is ProviderModelInputModality => value === 'text' || value === 'image'),
  ));

  if (normalized.length === 0 || (normalized.length === 1 && normalized[0] === 'text')) {
    return undefined;
  }

  return normalized.includes('image') ? ['text', 'image'] : ['text'];
}

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

export function normalizeProviderModelEntries(
  models?: Iterable<ProviderConfiguredModel | null | undefined>,
): ProviderModelEntry[] {
  const seen = new Set<string>();
  const results: ProviderModelEntry[] = [];

  for (const value of models ?? []) {
    const id = typeof value === 'string'
      ? value.trim()
      : (typeof value?.id === 'string' ? value.id.trim() : '');
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    if (typeof value === 'string') {
      results.push({
        id,
        name: id,
        reasoning: false,
      });
      continue;
    }

    const input = normalizeProviderModelModalities(value?.input);
    const contextWindow = normalizeOptionalPositiveInteger(value?.contextWindow);
    const maxTokens = normalizeOptionalPositiveInteger(value?.maxTokens);
    const {
      id: _ignoredId,
      name: _ignoredName,
      reasoning: _ignoredReasoning,
      input: _ignoredInput,
      contextWindow: _ignoredContextWindow,
      maxTokens: _ignoredMaxTokens,
      ...rest
    } = value ?? {};
    results.push({
      ...rest,
      id,
      name: typeof value?.name === 'string' && value.name.trim() ? value.name.trim() : id,
      reasoning: typeof value?.reasoning === 'boolean' ? value.reasoning : false,
      ...(input ? { input } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
  }

  return results;
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
  if (provider.models && provider.models.length > 0) {
    return normalizeProviderModelEntries(provider.models).map((model) => model.id);
  }

  return normalizeProviderModelList([
    provider.model,
    ...(provider.fallbackModels ?? []),
  ]);
}

export function getConfiguredProviderModelEntries(
  provider: Pick<ProviderConfig, 'models' | 'model' | 'fallbackModels'>,
): ProviderModelEntry[] {
  if (provider.models && provider.models.length > 0) {
    return normalizeProviderModelEntries(provider.models);
  }

  return normalizeProviderModelEntries([
    provider.model,
    ...(provider.fallbackModels ?? []),
  ]);
}
