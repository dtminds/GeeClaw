import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { providerModelCatalogDraftsEqual } from '@/components/settings/provider-model-catalog';

const updateAccountMock = vi.fn(async () => undefined);
const refreshProviderSnapshotMock = vi.fn(async () => undefined);
const hostApiFetchMock = vi.fn();

const providerState = {
  statuses: [{
    id: 'openrouter',
    type: 'openrouter',
    name: 'OpenRouter',
    enabled: true,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    hasKey: true,
    keyMasked: 'sk-o***1234',
  }],
  accounts: [{
    id: 'openrouter',
    vendorId: 'openrouter',
    label: 'OpenRouter',
    authMode: 'api_key' as const,
    models: [],
    enabled: true,
    isDefault: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
  }],
  vendors: [{
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    placeholder: 'sk-or-v1-...',
    requiresApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'openai/gpt-5.4',
    defaultAuthMode: 'api_key' as const,
    supportedAuthModes: ['api_key'],
    supportsMultipleAccounts: false,
    category: 'compatible' as const,
  }],
  loading: false,
  refreshProviderSnapshot: refreshProviderSnapshotMock,
  createAccount: vi.fn(),
  removeAccount: vi.fn(),
  updateAccount: updateAccountMock,
  validateAccountApiKey: vi.fn(async () => ({ valid: true })),
};

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector?: (state: typeof providerState) => unknown) => (
    selector ? selector(providerState) : providerState
  ),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector?: (state: { devModeUnlocked: boolean }) => unknown) => (
    selector ? selector({ devModeUnlocked: false }) : { devModeUnlocked: false }
  ),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: vi.fn(() => () => undefined),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'zh-CN' },
    }),
  };
});

describe('ProvidersSettings model editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete providerState.accounts[0].metadata;
    hostApiFetchMock.mockResolvedValue({
      model: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      availableModels: [],
    });
  });

  it('adds a structured provider model through the modal and saves it on the account', async () => {
    const { ProvidersSettings } = await import('@/components/settings/ProvidersSettings');

    render(<ProvidersSettings />);

    await screen.findAllByText('OpenRouter');

    expect(screen.getByText('aiProviders.dialog.apiKey')).toBeInTheDocument();
    expect(screen.getByText('aiProviders.sections.model')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'aiProviders.models.addModel' }));
    });

    const dialog = await screen.findByRole('dialog', { name: 'aiProviders.models.dialog.addTitle' });
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('aiProviders.models.dialog.id'), {
        target: { value: 'google/gemini-3-flash-preview' },
      });
      fireEvent.click(within(dialog).getByLabelText('aiProviders.models.dialog.modalities.image'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'aiProviders.models.dialog.advanced' }));
    });

    await act(async () => {
      fireEvent.change(await within(dialog).findByLabelText('aiProviders.models.dialog.contextWindow'), {
        target: { value: '1048576' },
      });
      fireEvent.change(within(dialog).getByLabelText('aiProviders.models.dialog.maxTokens'), {
        target: { value: '65536' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'aiProviders.models.dialog.save' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'aiProviders.dialog.save' }));
    });

    expect(updateAccountMock).toHaveBeenCalledWith('openrouter', expect.objectContaining({
      model: undefined,
      models: [],
      fallbackModels: [],
      fallbackAccountIds: [],
      metadata: {
        modelCatalog: {
          disabledBuiltinModelIds: [],
          disabledCustomModelIds: [],
          builtinModelOverrides: [],
          customModels: [{
            id: 'google/gemini-3-flash-preview',
            name: 'google/gemini-3-flash-preview',
            reasoning: false,
            input: ['text', 'image'],
            contextWindow: 1048576,
            maxTokens: 65536,
          }],
        },
      },
    }), undefined);
  }, 10000);

  it('compares provider model catalog drafts by normalized content rather than JSON stringification', () => {
    expect(providerModelCatalogDraftsEqual(
      {
        disabledBuiltinModelIds: ['b', 'a', 'a'],
        disabledCustomModelIds: ['x'],
        builtinModelOverrides: [{ id: 'builtin-1', name: 'builtin-1', reasoning: false }],
        customModels: [{ id: 'custom-1', name: 'custom-1', reasoning: false }],
      },
      {
        disabledBuiltinModelIds: ['b', 'a'],
        disabledCustomModelIds: ['x'],
        builtinModelOverrides: [{ id: 'builtin-1', name: 'builtin-1', reasoning: false }],
        customModels: [{ id: 'custom-1', name: 'custom-1', reasoning: false }],
      },
    )).toBe(true);

    expect(providerModelCatalogDraftsEqual(
      {
        disabledBuiltinModelIds: [],
        disabledCustomModelIds: [],
        builtinModelOverrides: [],
        customModels: [{ id: 'custom-1', name: 'custom-1', reasoning: false }],
      },
      {
        disabledBuiltinModelIds: [],
        disabledCustomModelIds: [],
        builtinModelOverrides: [],
        customModels: [{ id: 'custom-2', name: 'custom-2', reasoning: false }],
      },
    )).toBe(false);
  });

  it('disables toggle and delete for models referenced by model config', async () => {
    providerState.accounts[0].metadata = {
      modelCatalog: {
        disabledBuiltinModelIds: [],
        disabledCustomModelIds: [],
        builtinModelOverrides: [],
        customModels: [{
          id: 'google/gemini-3-flash-preview',
          name: 'google/gemini-3-flash-preview',
          reasoning: false,
        }],
      },
    };
    hostApiFetchMock.mockResolvedValueOnce({
      model: {
        configured: true,
        primary: 'openrouter/google/gemini-3-flash-preview',
        fallbacks: ['openrouter/openai/gpt-5.4'],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      availableModels: [{
        providerId: 'openrouter',
        modelRefs: [
          'openrouter/openai/gpt-5.4',
          'openrouter/google/gemini-3-flash-preview',
        ],
      }],
    });

    const { ProvidersSettings } = await import('@/components/settings/ProvidersSettings');
    render(<ProvidersSettings />);

    await screen.findAllByText('OpenRouter');

    const switches = await screen.findAllByRole('switch');
    expect(switches[0]).toBeDisabled();
    expect(switches[1]).toBeDisabled();

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'aiProviders.models.editModel' }), {
        button: 0,
        ctrlKey: false,
      });
    });

    const removeItem = await screen.findByRole('menuitem', { name: 'aiProviders.models.removeModel' });
    expect(removeItem).toHaveAttribute('data-disabled');
  }, 10000);

  it('allows saving when all provider models are disabled', async () => {
    providerState.accounts[0].metadata = {
      modelCatalog: {
        disabledBuiltinModelIds: [],
        disabledCustomModelIds: [],
        builtinModelOverrides: [],
        customModels: [{
          id: 'google/gemini-3-flash-preview',
          name: 'google/gemini-3-flash-preview',
          reasoning: false,
        }],
      },
    };

    const { ProvidersSettings } = await import('@/components/settings/ProvidersSettings');
    render(<ProvidersSettings />);

    await screen.findAllByText('OpenRouter');

    const toggles = screen.getAllByRole('switch', { name: 'aiProviders.list.enabled' });
    await act(async () => {
      fireEvent.click(toggles[toggles.length - 1]);
    });

    const saveButton = screen.getByRole('button', { name: 'aiProviders.dialog.save' });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(updateAccountMock).toHaveBeenCalledWith('openrouter', expect.objectContaining({
      model: undefined,
      models: [],
      fallbackModels: [],
      fallbackAccountIds: [],
      metadata: {
        modelCatalog: {
          disabledBuiltinModelIds: [],
          disabledCustomModelIds: ['google/gemini-3-flash-preview'],
          builtinModelOverrides: [],
          customModels: [{
            id: 'google/gemini-3-flash-preview',
            name: 'google/gemini-3-flash-preview',
            reasoning: false,
          }],
        },
      },
    }), undefined);
  });

  it('uses segmented protocol control when editing an existing custom provider', async () => {
    providerState.statuses = [{
      id: 'custom-example',
      type: 'custom',
      name: 'Custom',
      enabled: true,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      hasKey: true,
      keyMasked: 'sk-c***1234',
    }];
    providerState.accounts = [{
      id: 'custom-example',
      vendorId: 'custom',
      label: 'Custom',
      authMode: 'api_key',
      apiProtocol: 'openai-completions',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      enabled: true,
      isDefault: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    }];
    providerState.vendors = [{
      id: 'custom',
      name: 'Custom',
      icon: '⚙️',
      placeholder: 'API key...',
      requiresApiKey: true,
      showBaseUrl: true,
      showModelId: true,
      modelIdPlaceholder: 'your-provider/model-id',
      defaultAuthMode: 'api_key',
      supportedAuthModes: ['api_key'],
      supportsMultipleAccounts: true,
      category: 'custom',
      modelCatalogMode: 'runtime-editable',
    }];

    const { ProvidersSettings } = await import('@/components/settings/ProvidersSettings');
    render(<ProvidersSettings />);

    await screen.findAllByText('Custom');

    const protocolGroup = screen.getByRole('group', { name: 'aiProviders.dialog.protocol' });
    expect(protocolGroup).toBeInTheDocument();
    expect(within(protocolGroup).getByRole('button', { name: 'aiProviders.protocols.openaiCompletions' })).toBeInTheDocument();
    expect(within(protocolGroup).getByRole('button', { name: 'aiProviders.protocols.openaiResponses' })).toBeInTheDocument();
    expect(within(protocolGroup).getByRole('button', { name: 'aiProviders.protocols.anthropic' })).toBeInTheDocument();
  });
});
