import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockHostApiFetch = vi.fn();

const translations: Record<string, string> = {
  'agentSettingsDialog.title': 'Agent Settings',
  'agentSettingsDialog.description': 'Manage your agent profile',
  'agentSettingsDialog.navigation': 'Agent settings sections',
  'agentSettingsDialog.sections.general.label': 'General',
  'agentSettingsDialog.sections.general.title': 'General',
  'agentSettingsDialog.sections.general.description': 'General settings',
  'agentSettingsDialog.general.nameLabel': 'Agent Name',
  'agentSettingsDialog.general.namePlaceholder': 'Assistant',
  'agentSettingsDialog.general.agentIdLabel': 'Agent ID',
  'agentSettingsDialog.general.modelLabel': 'Model',
  'agentSettingsDialog.general.inheritedSuffix': '(inherited)',
  'agentSettingsDialog.general.deleteLabel': 'Delete Agent',
  'agentSettingsDialog.general.deleteTitle': 'Delete Agent',
  'agentSettingsDialog.general.deleteMessage': 'Delete this agent?',
  'agentSettingsDialog.general.deleteConfirm': 'Delete',
  'agentSettingsDialog.general.deleteCancel': 'Cancel',
  'agentSettingsDialog.general.deleteDisabledHint': 'Default agent cannot be deleted.',
  'agentSettingsDialog.sections.skills.label': 'Skills',
  'agentSettingsDialog.sections.skills.title': 'Skills',
  'agentSettingsDialog.sections.skills.description': 'Skills settings',
  'agentSettingsDialog.sections.skills.placeholder': 'Skills settings are coming soon.',
  'agentSettingsDialog.sections.identity.label': 'Identity',
  'agentSettingsDialog.sections.identity.title': 'Identity',
  'agentSettingsDialog.sections.identity.description': 'Identity settings',
  'agentSettingsDialog.sections.identity.placeholder': 'Identity placeholder',
  'agentSettingsDialog.sections.soul.label': 'Soul',
  'agentSettingsDialog.sections.soul.title': 'Soul',
  'agentSettingsDialog.sections.soul.description': 'Soul settings',
  'agentSettingsDialog.sections.soul.placeholder': 'Soul placeholder',
  'agentSettingsDialog.sections.memory.label': 'Long-term Memory',
  'agentSettingsDialog.sections.memory.title': 'Long-term Memory',
  'agentSettingsDialog.sections.memory.description': 'Memory settings',
  'agentSettingsDialog.sections.memory.placeholder': 'Memory placeholder',
  'agentSettingsDialog.sections.ownerProfile.label': 'Owner Profile',
  'agentSettingsDialog.sections.ownerProfile.title': 'Owner Profile',
  'agentSettingsDialog.sections.ownerProfile.description': 'Owner profile settings',
  'agentSettingsDialog.sections.ownerProfile.placeholder': 'Owner profile placeholder',
  'agentSettingsDialog.panels.loading': 'Loading agent persona...',
  'agentSettingsDialog.panels.error': 'Failed to load persona',
  'common:actions.close': 'Close',
  'common:actions.save': 'Save',
  'common:actions.cancel': 'Cancel',
  'common:actions.delete': 'Delete',
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

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => mockHostApiFetch(...args),
}));

describe('AgentSettingsDialog shell', () => {
  beforeEach(() => {
    mockHostApiFetch.mockReset();
  });

  const personaSnapshot = {
    agentId: 'writer',
    workspace: '/tmp/writer',
    editable: true,
    lockedFiles: [],
    files: {
      identity: { exists: true, content: 'identity text' },
      master: { exists: true, content: 'owner text' },
      soul: { exists: true, content: 'soul text' },
      memory: { exists: false, content: '' },
    },
  };

  const agentSummary = {
    id: 'writer',
    name: 'Writer Bot',
    isDefault: true,
    modelDisplay: 'gpt-4.1',
    inheritedModel: false,
    workspace: '/tmp/writer',
    agentDir: '/tmp/writer/agent',
    mainSessionKey: 'agent:writer:main',
    channelTypes: [],
    channelAccounts: [],
    source: 'custom',
    managed: false,
    presetId: undefined,
    lockedFields: [],
    canUnmanage: false,
    managedFiles: [],
    skillScope: { mode: 'default' },
    presetSkills: [],
    canUseDefaultSkillScope: true,
  };

  it('renders left navigation and switches sections', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    const { useAgentsStore } = await import('@/stores/agents');
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    const tablist = screen.getByRole('tablist', { name: 'Agent settings sections' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'General',
      'Skills',
      'Identity',
      'Soul',
      'Long-term Memory',
      'Owner Profile',
    ]);

    expect(within(tablist).getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByTestId('agent-settings-content')).toHaveClass('overflow-y-auto');

    expect(screen.getByLabelText('Agent Name')).toHaveValue('Writer Bot');
    expect(screen.getByLabelText('Agent ID')).toHaveValue('writer');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4.1');
    expect(screen.getByRole('button', { name: 'Delete Agent' })).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Identity' }));
    expect(await screen.findByRole('tabpanel', { name: 'Identity' })).toBeInTheDocument();
    expect(await screen.findByText('identity text')).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Owner Profile' }));
    expect(await screen.findByRole('tabpanel', { name: 'Owner Profile' })).toBeInTheDocument();
    expect(await screen.findByText('owner text')).toBeInTheDocument();
  });

  it('disables delete for the default agent', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    const { useAgentsStore } = await import('@/stores/agents');
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete Agent' });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText('Default agent cannot be deleted.')).toBeInTheDocument();
  });

  it('loads persona snapshot for the active agent', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    const { useAgentsStore } = await import('@/stores/agents');
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    await waitFor(() => expect(mockHostApiFetch).toHaveBeenCalledWith('/api/agents/writer/persona'));
  });
});
