import type { ProviderAccount, ProviderConfig } from './types';

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

export function getConfiguredProviderModels(
  config: ProviderModelConfigShape,
): string[] {
  if (config.models && config.models.length > 0) {
    return normalizeProviderModelList(config.models);
  }

  return normalizeProviderModelList([
    config.model,
    ...(config.fallbackModels ?? []),
  ]);
}
