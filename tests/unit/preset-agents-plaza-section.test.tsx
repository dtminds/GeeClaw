import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_INSTALL_STAGE_VISIBLE_MS, useAgentsStore } from '@/stores/agents';
import type { AgentPresetSummary, AgentSummary, AgentsSnapshot } from '@/types/agent';

const hostApiFetchMock = vi.hoisted(() => vi.fn());

const translations: Record<string, string> = {
  'presetPlaza.title': '智能体广场',
  'presetPlaza.description': '挑一个预设智能体，快速开始具体任务。',
  'presetPlaza.all': '全部智能体',
  'presetPlaza.categories.finance': '金融投资',
  'presetPlaza.categories.research': '研究分析',
  'presetPlaza.close': '关闭',
  'presetPlaza.summaryTitle': '预设摘要',
  'presetPlaza.skillsTitle': '预置技能',
  'presetPlaza.platformsTitle': '支持平台',
  'marketplace.install': '添加',
  'marketplace.installed': '已添加',
  'marketplace.unavailable': '当前不可用',
  'marketplace.installState.idle': '添加',
  'marketplace.installState.preparing': '准备预设',
  'marketplace.installState.installing_files': '安装文件',
  'marketplace.installState.installing_skills': '安装技能',
  'marketplace.installState.finalizing': '完成配置',
  'marketplace.installState.completed': '已添加',
  'marketplace.installState.failed': '安装失败',
  'marketplace.installProgress': '{{progress}}%',
  'marketplace.availableOn': '支持平台：{{platforms}}',
  'marketplace.platforms.all': '全平台',
  'marketplace.platforms.darwin': 'macOS',
  'marketplace.platforms.win32': 'Windows',
  'marketplace.platforms.linux': 'Linux',
  'fields.agentId': 'Agent ID',
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
];

const baseSnapshot: AgentsSnapshot = {
  agents: [installedTrendFinderAgent],
  defaultAgentId: 'main',
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  explicitChannelAccountBindings: {},
};

function buildInstalledSnapshot(presetId: 'alpha-researcher'): AgentsSnapshot {
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
    t: (key: string, options?: { platforms?: string; progress?: number }) => {
      if (key === 'marketplace.availableOn') {
        return `支持平台：${options?.platforms ?? ''}`;
      }
      if (key === 'marketplace.installProgress') {
        return `${options?.progress ?? 0}%`;
      }
      return translations[key] || key;
    },
    i18n: {
      resolvedLanguage: 'zh',
      language: 'zh',
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

describe('PresetAgentsPlazaSection', () => {
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
        const body = JSON.parse(String(init.body ?? '{}')) as { presetId?: 'alpha-researcher' };
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

  it('renders category chips and filters preset cards', async () => {
    const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
    render(<PresetAgentsPlazaSection />);

    await act(async () => {
      await flushPromises();
    });

    const categoryTablist = screen.getByRole('tablist', { name: '智能体广场' });
    const allTab = screen.getByRole('tab', { name: '全部智能体' });

    expect(screen.getByText('智能体广场')).toBeInTheDocument();
    expect(categoryTablist.className).toContain('border-b');
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(allTab.className).toContain('relative');
    expect(allTab.className).toContain('pb-2');
    expect(screen.getByText('股票助手')).toBeInTheDocument();
    expect(screen.getByText('趋势助手')).toBeInTheDocument();
    expect(screen.getByText('Alpha Researcher')).toBeInTheDocument();
    expect(screen.queryByText('macOS')).not.toBeInTheDocument();
    expect(screen.queryByText('全平台')).not.toBeInTheDocument();
    expect(screen.queryByText('当前不可用')).not.toBeInTheDocument();
    expect(screen.queryByText('已添加')).not.toBeInTheDocument();

    const firstTitle = screen.getByText('股票助手');
    const firstDescription = screen.getByText('追踪个股、公告和财报');
    expect(firstTitle.className).toContain('line-clamp-1');
    expect(firstTitle.className).toContain('min-h');
    expect(firstDescription.className).toContain('line-clamp-2');
    expect(firstDescription.className).toContain('min-h');

    fireEvent.click(screen.getByRole('tab', { name: '研究分析' }));

    expect(screen.getByRole('tab', { name: '研究分析' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('股票助手')).not.toBeInTheDocument();
    expect(screen.getByText('趋势助手')).toBeInTheDocument();
    expect(screen.getByText('Alpha Researcher')).toBeInTheDocument();
  });

  it('opens the preset detail dialog with aligned summary content and install progress', async () => {
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

    const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
    render(<PresetAgentsPlazaSection />);

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Alpha Researcher'));
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('预设摘要')).toBeInTheDocument();
    expect(within(dialog).getByText('预置技能')).toBeInTheDocument();
    expect(within(dialog).getByText('Agent ID')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '添加' })).toBeEnabled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '添加' }));
      await flushPromises();
    });

    expect(within(dialog).getByRole('button', { name: '准备预设' })).toBeDisabled();
    expect(within(dialog).getByText(/10%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    expect(within(dialog).getByRole('button', { name: '安装文件' })).toBeDisabled();
    expect(within(dialog).getByText(/35%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    expect(within(dialog).getByRole('button', { name: '安装技能' })).toBeDisabled();
    expect(within(dialog).getByText(/70%/)).toBeInTheDocument();

    await act(async () => {
      deferredInstall.resolve(buildInstalledSnapshot('alpha-researcher'));
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    expect(within(dialog).getByRole('button', { name: '完成配置' })).toBeDisabled();
    expect(within(dialog).getByText(/90%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    expect(within(dialog).getByRole('button', { name: '已添加' })).toBeDisabled();
    expect(within(dialog).getByText(/100%/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(700);
      await flushPromises();
    });
  });
});
