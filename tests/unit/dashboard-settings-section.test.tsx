import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardSettingsSection } from '@/components/settings/DashboardSettingsSection';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { useSkillsStore } from '@/stores/skills';

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'gateway') return 'OpenClaw 服务';
      if (key === 'channels') return '频道';
      if (key === 'skills') return '技能';
      if (key === 'uptime') return '运行时间';
      if (key === 'connectedOf') return `${String(options?.connected ?? 0)} / ${String(options?.total ?? 0)} 已连接`;
      if (key === 'enabledOf') return `${String(options?.enabled ?? 0)} / ${String(options?.total ?? 0)} 已启用`;
      if (key === 'sinceRestart') return '自上次重启';
      if (key === 'gatewayNotRunning') return 'OpenClaw 服务未运行';
      if (key === 'port') return `端口: ${String(options?.port ?? '')}`;
      if (key === 'pid') return `PID: ${String(options?.pid ?? '')}`;
      return key;
    },
  }),
}));

describe('DashboardSettingsSection skills card', () => {
  const initialAgentsState = useAgentsStore.getState();
  const initialChannelsState = useChannelsStore.getState();
  const initialGatewayState = useGatewayStore.getState();
  const initialSkillsState = useSkillsStore.getState();

  beforeEach(() => {
    useGatewayStore.setState({
      ...initialGatewayState,
      status: {
        ...initialGatewayState.status,
        state: 'running',
        port: 28788,
      },
    });
    useChannelsStore.setState({
      ...initialChannelsState,
      channels: [],
      fetchChannels: vi.fn().mockResolvedValue(undefined),
    });
    useSkillsStore.setState({
      ...initialSkillsState,
      skills: Array.from({ length: 120 }, (_, index) => ({
        id: `skill-${index + 1}`,
        slug: `skill-${index + 1}`,
        name: `Skill ${index + 1}`,
        description: '',
        enabled: true,
        configuredEnabled: true,
        eligible: true,
        blockedByAllowlist: false,
        hidden: false,
        icon: '📦',
        isBundled: false,
        isCore: false,
        source: 'openclaw-managed',
      })),
      fetchSkills: vi.fn().mockResolvedValue(undefined),
    });
    useAgentsStore.setState({
      ...initialAgentsState,
      agents: [{
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5.4',
        inheritedModel: false,
        workspace: '/tmp/workspace-main',
        agentDir: '/tmp/workspace-main/.agent',
        mainSessionKey: 'main',
        channelTypes: [],
        channelAccounts: [],
        source: 'custom',
        managed: false,
        lockedFields: [],
        canUnmanage: false,
        managedFiles: [],
        skillScope: { mode: 'default' },
        manualSkills: ['alpha', 'beta'],
        presetSkills: ['core-skill'],
        canUseDefaultSkillScope: true,
        avatarPresetId: 'gradient-sunset',
        avatarSource: 'default',
      }],
      defaultAgentId: 'main',
      fetchAgents: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    useAgentsStore.setState(initialAgentsState);
    useChannelsStore.setState(initialChannelsState);
    useGatewayStore.setState(initialGatewayState);
    useSkillsStore.setState(initialSkillsState);
  });

  it('shows the main agent enabled skill count instead of runtime-discovered enabled skills', () => {
    render(<DashboardSettingsSection />);

    const skillsCard = screen.getByText('技能').closest('[class*="rounded"]');
    expect(skillsCard).not.toBeNull();
    expect(within(skillsCard as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(skillsCard as HTMLElement).getByText('3 / 120 已启用')).toBeInTheDocument();
  });
});
