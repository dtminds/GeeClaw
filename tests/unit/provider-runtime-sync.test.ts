import { describe, expect, it } from 'vitest';
import {
  getProviderCatalogModelIds,
  getProviderCatalogModelRefs,
} from '@electron/services/providers/provider-runtime-sync';
import type { ProviderConfig } from '@electron/utils/secure-storage';

function providerConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'geekai-account',
    name: 'GeekAI',
    type: 'geekai',
    enabled: true,
    createdAt: '2026-03-16T00:00:00.000Z',
    updatedAt: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider runtime model catalogs', () => {
  it('builds provider-owned model refs and ids from configured provider models', () => {
    const config = providerConfig({
      models: ['gpt-4.1', 'gpt-4.1-mini', 'geekai/gpt-4.1-nano', 'gpt-4.1-mini'],
    });

    expect(getProviderCatalogModelRefs(config)).toEqual([
      'geekai/gpt-4.1',
      'geekai/gpt-4.1-mini',
      'geekai/gpt-4.1-nano',
    ]);
    expect(getProviderCatalogModelIds(config)).toEqual([
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
    ]);
  });

  it('falls back to legacy model fields when models are not present', () => {
    const config = providerConfig({
      model: 'gpt-4.1',
      fallbackModels: ['gpt-4.1-mini'],
    });

    expect(getProviderCatalogModelIds(config)).toEqual([
      'gpt-4.1',
      'gpt-4.1-mini',
    ]);
  });
});
