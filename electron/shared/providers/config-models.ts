import type {
  ProviderAccount,
  ProviderConfig,
  ProviderConfiguredModel,
  ProviderModelEntry,
  ProviderModelInputModality,
} from './types';

type ProviderModelConfigShape = Pick<ProviderConfig, 'models' | 'model' | 'fallbackModels'>
  | Pick<ProviderAccount, 'models' | 'model' | 'fallbackModels'>;

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
