import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
  PRESET_INSTALL_STAGE_VISIBLE_MS,
  useAgentsStore,
} from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { AppError } from '@/lib/error-model';
import type { AgentMarketplaceCompletion, AgentPresetSummary, AgentSummary, AgentsSnapshot } from '@/types/agent';

const hostApiFetchMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const openAgentMainSessionMock = vi.hoisted(() => vi.fn(async () => undefined));
const queueComposerSeedMock = vi.hoisted(() => vi.fn());

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
  'marketplace.install': '一键雇佣',
  'marketplace.update': '更新',
  'marketplace.goSend': '去发送',
  'marketplace.goChat': '去聊聊',
  'marketplace.openingChat': '正在打开',
  'marketplace.openChatErrors.gateway': 'Gateway 服务不可用，请稍后重试',
  'marketplace.dismiss': '稍后',
  'marketplace.postInstallTitle': '安装成功',
  'marketplace.postUpdateTitle': '更新成功',
  'marketplace.postInstallDescription': '这个官方 Agent 已准备好。',
  'marketplace.postUpdateDescription': '这个官方 Agent 已更新到最新版本。',
  'marketplace.postInstallPromptLabel': '发送以下消息给 Agent',
  'marketplace.updateConfirmTitle': '确认更新',
  'marketplace.updateConfirmMessage': '更新会覆盖该官方 Agent 的受管 files 和 skills，不会重新初始化 workspace，也不会影响聊天记录。',
  'marketplace.updateConfirmConfirm': '确认更新',
  'marketplace.updateConfirmCancel': '取消',
  'marketplace.installed': '已添加',
  'marketplace.unavailable': '当前不可用',
  'marketplace.requirementsMissing': '缺少依赖',
  'marketplace.installState.idle': '一键雇佣',
  'marketplace.installState.preparing': '准备预设',
  'marketplace.installState.installing_files': '安装文件',
  'marketplace.installState.installing_skills': '安装技能',
  'marketplace.installState.finalizing': '完成配置',
  'marketplace.installState.completed': '已添加',
  'marketplace.installState.failed': '安装失败',
  'marketplace.installProgress': '{{progress}}%',
  'marketplace.availableOn': '支持平台：{{platforms}}',
  'marketplace.detail.requirements': '安装前依赖',
  'marketplace.requirements.missingBin': '缺少依赖：{{items}}',
  'marketplace.requirements.missingBins': '缺少依赖：{{items}}',
  'marketplace.requirements.missingAnyBins': '需要以下依赖之一：{{items}}',
  'marketplace.requirements.missingEnv': '缺少环境变量：{{items}}',
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
  managementSource: 'marketplace',
  managed: true,
  packageVersion: '1.0.0',
  lockedFields: ['id', 'workspace', 'persona'],
  canUnmanage: true,
  managedFiles: ['AGENTS.md'],
  skillScope: { mode: 'specified', skills: ['web-search'] },
  presetSkills: ['web-search'],
  canUseDefaultSkillScope: false,
};

const marketplacePresets: AgentPresetSummary[] = [
  {
    source: 'marketplace',
    name: '股票助手',
    description: '追踪个股、公告和财报',
    emoji: '📈',
    category: 'finance',
    managed: true,
    agentId: 'stockexpert',
    latestVersion: '1.2.3',
    installed: false,
    hasUpdate: false,
    skillScope: { mode: 'specified', skills: ['stock-analyzer', 'stock-announcements'] },
    presetSkills: ['stock-analyzer', 'stock-announcements'],
    managedFiles: ['AGENTS.md', 'SOUL.md'],
    platforms: ['darwin'],
    installable: false,
    supportedOnCurrentPlatform: false,
    supportedOnCurrentAppVersion: true,
  },
  {
    source: 'marketplace',
    name: '趋势助手',
    description: '捕捉热点和市场趋势',
    emoji: '📊',
    category: 'research',
    managed: true,
    agentId: 'trendfinder',
    latestVersion: '1.1.0',
    installed: true,
    installedVersion: '1.0.0',
    hasUpdate: true,
    skillScope: { mode: 'specified', skills: ['web-search'] },
    presetSkills: [],
    managedFiles: [],
    installable: true,
    supportedOnCurrentPlatform: true,
    supportedOnCurrentAppVersion: true,
  },
  {
    source: 'marketplace',
    name: 'Alpha Researcher',
    description: '套利信号与候选池',
    emoji: '🧪',
    category: 'research',
    managed: true,
    agentId: 'alpha-researcher',
    latestVersion: '2.4.0',
    installed: false,
    hasUpdate: false,
    skillScope: { mode: 'specified', skills: ['web-search', 'stock-analyzer'] },
    presetSkills: ['web-search', 'stock-analyzer'],
    managedFiles: ['AGENTS.md', 'USER.md'],
    installable: true,
    supportedOnCurrentPlatform: true,
    supportedOnCurrentAppVersion: true,
  },
  {
    source: 'marketplace',
    name: 'Notion Ops',
    description: '依赖外部命令和 API Key 的工作流 Agent',
    emoji: '🗂️',
    category: 'research',
    managed: true,
    agentId: 'notion-ops',
    latestVersion: '0.8.1',
    installed: false,
    hasUpdate: false,
    skillScope: { mode: 'default' },
    presetSkills: [],
    managedFiles: [],
    installable: true,
    supportedOnCurrentPlatform: true,
    supportedOnCurrentAppVersion: true,
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

function buildInstalledSnapshot(agentId: 'alpha-researcher'): AgentsSnapshot {
  const preset = marketplacePresets.find((entry) => entry.agentId === agentId);
  if (!preset) {
    throw new Error(`Unknown preset ${agentId}`);
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
    managementSource: 'marketplace',
    managed: true,
    packageVersion: preset.latestVersion,
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

async function finishMarketplaceInstall(
  deferredInstall: { resolve: (value: AgentsSnapshot & { completion: AgentMarketplaceCompletion }) => void },
  snapshot: AgentsSnapshot,
  completion: AgentMarketplaceCompletion,
) {
  await act(async () => {
    deferredInstall.resolve({ ...snapshot, completion });
    await flushPromises();
  });

  for (const step of [
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_STAGE_VISIBLE_MS,
    PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
  ]) {
    await act(async () => {
      vi.advanceTimersByTime(step);
      await flushPromises();
    });
  }
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
    marketplaceCompletion: null,
    loading: false,
    error: null,
  });
}

function resetGatewayStore() {
  useGatewayStore.setState({
    ...useGatewayStore.getState(),
    status: {
      state: 'running',
      port: 28788,
    },
    health: null,
    isInitialized: true,
    lastError: null,
  });
}

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      openAgentMainSession: openAgentMainSessionMock,
      queueComposerSeed: queueComposerSeedMock,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: { platforms?: string; progress?: number; reason?: string }) => {
      if (key === 'marketplace.availableOn') {
        return `支持平台：${options?.platforms ?? ''}`;
      }
      if (key === 'marketplace.installProgress') {
        return `${options?.progress ?? 0}%`;
      }
      if (key === 'marketplace.openChatFailed') {
        return `打开会话失败：${options?.reason ?? ''}`;
      }
      if (key === 'marketplace.requirements.missingBin' || key === 'marketplace.requirements.missingBins') {
        return `缺少依赖：${(options as { items?: string })?.items ?? ''}`;
      }
      if (key === 'marketplace.requirements.missingAnyBins') {
        return `需要以下依赖之一：${(options as { items?: string })?.items ?? ''}`;
      }
      if (key === 'marketplace.requirements.missingEnv') {
        return `缺少环境变量：${(options as { items?: string })?.items ?? ''}`;
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
    navigateMock.mockReset();
    openAgentMainSessionMock.mockReset().mockResolvedValue(undefined);
    queueComposerSeedMock.mockReset();
    resetAgentsStore();
    resetGatewayStore();

    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/install' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { agentId?: 'alpha-researcher' };
        if (!body.agentId) {
          throw new Error('missing agentId');
        }
        return {
          ...buildInstalledSnapshot(body.agentId),
          completion: {
            operation: 'install',
            agentId: body.agentId,
            promptText: 'Please review the installed workspace.',
          },
        };
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });
  });

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers();
      await flushPromises();
    });
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

  it('stores marketplace-backed preset summaries for the plaza', async () => {
    await act(async () => {
      await useAgentsStore.getState().fetchPresets();
    });

    expect(useAgentsStore.getState().presets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'trendfinder',
        installed: true,
        installedVersion: '1.0.0',
        latestVersion: '1.1.0',
        hasUpdate: true,
        supportedOnCurrentAppVersion: true,
      }),
      expect.objectContaining({
        source: 'marketplace',
        agentId: 'alpha-researcher',
        installed: false,
        latestVersion: '2.4.0',
        hasUpdate: false,
      }),
    ]));
  });

  it('opens the preset detail dialog with aligned summary content and install progress', async () => {
    const deferredInstall = createDeferred<AgentsSnapshot & { completion: AgentMarketplaceCompletion }>();
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/install' && init?.method === 'POST') {
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
    expect(within(dialog).queryByText('预设摘要')).not.toBeInTheDocument();
    expect(within(dialog).getByText('预置技能')).toBeInTheDocument();
    expect(within(dialog).getByText('Agent ID')).toBeInTheDocument();
    const infoSections = dialog.querySelectorAll('.modal-section-surface');
    expect(infoSections).toHaveLength(2);
    expect(infoSections[0]?.textContent).toContain('Agent ID');
    expect(infoSections[0]?.textContent).toContain('全平台');
    const platformText = within(infoSections[0] as HTMLElement).getByText('全平台');
    expect(platformText.className).not.toContain('inline-flex');
    const actionButton = within(dialog).getByRole('button', { name: '一键雇佣' });
    expect(actionButton).toBeEnabled();
    expect(actionButton.className).toContain('w-full');

    await act(async () => {
      fireEvent.click(actionButton);
      await flushPromises();
    });

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/marketplace/install', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ agentId: 'alpha-researcher' }),
    }));

    const progressBlock = dialog.querySelector('.preset-install-progress');
    expect(progressBlock?.className).toContain('w-full');
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

    await finishMarketplaceInstall(
      deferredInstall,
      buildInstalledSnapshot('alpha-researcher'),
      {
        operation: 'install',
        agentId: 'alpha-researcher',
        promptText: 'Please review the installed workspace.',
      },
    );

    expect(within(dialog).getByRole('button', { name: '已添加' })).toBeDisabled();
    expect(useAgentsStore.getState().marketplaceCompletion).toEqual({
      operation: 'install',
      agentId: 'alpha-researcher',
      promptText: 'Please review the installed workspace.',
    });
    expect(screen.getByText('安装成功')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去发送' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(700);
      await flushPromises();
    });
  });

  it('keeps the preset in finalizing state until the gateway finishes reloading', async () => {
    const deferredInstall = createDeferred<AgentsSnapshot & { completion: AgentMarketplaceCompletion }>();
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/install' && init?.method === 'POST') {
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

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '一键雇佣' }));
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      deferredInstall.resolve({
        ...buildInstalledSnapshot('alpha-researcher'),
        completion: {
          operation: 'install',
          agentId: 'alpha-researcher',
        },
      });
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_STAGE_VISIBLE_MS);
      await flushPromises();
    });

    await act(async () => {
      useGatewayStore.setState({
        ...useGatewayStore.getState(),
        status: {
          state: 'reconnecting',
          port: 28788,
        },
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS + 1000);
      await flushPromises();
    });

    expect(within(dialog).getByRole('button', { name: '完成配置' })).toBeDisabled();
    expect(within(dialog).queryByText(/100%/)).not.toBeInTheDocument();

    await act(async () => {
      useGatewayStore.setState({
        ...useGatewayStore.getState(),
        status: {
          state: 'running',
          port: 28788,
        },
      });
      await flushPromises();
    });

    expect(useAgentsStore.getState().installStage).toBe('completed');
    expect(useAgentsStore.getState().installProgress).toBe(100);
    expect(within(dialog).getByRole('button', { name: '已添加' })).toBeDisabled();
    expect(screen.getByText('安装成功')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去聊聊' })).toBeInTheDocument();
  });

  it('allows installed marketplace agents with updates to trigger the update flow', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/update' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { agentId?: string };
        return {
          ...baseSnapshot,
          agents: [{
            ...installedTrendFinderAgent,
            packageVersion: '1.1.0',
          }],
          completion: {
            operation: 'update',
            agentId: body.agentId ?? 'trendfinder',
            promptText: 'Summarize the marketplace changes.',
          },
        };
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    await act(async () => {
      const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
      render(<PresetAgentsPlazaSection />);
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('趋势助手'));
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '更新' })).toBeEnabled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '更新' }));
      await flushPromises();
    });

    const confirmDialog = screen.getByRole('dialog', { name: '确认更新' });

    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole('button', { name: '确认更新' }));
      await flushPromises();
    });

    for (const step of [
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
    ]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        await flushPromises();
      });
    }

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/marketplace/update', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ agentId: 'trendfinder' }),
    }));
    expect(useAgentsStore.getState().marketplaceCompletion).toEqual({
      operation: 'update',
      agentId: 'trendfinder',
      promptText: 'Summarize the marketplace changes.',
    });
    expect(screen.getByText('更新成功')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去发送' })).toBeInTheDocument();
    expect(useAgentsStore.getState().presets.find((preset) => preset.agentId === 'trendfinder')).toMatchObject({
      installed: true,
      installedVersion: '1.1.0',
      hasUpdate: false,
    });
  });

  it('prefills chat and navigates when the success dialog sends the follow-up prompt', async () => {
    const deferredInstall = createDeferred<AgentsSnapshot & { completion: AgentMarketplaceCompletion }>();
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/install' && init?.method === 'POST') {
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

    const detailDialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(detailDialog).getByRole('button', { name: '一键雇佣' }));
      await flushPromises();
    });

    await finishMarketplaceInstall(
      deferredInstall,
      buildInstalledSnapshot('alpha-researcher'),
      {
        operation: 'install',
        agentId: 'alpha-researcher',
        promptText: 'Please review the installed workspace.',
      },
    );

    await act(async () => {
      await flushPromises();
    });

    expect(useAgentsStore.getState().marketplaceCompletion).toEqual({
      operation: 'install',
      agentId: 'alpha-researcher',
      promptText: 'Please review the installed workspace.',
    });
    expect(screen.getByText('安装成功')).toBeInTheDocument();
    expect(screen.getByText('Please review the installed workspace.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '去发送' }));
      await flushPromises();
    });

    expect(openAgentMainSessionMock).toHaveBeenCalledWith('alpha-researcher');
    expect(queueComposerSeedMock).toHaveBeenCalledWith('Please review the installed workspace.');
    expect(navigateMock).toHaveBeenCalledWith('/chat');
    expect(useAgentsStore.getState().marketplaceCompletion).toBeNull();
  });

  it('shows marketplace install failures inside the detail dialog', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/install' && init?.method === 'POST') {
        throw new Error('zip download failed');
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

    const detailDialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(detailDialog).getByRole('button', { name: '一键雇佣' }));
      await flushPromises();
    });

    for (const step of [
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
    ]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        await flushPromises();
      });
    }

    expect(within(screen.getByRole('dialog')).getByText('Error: zip download failed')).toBeInTheDocument();
  });

  it('falls back to go-chat when the success dialog has no prompt text', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/update' && init?.method === 'POST') {
        return {
          ...baseSnapshot,
          agents: [{
            ...installedTrendFinderAgent,
            packageVersion: '1.1.0',
          }],
          completion: {
            operation: 'update',
            agentId: 'trendfinder',
          },
        };
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
    render(<PresetAgentsPlazaSection />);

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('趋势助手'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新' }));
      await flushPromises();
    });

    const confirmDialog = screen.getByRole('dialog', { name: '确认更新' });
    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole('button', { name: '确认更新' }));
      await flushPromises();
    });

    for (const step of [
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
    ]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        await flushPromises();
      });
    }

    expect(screen.getByText('更新成功')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去聊聊' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '去聊聊' }));
      await flushPromises();
    });

    expect(openAgentMainSessionMock).toHaveBeenCalledWith('trendfinder');
    expect(queueComposerSeedMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/chat');
    expect(useAgentsStore.getState().marketplaceCompletion).toBeNull();
  });

  it('shows a pending state after the success dialog starts opening chat', async () => {
    const deferredOpen = createDeferred<void>();
    openAgentMainSessionMock.mockReturnValueOnce(deferredOpen.promise);
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/update' && init?.method === 'POST') {
        return {
          ...baseSnapshot,
          agents: [{
            ...installedTrendFinderAgent,
            packageVersion: '1.1.0',
          }],
          completion: {
            operation: 'update',
            agentId: 'trendfinder',
          },
        };
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
    render(<PresetAgentsPlazaSection />);

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('趋势助手'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新' }));
      await flushPromises();
    });

    const confirmDialog = screen.getByRole('dialog', { name: '确认更新' });
    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole('button', { name: '确认更新' }));
      await flushPromises();
    });

    for (const step of [
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
    ]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        await flushPromises();
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '去聊聊' }));
    });

    const pendingButton = screen.getByRole('button', { name: '正在打开' });
    expect(pendingButton).toBeDisabled();
    expect(openAgentMainSessionMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(pendingButton);
      await flushPromises();
    });

    expect(openAgentMainSessionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferredOpen.resolve();
      await flushPromises();
    });

    expect(navigateMock).toHaveBeenCalledWith('/chat');
    expect(useAgentsStore.getState().marketplaceCompletion).toBeNull();
  });

  it('surfaces structured errors when the success dialog cannot open chat', async () => {
    openAgentMainSessionMock.mockRejectedValueOnce(
      new AppError('GATEWAY', 'gateway startup failed while opening chat'),
    );
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents') {
        return baseSnapshot;
      }
      if (path === '/api/agents/presets') {
        return { success: true, presets: marketplacePresets };
      }
      if (path === '/api/agents/marketplace/update' && init?.method === 'POST') {
        return {
          ...baseSnapshot,
          agents: [{
            ...installedTrendFinderAgent,
            packageVersion: '1.1.0',
          }],
          completion: {
            operation: 'update',
            agentId: 'trendfinder',
          },
        };
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
    render(<PresetAgentsPlazaSection />);

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('趋势助手'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新' }));
      await flushPromises();
    });

    const confirmDialog = screen.getByRole('dialog', { name: '确认更新' });
    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole('button', { name: '确认更新' }));
      await flushPromises();
    });

    for (const step of [
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_STAGE_VISIBLE_MS,
      PRESET_INSTALL_GATEWAY_SETTLE_GRACE_MS,
    ]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
        await flushPromises();
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '去聊聊' }));
      await flushPromises();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('打开会话失败：Gateway 服务不可用，请稍后重试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('gateway startup failed');
    expect(screen.getByRole('button', { name: '去聊聊' })).toBeEnabled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useAgentsStore.getState().marketplaceCompletion).toMatchObject({
      operation: 'update',
      agentId: 'trendfinder',
    });
  });

  it('shows install CTA when catalog-backed summaries omit requirements and preset skills', async () => {
    const { PresetAgentsPlazaSection } = await import('@/components/dashboard/PresetAgentsPlazaSection');
    render(<PresetAgentsPlazaSection />);

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Notion Ops'));
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('预置技能')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('安装前依赖')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '一键雇佣' })).toBeEnabled();
  });
});
