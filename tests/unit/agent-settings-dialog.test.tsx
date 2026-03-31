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
  'agentSettingsDialog.sections.general.placeholder': 'General settings are coming soon.',
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

  it('renders left navigation and switches sections', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

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
    expect(screen.getByTestId('agent-settings-panel-body')).toHaveClass('overflow-y-auto');

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Identity' }));
    expect(await screen.findByRole('tabpanel', { name: 'Identity' })).toBeInTheDocument();
    expect(await screen.findByText('identity text')).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Owner Profile' }));
    expect(await screen.findByRole('tabpanel', { name: 'Owner Profile' })).toBeInTheDocument();
    expect(await screen.findByText('owner text')).toBeInTheDocument();
  });

  it('loads persona snapshot for the active agent', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaSnapshot);

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    await waitFor(() => expect(mockHostApiFetch).toHaveBeenCalledWith('/api/agents/writer/persona'));
  });
});
