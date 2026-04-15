import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySettingsSection } from '@/components/settings/MemorySettingsSection';

const hostApiFetchMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/api-client', () => ({
  toUserMessage: vi.fn((value: unknown) => String(value ?? '')),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const availableModels = [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini'],
  },
];

describe('MemorySettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides dedicated and summary model settings while their features are disabled', async () => {
    const snapshot = {
      availableModels,
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: false,
        model: null,
        modelMode: 'automatic',
        status: 'disabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: '0.5.2',
        requiredVersion: '0.5.2',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'disabled',
      },
    };
    hostApiFetchMock.mockImplementation(async () => snapshot);

    render(<MemorySettingsSection />);

    await screen.findByRole('heading', { name: 'memory.title' });

    expect(screen.queryByText('memory.cards.activeMemory.modelTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('memory.cards.activeMemory.modelDescription')).not.toBeInTheDocument();
    expect(screen.queryByText('memory.cards.losslessClaw.modelTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('memory.cards.losslessClaw.modelDescription')).not.toBeInTheDocument();
  });

  it('uses model-config style dropdown selectors instead of text inputs for custom models', async () => {
    const snapshot = {
      availableModels,
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4',
        modelMode: 'custom',
        status: 'enabled',
      },
      losslessClaw: {
        enabled: true,
        installedVersion: '0.5.2',
        requiredVersion: '0.5.2',
        summaryModel: 'openai/gpt-5.4-mini',
        summaryModelMode: 'custom',
        status: 'enabled',
      },
    };
    hostApiFetchMock.mockImplementation(async () => snapshot);

    render(<MemorySettingsSection />);

    await screen.findByText('memory.cards.activeMemory.modelTitle');

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(screen.getByText('memory.cards.activeMemory.modelDescription')).toBeInTheDocument();
    expect(screen.getByText('memory.cards.losslessClaw.modelDescription')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'memory.saveModel' })).not.toBeInTheDocument();
  });

  it('saves the selected active memory model through the memory settings API', async () => {
    const initialSnapshot = {
      availableModels,
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4',
        modelMode: 'custom',
        status: 'enabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: '0.5.2',
        requiredVersion: '0.5.2',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'disabled',
      },
    };
    const updatedSnapshot = {
      availableModels,
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4-mini',
        modelMode: 'custom',
        status: 'enabled',
      },
      losslessClaw: {
        enabled: false,
        installedVersion: '0.5.2',
        requiredVersion: '0.5.2',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'disabled',
      },
    };
    hostApiFetchMock.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return {
          success: true,
          settings: updatedSnapshot,
        };
      }

      return initialSnapshot;
    });

    render(<MemorySettingsSection />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'openai/gpt-5.4-mini' } });

    await waitFor(() => {
      expect(hostApiFetchMock.mock.calls).toEqual(expect.arrayContaining([
        [
          '/api/settings/memory',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({
              activeMemory: {
                model: 'openai/gpt-5.4-mini',
              },
            }),
          }),
        ],
      ]));
    });
  });
});
