import { describe, expect, it } from 'vitest';
import { buildProviderListItems, getProviderAccountRuntimeKey } from '@/lib/provider-accounts';
import type { ProviderAccount } from '@/lib/providers';

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'openai',
    vendorId: 'openai',
    label: 'OpenAI',
    authMode: 'api_key',
    enabled: true,
    isDefault: false,
    createdAt: '2026-03-27T00:00:00.000Z',
    updatedAt: '2026-03-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider account runtime namespaces', () => {
  it('uses browser OAuth runtime provider ids for OpenAI and Google accounts', () => {
    expect(getProviderAccountRuntimeKey(makeAccount({
      authMode: 'oauth_browser',
      metadata: { resourceUrl: 'openai-codex' },
    }))).toBe('openai-codex');

    expect(getProviderAccountRuntimeKey(makeAccount({
      id: 'google',
      vendorId: 'google',
      label: 'Google Gemini',
      authMode: 'oauth_browser',
    }))).toBe('google-gemini-cli');
  });

  it('keeps multi-instance and aliased provider keys aligned with runtime naming', () => {
    expect(getProviderAccountRuntimeKey(makeAccount({
      id: 'minimax-portal-cn',
      vendorId: 'minimax-portal-cn',
      label: 'MiniMax',
      authMode: 'oauth_device',
    }))).toBe('minimax-portal');

    expect(getProviderAccountRuntimeKey(makeAccount({
      id: 'custom-a1b2-c3d4',
      vendorId: 'custom',
      label: 'Custom API',
    }))).toBe('custom-customa1');
  });

  it('preserves runtime provider ids when building provider list items', () => {
    const items = buildProviderListItems([
      makeAccount({
        id: 'openai-oauth',
        label: 'OpenAI Codex',
        authMode: 'oauth_browser',
        models: ['gpt-5.3-codex'],
      }),
      makeAccount({
        id: 'openai-api',
        label: 'OpenAI API',
        models: ['gpt-5.2'],
      }),
    ], [], [], null);

    expect(items.map((item) => item.runtimeProviderId)).toEqual([
      'openai-codex',
      'openai',
    ]);
  });
});
