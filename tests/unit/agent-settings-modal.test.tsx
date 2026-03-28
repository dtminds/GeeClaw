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
  'settingsDialog.skillScope.preset': 'Preset',
  'settingsDialog.skillScope.save': 'Save Skills',
  'settingsDialog.unmanageTitle': 'Managed preset',
  'settingsDialog.unmanageDescription': 'Unmanaging keeps the current config but removes preset restrictions on persona files and preset skills.',
  'settingsDialog.unmanage': 'Unmanage',
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
        { id: 'stock-analyzer', name: 'stock-analyzer', description: '', enabled: true, eligible: true },
        { id: 'web-search', name: 'web-search', description: '', enabled: true, eligible: true },
        { id: 'calendar', name: 'calendar', description: '', enabled: true, eligible: true },
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

    const presetSkillButtons = screen.getAllByRole('button', { name: /stock-analyzer/ });
    expect(presetSkillButtons.some((button) => button.hasAttribute('disabled'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills' }));

    await waitFor(() => expect(updateAgentSettingsMock).toHaveBeenCalledWith('stockexpert', {
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search', 'calendar'],
      },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Unmanage' }));
    await waitFor(() => expect(unmanageAgentMock).toHaveBeenCalledWith('stockexpert'));
  });
});
