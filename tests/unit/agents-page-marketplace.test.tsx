import { fireEvent, render, screen, within } from '@testing-library/react';
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
  'marketplace.unavailable': 'Unavailable',
  'marketplace.viewDetails': 'View Details',
  'marketplace.availableOn': 'Available on {{platforms}}',
  'marketplace.managedHint': 'Installs as a managed preset agent',
  'marketplace.platforms.all': 'All Platforms',
  'marketplace.platforms.darwin': 'macOS',
  'marketplace.platforms.win32': 'Windows',
  'marketplace.platforms.linux': 'Linux',
  'marketplace.detail.summary': 'Preset summary',
  'marketplace.detail.skills': 'Preset skills',
  'marketplace.detail.files': 'Managed files',
  'fields.agentId': 'Agent ID',
  'fields.workspace': 'Workspace',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; platforms?: string }) => {
      if (key === 'marketplace.skillCount') {
        return `${options?.count ?? 0} preset skills`;
      }
      if (key === 'marketplace.availableOn') {
        return `Available on ${options?.platforms ?? ''}`;
      }
      return translations[key] || key;
    },
    i18n: {
      resolvedLanguage: 'en',
      language: 'en',
    },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      agents: [{
        id: 'trendfinder',
        name: '趋势助手',
        isDefault: false,
        modelDisplay: 'gemini-3-flash-preview',
        inheritedModel: true,
        workspace: '~/.openclaw-geeclaw/workspace-trendfinder',
        agentDir: '~/.openclaw-geeclaw/agents/trendfinder/agent',
        mainSessionKey: 'agent:trendfinder:main',
        channelTypes: [],
        channelAccounts: [],
        source: 'preset' as const,
        managed: true,
        presetId: 'trend-finder',
        lockedFields: ['id', 'workspace', 'persona'],
        canUnmanage: true,
        managedFiles: ['AGENTS.md'],
        skillScope: { mode: 'specified' as const, skills: ['web-search'] },
        presetSkills: ['web-search'],
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
          platforms: ['darwin'] as const,
          supportedOnCurrentPlatform: false,
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
          supportedOnCurrentPlatform: true,
        },
        {
          presetId: 'alpha-researcher',
          name: 'Alpha Researcher',
          description: '套利信号与候选池',
          iconKey: 'research',
          category: 'research',
          managed: true,
          agentId: 'alpha-researcher',
          workspace: '~/.openclaw-geeclaw/workspace-alpha-researcher',
          skillScope: { mode: 'specified' as const, skills: ['web-search', 'stock-analyzer'] },
          presetSkills: ['web-search', 'stock-analyzer'],
          managedFiles: ['AGENTS.md', 'USER.md'],
          supportedOnCurrentPlatform: true,
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
  it('opens preset details, disables unsupported installs, and still installs supported presets', async () => {
    const { Agents } = await import('@/pages/Agents');
    render(<Agents />);

    expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    expect(fetchPresetsMock).toHaveBeenCalledTimes(1);
    expect(fetchChannelsMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('趋势助手')).toBeInTheDocument();
    expect(screen.getByText('Managed')).toBeInTheDocument();
    expect(screen.getByText('From Marketplace')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));

    expect(screen.getByText('Built-in Agent Marketplace')).toBeInTheDocument();
    expect(screen.getByText('捕捉热点和市场趋势')).toBeInTheDocument();
    expect(screen.getByText('套利信号与候选池')).toBeInTheDocument();
    expect(screen.getAllByText('macOS').length).toBeGreaterThan(0);
    expect(screen.getByText('Available on macOS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Installed' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(installPresetMock).toHaveBeenCalledWith('alpha-researcher');

    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Preset summary')).toBeInTheDocument();
    expect(within(dialog).getByText('Preset skills')).toBeInTheDocument();
    expect(within(dialog).getByText('stock-announcements')).toBeInTheDocument();
    expect(within(dialog).getByText('Managed files')).toBeInTheDocument();
    expect(within(dialog).getByText('AGENTS.md')).toBeInTheDocument();
    expect(within(dialog).getByText('macOS')).toBeInTheDocument();
    expect(within(dialog).getByText('Available on macOS')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  });
});
