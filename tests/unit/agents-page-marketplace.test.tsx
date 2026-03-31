import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PRESET_INSTALL_STAGE_VISIBLE_MS, useAgentsStore } from '@/stores/agents';
import type { AgentPresetSummary, AgentSummary, AgentsSnapshot } from '@/types/agent';

const hostApiFetchMock = vi.hoisted(() => vi.fn());
const fetchChannelsMock = vi.fn(async () => undefined);

const translations: Record<string, string> = {
  title: 'Agents',
  subtitle: 'Manage agents',
  refresh: 'Refresh',
  addAgent: 'Add Agent',
  gatewayWarning: 'Gateway warning',
  defaultBadge: 'default',
  inherited: 'inherited',
  none: 'none',
  empty: 'No agents',
  settings: 'Settings',
  managedBadge: 'Managed',
  presetBadge: 'From Marketplace',
  'tabs.agents': 'My Agents',
  'tabs.marketplace': 'Marketplace',
  'marketplace.install': 'Install',
  'marketplace.installed': 'Installed',
  'marketplace.unavailable': 'Unavailable',
  'marketplace.installState.idle': 'Install',
  'marketplace.installState.preparing': 'Preparing preset',
  'marketplace.installState.installing_files': 'Installing files',
  'marketplace.installState.installing_skills': 'Installing skills',
  'marketplace.installState.finalizing': 'Finalizing setup',
  'marketplace.installState.completed': 'Installed',
  'marketplace.installState.failed': 'Install failed',
  'marketplace.installProgress': '{{progress}}%',
  'marketplace.viewDetails': 'View Details',
  'marketplace.availableOn': 'Available on {{platforms}}',
  'marketplace.platforms.all': 'All Platforms',
  'marketplace.platforms.darwin': 'macOS',
  'marketplace.platforms.win32': 'Windows',
  'marketplace.platforms.linux': 'Linux',
  'marketplace.detail.summary': 'Preset summary',
  'marketplace.detail.skills': 'Preset skills',
  'fields.agentId': 'Agent ID',
  'fields.workspace': 'Workspace',
};

const installedTrendFinderAgent: AgentSummary = {
  id: 'trendfinder',
  name: '趋势助手',
  isDefault: false,
  modelDisplay: 'gemini-3-flash-preview',
  inheritedModel: true,
  workspace: '~/geeclaw/workspace-trendfinder',
  agentDir: '~/.openclaw-geeclaw/agents/trendfinder/agent',
  mainSessionKey: 'agent:trendfinder:main',
  channelTypes: [],
  channelAccounts: [],
  source: 'preset',
  managed: true,
  presetId: 'trend-finder',
  lockedFields: ['id', 'workspace', 'persona'],
  canUnmanage: true,
  managedFiles: ['AGENTS.md'],
  skillScope: { mode: 'specified', skills: ['web-search'] },
  presetSkills: ['web-search'],
  canUseDefaultSkillScope: false,
};

const marketplacePresets: AgentPresetSummary[] = [
  {
    presetId: 'stock-expert',
    name: '股票助手',
    description: '追踪个股、公告和财报',
    emoji: '📈',
    category: 'finance',
    managed: true,
    agentId: 'stockexpert',
    skillScope: { mode: 'specified', skills: ['stock-analyzer', 'stock-announcements'] },
    presetSkills: ['stock-analyzer', 'stock-announcements'],
    managedFiles: ['AGENTS.md', 'SOUL.md'],
    platforms: ['darwin'],
    supportedOnCurrentPlatform: false,
  },
  {
    presetId: 'trend-finder',
    name: '趋势助手',
    description: '捕捉热点和市场趋势',
    emoji: '📊',
    category: 'research',
    managed: true,
    agentId: 'trendfinder',
    skillScope: { mode: 'specified', skills: ['web-search'] },
    presetSkills: ['web-search'],
    managedFiles: ['AGENTS.md'],
    supportedOnCurrentPlatform: true,
  },
  {
    presetId: 'alpha-researcher',
    name: 'Alpha Researcher',
    description: '套利信号与候选池',
    emoji: '🧪',
    category: 'research',
    managed: true,
    agentId: 'alpha-researcher',
    skillScope: { mode: 'specified', skills: ['web-search', 'stock-analyzer'] },
    presetSkills: ['web-search', 'stock-analyzer'],
    managedFiles: ['AGENTS.md', 'USER.md'],
    supportedOnCurrentPlatform: true,
  },
  {
    presetId: 'beta-scout',
    name: 'Beta Scout',
    description: 'Discover new market candidates',
    emoji: '🛰️',
    category: 'research',
    managed: true,
    agentId: 'beta-scout',
    skillScope: { mode: 'specified', skills: ['web-search', 'stock-analyzer'] },
    presetSkills: ['web-search', 'stock-analyzer'],
    managedFiles: ['AGENTS.md'],
    supportedOnCurrentPlatform: true,
  },
];

const baseSnapshot: AgentsSnapshot = {
  agents: [installedTrendFinderAgent],
  defaultAgentId: 'main',
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  explicitChannelAccountBindings: {},
};

function buildInstalledSnapshot(presetId: 'alpha-researcher' | 'beta-scout'): AgentsSnapshot {
  const preset = marketplacePresets.find((entry) => entry.presetId === presetId);
  if (!preset) {
    throw new Error(`Unknown preset ${presetId}`);
  }

  const installedAgent: AgentSummary = {
    id: preset.agentId,
    name: preset.name,
    isDefault: false,
    modelDisplay: 'gemini-3-flash-preview',
    inheritedModel: true,
    workspace: `~/geeclaw/workspace-${preset.agentId}`,
    agentDir: `~/.openclaw-geeclaw/agents/${preset.agentId}/agent`,
    mainSessionKey: `agent:${preset.agentId}:main`,
    channelTypes: [],
    channelAccounts: [],
    source: 'preset',
    managed: true,
    presetId: preset.presetId,
    lockedFields: ['id', 'workspace', 'persona'],
    canUnmanage: true,
    managedFiles: preset.managedFiles,
    skillScope: preset.skillScope,
    presetSkills: preset.presetSkills,
    canUseDefaultSkillScope: false,
  };

  return {
    ...baseSnapshot,
    agents: [...baseSnapshot.agents, installedAgent],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function clickAndFlush(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await flushPromises();
  });
}

async function flushUiTimers() {
  await act(async () => {
    vi.runOnlyPendingTimers();
    await flushPromises();
  });
}

function resetAgentsStore() {
  useAgentsStore.setState({
    agents: [],
    presets: [],
    defaultAgentId: 'main',
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    explicitChannelAccountBindings: {},
    installingPresetId: null,
    installStage: 'idle',
    installProgress: 0,
    loading: false,
    error: null,
  });
}

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; platforms?: string; progress?: number }) => {
      if (key === 'marketplace.availableOn') {
        return `Available on ${options?.platforms ?? ''}`;
      }
      if (key === 'marketplace.installProgress') {
        return `${options?.progress ?? 0}%`;
      }
      return translations[key] || key;
    },
    i18n: {
      resolvedLanguage: 'en',
      language: 'en',
    },
  }),
}));

vi.mock('@/components/ui/dialog', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  const DialogContext = React.createContext<{
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }>({ open: false });

  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) => (
      <DialogContext.Provider value={{ open, onOpenChange }}>
        {children}
      </DialogContext.Provider>
    ),
    DialogContent: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => {
      const context = React.useContext(DialogContext);
      if (!context.open) {
        return null;
      }
      return (
        <div role="dialog" className={className}>
          <button type="button" aria-label="Close" onClick={() => context.onOpenChange?.(false)}>
            Close
          </button>
          {children}
        </div>
      );
    },
    DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <h2 className={className}>{children}</h2>
    ),
    DialogDescription: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <p className={className}>{children}</p>
    ),
  };
});

vi.mock('@/stores/channels', () => ({
  useChannelsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      channels: [],
      fetchChannels: fetchChannelsMock,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      status: { state: 'running' },
    };
    return selector ? selector(state) : state;
  },
}));

describe('Agents marketplace view', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetAgentsStore();

    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/presets/install' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { presetId?: 'alpha-researcher' | 'beta-scout' };
        if (!body.presetId) {
          throw new Error('missing presetId');
        }
        return buildInstalledSnapshot(body.presetId);
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('allows installing supported presets from preset details while keeping unsupported presets unavailable', async () => {
    const deferredInstall = createDeferred<AgentsSnapshot>();
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/presets/install' && init?.method === 'POST') {
        return deferredInstall.promise;
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    const { Agents } = await import('@/pages/Agents');
    render(
      <TooltipProvider delayDuration={0}>
        <Agents />
      </TooltipProvider>,
    );

    await act(async () => {
      await flushPromises();
    });
    await flushUiTimers();

    expect(screen.getByText('趋势助手')).toBeInTheDocument();
    expect(fetchChannelsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Managed')).toBeInTheDocument();
    expect(screen.getByText('From Marketplace')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));

    const stockCard = screen.getByText('股票助手').closest('div.modal-section-surface');
    expect(stockCard).not.toBeNull();
    await clickAndFlush(within(stockCard as HTMLElement).getByText('View Details').closest('button') as HTMLElement);
    await flushUiTimers();

    const unsupportedDialog = screen.getByRole('dialog');
    expect(within(unsupportedDialog).getByText('Preset summary')).toBeInTheDocument();
    expect(within(unsupportedDialog).getByText('Preset skills')).toBeInTheDocument();
    expect(within(unsupportedDialog).getByText('stock-announcements')).toBeInTheDocument();
    expect(within(unsupportedDialog).getByText('macOS')).toBeInTheDocument();
    expect(within(unsupportedDialog).getByText('Available on macOS')).toBeInTheDocument();
    expect(within(unsupportedDialog).queryByText('Workspace')).not.toBeInTheDocument();
    expect(within(unsupportedDialog).getByRole('button', { name: 'Unavailable' })).toBeDisabled();

    const betaCard = screen.getByText('Beta Scout').closest('div.modal-section-surface');
    expect(betaCard).not.toBeNull();
    await clickAndFlush(within(betaCard as HTMLElement).getByText('View Details').closest('button') as HTMLElement);

    const supportedDialog = screen.getByRole('dialog');
    const supportedInstallButton = within(supportedDialog).getByRole('button', { name: 'Install' });
    expect(supportedInstallButton).toBeEnabled();
    await act(async () => {
      fireEvent.click(supportedInstallButton);
      await flushPromises();
      deferredInstall.resolve(buildInstalledSnapshot('beta-scout'));
      await flushPromises();
      vi.advanceTimersByTime((PRESET_INSTALL_STAGE_VISIBLE_MS * 4) + 700);
      await flushPromises();
    });

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/presets/install', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ presetId: 'beta-scout' }),
    }));
  });

  it('shows staged install progress in marketplace card and detail actions while install is in flight', async () => {
    const deferredInstall = createDeferred<AgentsSnapshot>();
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/presets/install' && init?.method === 'POST') {
        return deferredInstall.promise;
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    const { Agents } = await import('@/pages/Agents');
    render(
      <TooltipProvider delayDuration={0}>
        <Agents />
      </TooltipProvider>,
    );

    await act(async () => {
      await flushPromises();
    });
    await flushUiTimers();

    screen.getByText('趋势助手');
    fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));

    const alphaCard = screen.getByText('Alpha Researcher').closest('div.modal-section-surface');
    expect(alphaCard).not.toBeNull();
    await clickAndFlush(within(alphaCard as HTMLElement).getByRole('button', { name: 'Install' }));

    expect(within(alphaCard as HTMLElement).getByRole('button', { name: 'Preparing preset' })).toBeDisabled();
    expect(within(alphaCard as HTMLElement).getByText(/10%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await Promise.resolve();
    });
    expect(within(alphaCard as HTMLElement).getByRole('button', { name: 'Installing files' })).toBeDisabled();
    expect(within(alphaCard as HTMLElement).getByText(/35%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await Promise.resolve();
    });
    expect(within(alphaCard as HTMLElement).getByRole('button', { name: 'Installing skills' })).toBeDisabled();
    expect(within(alphaCard as HTMLElement).getByText(/70%/)).toBeInTheDocument();

    await clickAndFlush(within(alphaCard as HTMLElement).getByRole('button', { name: 'View Details' }));
    const detailDialog = screen.getByRole('dialog');
    expect(within(detailDialog).getByRole('button', { name: 'Installing skills' })).toBeDisabled();
    expect(within(detailDialog).getByText(/70%/)).toBeInTheDocument();

    await act(async () => {
      deferredInstall.resolve(buildInstalledSnapshot('alpha-researcher'));
      await flushPromises();
    });
    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });
    expect(within(alphaCard as HTMLElement).getByText('Finalizing setup').closest('button')).toBeDisabled();
    expect(within(alphaCard as HTMLElement).getByText(/90%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });
    expect(within(alphaCard as HTMLElement).getByText('Installed').closest('button')).toBeDisabled();
    expect(within(detailDialog).getByText('Installed').closest('button')).toBeDisabled();
    expect(within(detailDialog).getByText(/100%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(within(detailDialog).queryByText(/100%/)).not.toBeInTheDocument();
  });
});
