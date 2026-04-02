import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = {
  schemaVersion: 1,
  providers: {
    'qwen-account': {
      id: 'qwen-account',
      name: 'Qwen',
      type: 'qwen-portal',
      model: 'qwen-portal/coder-model',
      models: ['qwen-portal/coder-model'],
      fallbackModels: ['qwen-portal/coder-model'],
      enabled: true,
      createdAt: '2026-03-30T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z',
    },
  } as Record<string, unknown>,
  providerAccounts: {
    'qwen-account': {
      id: 'qwen-account',
      vendorId: 'qwen-portal',
      label: 'Qwen',
      authMode: 'oauth_device',
      model: 'qwen-portal/coder-model',
      models: ['qwen-portal/coder-model'],
      fallbackModels: ['qwen-portal/coder-model'],
      enabled: true,
      isDefault: true,
      createdAt: '2026-03-30T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z',
    },
  } as Record<string, unknown>,
  defaultProvider: 'qwen-account',
  defaultProviderAccountId: 'qwen-account',
};

const getMock = vi.fn((key: keyof typeof storeState) => storeState[key]);
const setMock = vi.fn((key: keyof typeof storeState, value: unknown) => {
  storeState[key] = value as never;
});

vi.mock('@electron/services/providers/store-instance', () => ({
  getGeeClawProviderStore: async () => ({
    get: getMock,
    set: setMock,
  }),
}));

describe('provider store migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storeState.schemaVersion = 1;
    storeState.providers = {
      'qwen-account': {
        id: 'qwen-account',
        name: 'Qwen',
        type: 'qwen-portal',
        model: 'qwen-portal/coder-model',
        models: ['qwen-portal/coder-model'],
        fallbackModels: ['qwen-portal/coder-model'],
        enabled: true,
        createdAt: '2026-03-30T00:00:00.000Z',
        updatedAt: '2026-03-30T00:00:00.000Z',
      },
    };
    storeState.providerAccounts = {
      'qwen-account': {
        id: 'qwen-account',
        vendorId: 'qwen-portal',
        label: 'Qwen',
        authMode: 'oauth_device',
        model: 'qwen-portal/coder-model',
        models: ['qwen-portal/coder-model'],
        fallbackModels: ['qwen-portal/coder-model'],
        enabled: true,
        isDefault: true,
        createdAt: '2026-03-30T00:00:00.000Z',
        updatedAt: '2026-03-30T00:00:00.000Z',
      },
    };
    storeState.defaultProvider = 'qwen-account';
    storeState.defaultProviderAccountId = 'qwen-account';
  });

  it('migrates legacy qwen portal accounts to modelstudio defaults', async () => {
    const { ensureProviderStoreMigrated } = await import('@electron/services/providers/provider-migration');

    await ensureProviderStoreMigrated();

    expect((storeState.providers['qwen-account'] as Record<string, unknown>).type).toBe('modelstudio');
    expect((storeState.providers['qwen-account'] as Record<string, unknown>).model).toBe('modelstudio/qwen3.5-plus');
    expect((storeState.providers['qwen-account'] as Record<string, unknown>).models).toEqual(['modelstudio/qwen3.5-plus']);

    expect((storeState.providerAccounts['qwen-account'] as Record<string, unknown>).vendorId).toBe('modelstudio');
    expect((storeState.providerAccounts['qwen-account'] as Record<string, unknown>).authMode).toBe('api_key');
    expect((storeState.providerAccounts['qwen-account'] as Record<string, unknown>).model).toBe('modelstudio/qwen3.5-plus');
    expect(storeState.schemaVersion).toBeGreaterThanOrEqual(2);
  });
});
