import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fetchAgentsMock = vi.fn(async () => undefined);
const fetchPresetsMock = vi.fn(async () => undefined);
const installPresetMock = vi.fn(async () => undefined);
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
  'marketplace.title': 'Built-in Agent Marketplace',
  'marketplace.description': 'Install curated agents.',
  'marketplace.install': 'Install',
  'marketplace.installed': 'Installed',
  'marketplace.managedHint': 'Installs as a managed preset agent',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'marketplace.skillCount') {
        return `${options?.count ?? 0} preset skills`;
      }
      return translations[key] || key;
    },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      agents: [{
        id: 'stockexpert',
        name: '股票助手',
        isDefault: false,
        modelDisplay: 'gemini-3-flash-preview',
        inheritedModel: true,
        workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
        agentDir: '~/.openclaw-geeclaw/agents/stockexpert/agent',
        mainSessionKey: 'agent:stockexpert:main',
        channelTypes: [],
        channelAccounts: [],
        source: 'preset' as const,
        managed: true,
        presetId: 'stock-expert',
        lockedFields: ['id', 'workspace', 'persona'],
        canUnmanage: true,
        managedFiles: ['AGENTS.md', 'SOUL.md'],
        skillScope: { mode: 'specified' as const, skills: ['stock-analyzer', 'web-search'] },
        presetSkills: ['stock-analyzer'],
        canUseDefaultSkillScope: false,
      }],
      presets: [
        {
          presetId: 'stock-expert',
          name: '股票助手',
          description: '追踪个股、公告和财报',
          iconKey: 'stock',
          category: 'finance',
          managed: true,
          agentId: 'stockexpert',
          workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
          skillScope: { mode: 'specified' as const, skills: ['stock-analyzer', 'stock-announcements'] },
          presetSkills: ['stock-analyzer', 'stock-announcements'],
          managedFiles: ['AGENTS.md', 'SOUL.md'],
        },
        {
          presetId: 'trend-finder',
          name: '趋势助手',
          description: '捕捉热点和市场趋势',
          iconKey: 'trend',
          category: 'research',
          managed: true,
          agentId: 'trendfinder',
          workspace: '~/.openclaw-geeclaw/workspace-trendfinder',
          skillScope: { mode: 'specified' as const, skills: ['web-search'] },
          presetSkills: ['web-search'],
          managedFiles: ['AGENTS.md'],
        },
      ],
      loading: false,
      error: null,
      fetchAgents: fetchAgentsMock,
      fetchPresets: fetchPresetsMock,
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      installPreset: installPresetMock,
      updateAgent: vi.fn(),
      updateAgentSettings: vi.fn(),
      unmanageAgent: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

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
  it('renders marketplace presets and managed badges', async () => {
    const { Agents } = await import('@/pages/Agents');
    render(<Agents />);

    expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    expect(fetchPresetsMock).toHaveBeenCalledTimes(1);
    expect(fetchChannelsMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('股票助手')).toBeInTheDocument();
    expect(screen.getByText('Managed')).toBeInTheDocument();
    expect(screen.getByText('From Marketplace')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));

    expect(screen.getByText('Built-in Agent Marketplace')).toBeInTheDocument();
    expect(screen.getByText('捕捉热点和市场趋势')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Installed' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(installPresetMock).toHaveBeenCalledWith('trend-finder'));
  });
});
