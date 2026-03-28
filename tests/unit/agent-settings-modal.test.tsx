import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const updateAgentSettingsMock = vi.fn(async () => undefined);
const unmanageAgentMock = vi.fn(async () => undefined);
const fetchSkillsMock = vi.fn(async () => undefined);

const translations: Record<string, string> = {
  title: 'Agents',
  subtitle: 'Manage agents',
  refresh: 'Refresh',
  addAgent: 'Add Agent',
  gatewayWarning: 'Gateway warning',
  defaultBadge: 'default',
  inherited: 'inherited',
  none: 'none',
  settings: 'Settings',
  managedBadge: 'Managed',
  presetBadge: 'From Marketplace',
  'tabs.agents': 'My Agents',
  'tabs.marketplace': 'Marketplace',
  'settingsDialog.title': 'Agent Settings: 股票助手',
  'settingsDialog.description': 'Manage settings',
  'settingsDialog.nameLabel': 'Agent Name',
  'settingsDialog.agentIdLabel': 'Agent ID',
  'settingsDialog.modelLabel': 'Model',
  'settingsDialog.channelsTitle': 'Channels',
  'settingsDialog.noChannels': 'No channels',
  'settingsDialog.skillsTitle': 'Skills Scope',
  'settingsDialog.skillsManagedHint': 'This managed agent can add extra skills, but preset skills cannot be removed until you unmanage it.',
  'settingsDialog.skillScope.default': 'Default',
  'settingsDialog.skillScope.specified': 'Specified',
  'settingsDialog.skillScope.selected': 'Selected skills',
  'settingsDialog.skillScope.search': 'Search skills',
  'settingsDialog.skillScope.searchPlaceholder': 'Search by name, slug, or description',
  'settingsDialog.skillScope.addSkill': 'Add skill',
  'settingsDialog.skillScope.empty': 'No matching skills',
  'settingsDialog.skillScope.maxReached': 'Skill limit reached',
  'settingsDialog.skillScope.preset': 'Preset',
  'settingsDialog.skillScope.save': 'Save Skills',
  'settingsDialog.unmanageTitle': 'Managed preset',
  'settingsDialog.unmanageDescription': 'Unmanaging keeps the current config but removes preset restrictions on persona files and preset skills.',
  'settingsDialog.unmanage': 'Unmanage',
  'settingsDialog.unmanageConfirm.firstTitle': 'Remove managed restrictions?',
  'settingsDialog.unmanageConfirm.firstMessage': 'This will unlock preset persona files and allow preset skills to be removed.',
  'settingsDialog.unmanageConfirm.firstConfirm': 'Continue',
  'settingsDialog.unmanageConfirm.secondTitle': 'Confirm unmanage',
  'settingsDialog.unmanageConfirm.secondMessage': 'This action cannot be automatically restored. The current preset files stay as-is, but future edits will no longer be protected.',
  'settingsDialog.unmanageConfirm.secondConfirm': 'Unmanage now',
  'toast.agentUpdated': 'Agent updated',
  'toast.agentUpdateFailed': 'Failed to update agent',
  'empty': 'No agents',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => translations[key] || key,
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
        presetSkills: ['stock-analyzer', 'web-search'],
        canUseDefaultSkillScope: false,
      }],
      presets: [],
      loading: false,
      error: null,
      fetchAgents: vi.fn(async () => undefined),
      fetchPresets: vi.fn(async () => undefined),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      installPreset: vi.fn(),
      updateAgent: vi.fn(),
      updateAgentSettings: updateAgentSettingsMock,
      unmanageAgent: unmanageAgentMock,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/channels', () => ({
  useChannelsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      channels: [],
      fetchChannels: vi.fn(async () => undefined),
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

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      skills: [
        { id: 'stock-analyzer', name: 'Stock Analyzer', description: 'Analyze market data and filings', enabled: true, eligible: true, isBundled: true },
        { id: 'web-search', name: 'Web Search', description: 'Search the web for current information', enabled: true, eligible: true, source: 'openclaw-managed' },
        { id: 'calendar', name: 'Calendar Assistant', description: 'Manage calendars and schedules', enabled: true, eligible: true, source: 'agents-skills-project' },
      ],
      fetchSkills: fetchSkillsMock,
    };
    return selector ? selector(state) : state;
  },
}));

describe('managed agent settings modal', () => {
  it('keeps preset skills locked and disables default mode while managed', async () => {
    const { Agents } = await import('@/pages/Agents');
    render(<Agents />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Skills Scope')).toBeInTheDocument();

    const defaultOption = screen.getByRole('button', { name: 'Default' });
    expect(defaultOption).toBeDisabled();

    expect(screen.getByText('Stock Analyzer')).toBeInTheDocument();
    expect(screen.getByText('Web Search')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search skills' }), {
      target: { value: 'calendar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calendar Assistant/ }));

    expect(screen.getByText('Calendar Assistant')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills' }));

    await waitFor(() => expect(updateAgentSettingsMock).toHaveBeenCalledWith('stockexpert', {
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search', 'calendar'],
      },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Unmanage' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove managed restrictions?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(unmanageAgentMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Confirm unmanage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unmanage now' }));
    await waitFor(() => expect(unmanageAgentMock).toHaveBeenCalledWith('stockexpert'));
  });
});
