import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAgentsStore } from '@/stores/agents';
import { useSkillsStore } from '@/stores/skills';
import { SOUL_TEMPLATES } from '@/pages/Chat/agent-settings/useAgentPersona';

const mockHostApiFetch = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

const translations: Record<string, string> = {
  'agentSettingsDialog.title': 'Agent Settings',
  'agentSettingsDialog.navigation': 'Agent settings sections',
  'agentSettingsDialog.sections.general.label': 'General',
  'agentSettingsDialog.sections.general.title': 'General',
  'agentSettingsDialog.sections.general.description': 'General settings',
  'agentSettingsDialog.general.nameLabel': 'Agent Name',
  'agentSettingsDialog.general.namePlaceholder': 'Assistant',
  'agentSettingsDialog.general.avatarLabel': 'Avatar',
  'agentSettingsDialog.general.avatarDescription': 'Choose a preset avatar',
  'agentSettingsDialog.general.agentIdLabel': 'Agent ID',
  'agentSettingsDialog.general.modelLabel': 'Model',
  'agentSettingsDialog.general.inheritedSuffix': '(inherited)',
  'agentSettingsDialog.general.activeMemoryLabel': 'Active Memory',
  'agentSettingsDialog.general.activeMemoryDescription': 'Allow this agent to read and write Active Memory.',
  'agentSettingsDialog.general.activeMemoryDisabledHint': 'Enable Active Memory first in Settings -> Memory.',
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
  'toolbar.persona.createOnSave': 'Create on save',
  'toolbar.persona.notes.identity': 'The agent reads this file to understand itself',
  'toolbar.persona.notes.master': 'The agent reads this file to understand you',
  'toolbar.persona.notes.soul': 'The agent reads this file to shape its persona and response style',
  'toolbar.persona.notes.memory': 'The agent reads and writes memory here',
  'toolbar.persona.lockedManaged.identity': 'Managed agents do not support editing this file.',
  'toolbar.persona.lockedManaged.default': 'This file is locked for managed agents.',
  'toolbar.persona.toast.saved': 'Persona saved',
  'toolbar.persona.toast.failed': 'Failed to save persona',
  'toolbar.persona.saving': 'Saving...',
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

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const initialAgentsState = useAgentsStore.getState();
const initialSkillsState = useSkillsStore.getState();

function buildMemorySnapshot(overrides?: {
  activeMemory?: Partial<{
    enabled: boolean;
    agents: string[];
    model: string | null;
    modelMode: 'automatic' | 'custom';
    status: 'enabled' | 'disabled' | 'unavailable';
  }>;
}) {
  return {
    availableModels: [],
    dreaming: {
      enabled: true,
      status: 'enabled' as const,
    },
    activeMemory: {
      enabled: true,
      agents: ['main'],
      model: null,
      modelMode: 'automatic' as const,
      status: 'enabled' as const,
      ...overrides?.activeMemory,
    },
    losslessContent: {
      enabled: false,
      installedVersion: null,
      requiredVersion: '0.5.2',
      summaryModel: null,
      summaryModelMode: 'automatic' as const,
      status: 'not-installed' as const,
    },
  };
}

describe('AgentSettingsDialog shell', () => {
  beforeEach(() => {
    mockHostApiFetch.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    useAgentsStore.setState(initialAgentsState, true);
    useSkillsStore.setState(initialSkillsState, true);
    mockHostApiFetch.mockImplementation((path: string) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot());
      }
      if (path === '/api/agents/writer/persona') {
        return Promise.resolve(personaSnapshot);
      }
      if (path === '/api/agents/helper/persona') {
        return Promise.resolve({
          ...personaSnapshot,
          agentId: 'helper',
        });
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });
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
    avatarPresetId: 'gradient-sky',
    avatarSource: 'default',
  };

  const deletableAgentSummary = {
    ...agentSummary,
    id: 'helper',
    name: 'Helper Bot',
    isDefault: false,
    mainSessionKey: 'agent:helper:main',
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
    expect(screen.getByTestId('agent-settings-content')).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-hidden');
    expect(screen.getByRole('tabpanel', { name: 'General' })).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-y-auto');
    const generalPanelRoot = screen.getByRole('tabpanel', { name: 'General' }).firstElementChild as HTMLElement;
    const generalPanelContent = generalPanelRoot.children[1] as HTMLElement;
    const deleteCard = screen.getByRole('button', { name: 'Delete Agent' }).closest('div');
    expect(generalPanelRoot).toHaveClass('min-h-full');
    expect(generalPanelRoot).not.toHaveClass('h-full');
    expect(generalPanelContent).not.toHaveClass('flex-1');
    expect(generalPanelContent).not.toHaveClass('min-h-0');
    expect(deleteCard).not.toHaveClass('mt-auto');
    expect(screen.getByRole('dialog', { name: 'Agent Settings' })).toHaveClass('h-[min(88vh,860px)]', 'min-h-[620px]');

    expect(screen.getByLabelText('Agent Name')).toHaveValue('Writer Bot');
    expect(screen.getByLabelText('Agent ID')).toHaveValue('writer');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4.1');
    expect(screen.getByRole('button', { name: 'Delete Agent' })).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Identity' }));
    expect(await screen.findByRole('tabpanel', { name: 'Identity' })).toBeInTheDocument();
    expect(await screen.findByLabelText('IDENTITY.md')).toHaveValue('identity text');

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Owner Profile' }));
    expect(await screen.findByRole('tabpanel', { name: 'Owner Profile' })).toBeInTheDocument();
    expect(await screen.findByLabelText('USER.md')).toHaveValue('owner text');
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

  it('confirms and deletes a non-default agent', async () => {
    mockHostApiFetch.mockResolvedValueOnce({
      ...personaSnapshot,
      agentId: 'helper',
    });

    const deleteAgent = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    useAgentsStore.setState({
      agents: [agentSummary, deletableAgentSummary],
      defaultAgentId: 'writer',
      deleteAgent,
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="helper" onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Delete Agent' });
    expect(within(confirmDialog).getByText('Delete this agent?')).toBeInTheDocument();

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteAgent).toHaveBeenCalledWith('helper');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
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

  it('does not close when clicking the overlay mask', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const onOpenChange = vi.fn();
    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole('dialog', { name: 'Agent Settings' });
    const overlay = dialog.parentElement?.previousElementSibling as HTMLElement | null;
    expect(overlay).not.toBeNull();

    fireEvent.pointerDown(overlay!);
    fireEvent.click(overlay!);

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog', { name: 'Agent Settings' })).toBeInTheDocument();
  });

  it('refetches persona on reopen and resets drafts', async () => {
    const refreshedSnapshot = {
      ...personaSnapshot,
      files: {
        ...personaSnapshot.files,
        identity: { exists: true, content: 'identity refreshed' },
      },
    };

    let personaRequestCount = 0;
    mockHostApiFetch.mockImplementation((path: string) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot());
      }
      if (path === '/api/agents/writer/persona') {
        personaRequestCount += 1;
        return Promise.resolve(personaRequestCount === 1 ? personaSnapshot : refreshedSnapshot);
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    const { rerender } = render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Identity' }));
    const identityInput = await screen.findByLabelText('IDENTITY.md');
    fireEvent.change(identityInput, { target: { value: 'draft identity' } });
    expect(identityInput).toHaveValue('draft identity');

    rerender(<AgentSettingsDialog open={false} agentId="writer" onOpenChange={() => {}} />);
    rerender(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Identity' }));
    const refreshedInput = await screen.findByLabelText('IDENTITY.md');

    await waitFor(() => {
      expect(
        mockHostApiFetch.mock.calls.filter(([path]) => path === '/api/agents/writer/persona'),
      ).toHaveLength(2);
      expect(refreshedInput).toHaveValue('identity refreshed');
    });
  });

  it('disables soul controls while saving', async () => {
    let resolveSave: ((value: typeof personaSnapshot) => void) | undefined;
    const savePromise = new Promise<typeof personaSnapshot>((resolve) => {
      resolveSave = resolve;
    });
    const soulSnapshot = {
      ...personaSnapshot,
      files: {
        ...personaSnapshot.files,
        soul: { exists: true, content: 'custom soul' },
      },
    };

    mockHostApiFetch.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot());
      }
      if (path === '/api/agents/writer/persona' && options?.method === 'PUT') {
        return savePromise;
      }
      if (path === '/api/agents/writer/persona') {
        return Promise.resolve(soulSnapshot);
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Soul' }));
    const soulInput = await screen.findByLabelText('SOUL.md');
    fireEvent.change(soulInput, { target: { value: 'custom soul updated' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const templateButton = screen.getByRole('button', { name: SOUL_TEMPLATES[0].name });
    await waitFor(() => {
      expect(templateButton).toBeDisabled();
      expect(soulInput).toBeDisabled();
    });

    await act(async () => {
      resolveSave?.({
        ...soulSnapshot,
        files: {
          ...soulSnapshot.files,
          soul: { exists: true, content: 'custom soul updated' },
        },
      });
    });
  });

  it('saves persona section changes through the persona api', async () => {
    mockHostApiFetch.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot());
      }
      if (path === '/api/agents/writer/persona' && options?.method === 'PUT') {
        return Promise.resolve({
          ...personaSnapshot,
          files: {
            ...personaSnapshot.files,
            identity: { exists: true, content: 'updated identity' },
          },
        });
      }
      if (path === '/api/agents/writer/persona') {
        return Promise.resolve(personaSnapshot);
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Identity' }));
    const identityInput = await screen.findByLabelText('IDENTITY.md');
    fireEvent.change(identityInput, { target: { value: 'updated identity' } });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockHostApiFetch).toHaveBeenCalledWith('/api/agents/writer/persona', {
        method: 'PUT',
        body: JSON.stringify({ identity: 'updated identity' }),
      });
    });
  });

  it('disables edits for locked persona files', async () => {
    mockHostApiFetch.mockImplementation((path: string) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot());
      }
      if (path === '/api/agents/writer/persona') {
        return Promise.resolve({
          ...personaSnapshot,
          lockedFiles: ['identity'],
        });
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Identity' }));
    const identityInput = await screen.findByLabelText('IDENTITY.md');
    expect(identityInput).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('switches soul templates while keeping custom editing', async () => {
    mockHostApiFetch.mockResolvedValueOnce({
      ...personaSnapshot,
      files: {
        ...personaSnapshot.files,
        soul: { exists: true, content: 'my custom soul' },
      },
    });

    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Soul' }));
    const soulInput = await screen.findByLabelText('SOUL.md');
    expect(soulInput).not.toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: SOUL_TEMPLATES[0].name }));
    expect(soulInput).toHaveAttribute('readonly');
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

    const popover = document.body.querySelector('[data-radix-popper-content-wrapper] > div');
    expect(popover).toHaveClass('z-[130]');

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

  it('saves avatar changes from the general panel immediately', async () => {
    const updateAgentSettings = vi.fn().mockResolvedValue(undefined);
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
      updateAgentSettings,
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Sunset/i }));

    await waitFor(() => {
      expect(updateAgentSettings).toHaveBeenCalledWith('writer', {
        avatarPresetId: 'gradient-sunset',
      });
    });
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('shows and updates the current agent active-memory membership', async () => {
    mockHostApiFetch.mockImplementation((path: string) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot({
          activeMemory: {
            enabled: true,
            agents: ['main', 'writer'],
          },
        }));
      }
      if (path === '/api/agents/writer/persona') {
        return Promise.resolve(personaSnapshot);
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });

    const updateAgentSettings = vi.fn().mockResolvedValue(undefined);
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
      updateAgentSettings,
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    const activeMemorySwitch = await screen.findByRole('switch', { name: 'Active Memory' });
    expect(activeMemorySwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(activeMemorySwitch);

    await waitFor(() => {
      expect(updateAgentSettings).toHaveBeenCalledWith('writer', {
        activeMemoryEnabled: false,
      });
    });
  });

  it('disables the active-memory toggle when global active memory is off', async () => {
    mockHostApiFetch.mockImplementation((path: string) => {
      if (path === '/api/settings/memory') {
        return Promise.resolve(buildMemorySnapshot({
          activeMemory: {
            enabled: false,
            agents: [],
            status: 'disabled',
          },
        }));
      }
      if (path === '/api/agents/writer/persona') {
        return Promise.resolve(personaSnapshot);
      }
      throw new Error(`Unhandled hostApiFetch mock for ${path}`);
    });

    const updateAgentSettings = vi.fn().mockResolvedValue(undefined);
    useAgentsStore.setState({
      agents: [agentSummary],
      defaultAgentId: 'writer',
      updateAgentSettings,
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    const activeMemorySwitch = await screen.findByRole('switch', { name: 'Active Memory' });
    expect(activeMemorySwitch).toBeDisabled();
    expect(screen.getByText('Enable Active Memory first in Settings -> Memory.')).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /Skill Six/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    const extraOption = await screen.findByRole('button', { name: /Skill Seven/ });
    expect(extraOption).toBeInTheDocument();
  });
});
