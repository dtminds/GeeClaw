import {
  normalizeProviderModelList,
  providerModelEntriesEqual,
  type ProviderModelEntry,
} from '@/lib/providers';

export type ProviderModelCatalogDraft = {
  disabledBuiltinModelIds: string[];
  disabledCustomModelIds: string[];
  customModels: ProviderModelEntry[];
  builtinModelOverrides: ProviderModelEntry[];
};

export function providerModelCatalogDraftsEqual(
  left: ProviderModelCatalogDraft,
  right: ProviderModelCatalogDraft,
): boolean {
  return normalizeProviderModelList(left.disabledBuiltinModelIds).join('\u0000')
    === normalizeProviderModelList(right.disabledBuiltinModelIds).join('\u0000')
    && normalizeProviderModelList(left.disabledCustomModelIds).join('\u0000')
      === normalizeProviderModelList(right.disabledCustomModelIds).join('\u0000')
    && providerModelEntriesEqual(left.customModels, right.customModels)
    && providerModelEntriesEqual(left.builtinModelOverrides, right.builtinModelOverrides);
}
