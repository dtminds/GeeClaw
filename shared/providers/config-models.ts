import type {
  ProviderAccount,
  ProviderConfig,
  ProviderConfiguredModel,
  ProviderModelCatalogState,
  ProviderModelEntry,
  ProviderModelInputModality,
  ProviderTypeInfo,
} from './types';

type ProviderModelConfigShape = Pick<ProviderConfig, 'models' | 'model' | 'fallbackModels' | 'metadata'>
  | Pick<ProviderAccount, 'models' | 'model' | 'fallbackModels' | 'metadata'>;

type NormalizedProviderModelCatalogState = {
  disabledBuiltinModelIds: string[];
  disabledCustomModelIds: string[];
  customModels: ProviderModelEntry[];
  builtinModelOverrides: ProviderModelEntry[];
};

export function normalizeProviderModelList(
  models?: Iterable<string | null | undefined>,
): string[] {
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

export function getConfiguredProviderModels(
  config: ProviderModelConfigShape,
): string[] {
  if (config.models && config.models.length > 0) {
    return normalizeProviderModelEntries(config.models).map((model) => model.id);
  }

  return normalizeProviderModelList([
    config.model,
    ...(config.fallbackModels ?? []),
  ]);
}

export function getConfiguredProviderModelEntries(
  config: ProviderModelConfigShape,
): ProviderModelEntry[] {
  if (config.models && config.models.length > 0) {
    return normalizeProviderModelEntries(config.models);
  }

  return normalizeProviderModelEntries([
    config.model,
    ...(config.fallbackModels ?? []),
  ]);
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

export function normalizeProviderModelCatalogState(
  state?: ProviderModelCatalogState,
): NormalizedProviderModelCatalogState {
  return {
    disabledBuiltinModelIds: normalizeProviderModelList(state?.disabledBuiltinModelIds),
    disabledCustomModelIds: normalizeProviderModelList(state?.disabledCustomModelIds),
    customModels: normalizeProviderModelEntries(state?.customModels),
    builtinModelOverrides: normalizeProviderModelEntries(state?.builtinModelOverrides),
  };
}

export function resolveProviderModelCatalogState(
  config: ProviderModelConfigShape,
): NormalizedProviderModelCatalogState | null {
  const modelCatalog = config.metadata?.modelCatalog;
  if (!modelCatalog) {
    return null;
  }
  return normalizeProviderModelCatalogState(modelCatalog);
}

export function resolveEffectiveProviderModelEntries(
  config: ProviderModelConfigShape,
  provider: Pick<ProviderTypeInfo, 'defaultModels' | 'defaultModelId'> | undefined,
): ProviderModelEntry[] {
  const modelCatalog = resolveProviderModelCatalogState(config);
  if (!modelCatalog) {
    const legacyEntries = getConfiguredProviderModelEntries(config);
    if (legacyEntries.length > 0) {
      return legacyEntries;
    }
    return getDefaultProviderModelEntries(provider);
  }

  const builtinEntries = getDefaultProviderModelEntries(provider);
  const builtinOverrideMap = new Map(
    modelCatalog.builtinModelOverrides.map((model) => [model.id, model] as const),
  );
  const disabledBuiltinModelIds = new Set(modelCatalog.disabledBuiltinModelIds);
  const disabledCustomModelIds = new Set(modelCatalog.disabledCustomModelIds);
  const mergedBuiltinEntries = builtinEntries
    .map((model) => ({
      ...model,
      ...(builtinOverrideMap.get(model.id) ?? {}),
      id: model.id,
      name: (builtinOverrideMap.get(model.id)?.name ?? model.name) || model.id,
    }))
    .filter((model) => !disabledBuiltinModelIds.has(model.id));

  return normalizeProviderModelEntries([
    ...mergedBuiltinEntries,
    ...modelCatalog.customModels.filter((model) => !disabledCustomModelIds.has(model.id)),
  ]);
}
