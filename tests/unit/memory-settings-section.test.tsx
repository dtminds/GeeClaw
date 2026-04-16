import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySettingsSection } from '@/components/settings/MemorySettingsSection';

const hostApiFetchMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: vi.fn((_eventName: string, handler: (payload: unknown) => void) => {
    managedPluginStatusHandler = handler;
    return () => {
      if (managedPluginStatusHandler === handler) {
        managedPluginStatusHandler = null;
      }
    };
  }),
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

let managedPluginStatusHandler: ((payload: unknown) => void) | null = null;

describe('MemorySettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managedPluginStatusHandler = null;
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
        installJob: null,
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
        installJob: null,
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
        installJob: null,
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
        installJob: null,
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

  it('shows an install button for a missing lossless-claw plugin and triggers installation', async () => {
    const initialSnapshot = {
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
        installedVersion: null,
        requiredVersion: '0.9.1',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'not-installed',
        installJob: null,
      },
    };
    const updatedSnapshot = {
      ...initialSnapshot,
      losslessClaw: {
        ...initialSnapshot.losslessClaw,
        installedVersion: '0.9.1',
        status: 'disabled',
        installJob: null,
      },
    };

    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/memory/lossless-claw/install' && init?.method === 'POST') {
        return {
          success: true,
          settings: updatedSnapshot,
        };
      }
      return initialSnapshot;
    });

    render(<MemorySettingsSection />);

    const installButton = await screen.findByRole('button', { name: 'memory.actions.install' });
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/memory/lossless-claw/install', {
        method: 'POST',
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('memory.toast.installSuccess');
  });

  it('ignores late install progress events after lossless-claw has already refreshed to installed state', async () => {
    const initialSnapshot = {
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
        installedVersion: null,
        requiredVersion: '0.9.1',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'not-installed',
        installJob: null,
      },
    };
    const updatedSnapshot = {
      ...initialSnapshot,
      losslessClaw: {
        ...initialSnapshot.losslessClaw,
        installedVersion: '0.9.1',
        status: 'disabled',
        installJob: null,
      },
    };

    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/memory/lossless-claw/install' && init?.method === 'POST') {
        return {
          success: true,
          settings: updatedSnapshot,
        };
      }
      return initialSnapshot;
    });

    render(<MemorySettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'memory.actions.install' }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('memory.toast.installSuccess');
    });

    await act(async () => {
      managedPluginStatusHandler?.({
        pluginId: 'lossless-claw',
        displayName: 'lossless-claw',
        stage: 'installing',
        message: '正在安装 lossless-claw 依赖…',
        targetVersion: '0.9.1',
        installedVersion: null,
      });
    });

    expect(screen.queryByRole('button', { name: 'memory.actions.installInProgress' })).not.toBeInTheDocument();
    expect(screen.queryByText('正在安装 lossless-claw 依赖…')).not.toBeInTheDocument();
  });

  it('shows an upgrade button and in-progress install copy for an unavailable lossless-claw plugin', async () => {
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
        installedVersion: '0.9.2',
        requiredVersion: '0.9.1',
        summaryModel: null,
        summaryModelMode: 'automatic',
        status: 'unavailable',
        installJob: {
          pluginId: 'lossless-claw',
          displayName: 'lossless-claw',
          stage: 'installing',
          message: '正在安装 lossless-claw 依赖…',
          targetVersion: '0.9.1',
          installedVersion: '0.9.2',
        },
      },
    };
    hostApiFetchMock.mockResolvedValue(snapshot);

    render(<MemorySettingsSection />);

    await screen.findByRole('button', { name: 'memory.actions.upgradeInProgress' });
    expect(screen.getByText('memory.copy.losslessClaw.installingHint')).toBeInTheDocument();
    expect(screen.getByText('正在安装 lossless-claw 依赖…')).toBeInTheDocument();
  });
});
