import { describe, expect, it } from 'vitest';
import {
  getOpenClawProviderKey,
  getProviderCatalogModelIds,
  getProviderCatalogModelRefs,
} from '@electron/services/providers/provider-runtime-sync';
import type { ProviderConfig } from '@electron/utils/secure-storage';

function providerConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'geeclaw-account',
    name: 'GeeClaw',
    type: 'geeclaw',
    enabled: true,
    createdAt: '2026-03-16T00:00:00.000Z',
    updatedAt: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider runtime model catalogs', () => {
  it('builds provider-owned model refs and ids from configured provider models', () => {
    const config = providerConfig({
      models: ['gpt-4.1', 'gpt-4.1-mini', 'geeclaw/gpt-4.1-nano', 'gpt-4.1-mini'],
    });

    expect(getProviderCatalogModelRefs(config)).toEqual([
      'geeclaw/gpt-4.1',
      'geeclaw/gpt-4.1-mini',
      'geeclaw/gpt-4.1-nano',
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

  it('extracts ids from structured provider model entries', () => {
    const config = providerConfig({
      models: [
        { id: 'gpt-4.1', name: 'gpt-4.1', reasoning: false, input: ['text'] },
        { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini', reasoning: false, input: ['text', 'image'] },
        { id: 'geeclaw/gpt-4.1-nano', name: 'geeclaw/gpt-4.1-nano', reasoning: false },
      ],
    });

    expect(getProviderCatalogModelRefs(config)).toEqual([
      'geeclaw/gpt-4.1',
      'geeclaw/gpt-4.1-mini',
      'geeclaw/gpt-4.1-nano',
    ]);
    expect(getProviderCatalogModelIds(config)).toEqual([
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
    ]);
  });

  it('preserves existing multi-instance runtime provider keys', () => {
    expect(getOpenClawProviderKey('custom', 'custom-a1b2c3d4')).toBe('custom-a1b2c3d4');
    expect(getOpenClawProviderKey('ollama', 'ollama-a1b2c3d4')).toBe('ollama-a1b2c3d4');
  });

  it('uses an explicit custom runtime provider key from provider metadata', () => {
    const config = providerConfig({
      id: 'custom-account-id',
      type: 'custom',
      name: 'My Provider',
      metadata: {
        runtimeProviderKey: 'my-provider',
      },
      models: ['gpt-4.1'],
    });

    expect(getProviderCatalogModelRefs(config)).toEqual([
      'my-provider/gpt-4.1',
    ]);
    expect(getProviderCatalogModelIds(config)).toEqual([
      'gpt-4.1',
    ]);
  });
});
