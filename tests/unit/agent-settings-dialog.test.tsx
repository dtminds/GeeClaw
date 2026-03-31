import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAgentsStore } from '@/stores/agents';
import { useSkillsStore } from '@/stores/skills';

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
  'agentSettingsDialog.skillsHint': 'Choose between the default skill scope or up to 6 specific skills.',
  'agentSettingsDialog.skillsManagedHint': 'This managed agent can add extra skills, but preset skills cannot be removed.',
  'agentSettingsDialog.skillScope.default': 'Default',
  'agentSettingsDialog.skillScope.specified': 'Specified',
  'agentSettingsDialog.skillScope.selected': 'Selected skills',
  'agentSettingsDialog.skillScope.search': 'Search skills',
  'agentSettingsDialog.skillScope.searchPlaceholder': 'Search by name, slug, or description',
  'agentSettingsDialog.skillScope.addSkill': 'Add skill',
  'agentSettingsDialog.skillScope.empty': 'No matching skills',
  'agentSettingsDialog.skillScope.maxReached': 'Skill limit reached',
  'agentSettingsDialog.skillScope.preset': 'Preset',
  'agentSettingsDialog.skillScope.save': 'Save Skills',
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

const initialAgentsState = useAgentsStore.getState();
const initialSkillsState = useSkillsStore.getState();

describe('AgentSettingsDialog shell', () => {
  beforeEach(() => {
    mockHostApiFetch.mockReset();
    useAgentsStore.setState(initialAgentsState, true);
    useSkillsStore.setState(initialSkillsState, true);
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

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    await waitFor(() => expect(mockHostApiFetch).toHaveBeenCalledWith('/api/agents/writer/persona'));
  });

  it('saves specified skills after searching and selecting', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    const updateAgentSettings = vi.fn().mockResolvedValue(undefined);
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
      updateAgentSettings,
    });

    useSkillsStore.setState({
      skills: [
        {
          id: 'alpha-skill',
          slug: 'alpha',
          name: 'Alpha Skill',
          description: 'Handles alpha work',
          enabled: true,
        },
        {
          id: 'beta-skill',
          slug: 'beta',
          name: 'Beta Skill',
          description: 'Specialized for reports',
          enabled: true,
        },
      ],
      fetchSkills: vi.fn().mockResolvedValue(undefined),
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Specified' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));

    const searchInput = await screen.findByPlaceholderText('Search by name, slug, or description');
    fireEvent.change(searchInput, { target: { value: 'reports' } });

    const betaOption = await screen.findByRole('button', { name: /Beta Skill/ });
    fireEvent.click(betaOption);

    expect(screen.getByRole('button', { name: /Beta Skill/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save Skills' }));

    await waitFor(() => {
      expect(updateAgentSettings).toHaveBeenCalledWith('writer', {
        skillScope: { mode: 'specified', skills: ['beta-skill'] },
      });
    });
  });

  it('locks preset skills and enforces the six-skill limit', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    const managedAgent = {
      ...agentSummary,
      managed: true,
      presetSkills: ['core-skill'],
      skillScope: { mode: 'specified', skills: ['core-skill', 'one', 'two', 'three', 'four', 'five', 'six'] },
    };

    useAgentsStore.setState({
      agents: [managedAgent],
      defaultAgentId: 'writer',
    });

    useSkillsStore.setState({
      skills: [
        {
          id: 'core-skill',
          slug: 'core',
          name: 'Core Skill',
          description: 'Core capability',
          enabled: true,
        },
        {
          id: 'one',
          name: 'Skill One',
          description: 'One',
          enabled: true,
        },
        {
          id: 'two',
          name: 'Skill Two',
          description: 'Two',
          enabled: true,
        },
        {
          id: 'three',
          name: 'Skill Three',
          description: 'Three',
          enabled: true,
        },
        {
          id: 'four',
          name: 'Skill Four',
          description: 'Four',
          enabled: true,
        },
        {
          id: 'five',
          name: 'Skill Five',
          description: 'Five',
          enabled: true,
        },
        {
          id: 'six',
          name: 'Skill Six',
          description: 'Six',
          enabled: true,
        },
        {
          id: 'seven',
          name: 'Skill Seven',
          description: 'Seven',
          enabled: true,
        },
      ],
      fetchSkills: vi.fn().mockResolvedValue(undefined),
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));

    const presetChip = screen.getByRole('button', { name: /Core Skill/ });
    expect(presetChip).toBeDisabled();

    expect(screen.getByText('7 / 7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skill Six/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    const extraOption = await screen.findByRole('button', { name: /Skill Seven/ });
    expect(extraOption).toBeDisabled();
  });
});
