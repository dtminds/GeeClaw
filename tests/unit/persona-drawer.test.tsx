import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => ({
      'toolbar.persona.title': 'Persona',
      'toolbar.persona.tabs.identity': 'Identity',
      'toolbar.persona.tabs.master': 'Master',
      'toolbar.persona.tabs.soul': 'Soul',
      'toolbar.persona.tabs.memory': 'Memory',
      'toolbar.persona.loadFailed': 'Load failed',
      'toolbar.persona.notes.identity': 'Identity note',
      'toolbar.persona.notes.master': 'Master note',
      'toolbar.persona.notes.soul': 'Soul note',
      'toolbar.persona.notes.memory': 'Memory note',
      'toolbar.persona.placeholders.identity': 'Identity placeholder',
      'toolbar.persona.placeholders.master': 'Master placeholder',
      'toolbar.persona.placeholders.soul': 'Soul placeholder',
      'toolbar.persona.placeholders.memory': 'Memory placeholder',
      'toolbar.persona.savedState': 'Saved',
      'toolbar.persona.unsaved': 'Unsaved',
      'toolbar.persona.saving': 'Saving',
      'toolbar.persona.toast.saved': 'Saved',
      'toolbar.persona.toast.failed': 'Failed',
      'toolbar.persona.createOnSave': 'Create on save',
      'common:actions.cancel': 'Cancel',
      'common:actions.save': 'Save',
      'common:actions.close': 'Close',
      'common:actions.refresh': 'Refresh',
    }[key] || key),
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PersonaDrawer managed mode', () => {
  it('renders managed persona files as read-only and blocks save attempts', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      agentId: 'stockexpert',
      workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
      editable: false,
      lockedFiles: ['identity', 'master', 'soul', 'memory'],
      message: 'Managed preset agents cannot edit persona files until they are unmanaged',
      files: {
        identity: { exists: true, content: 'identity content' },
        master: { exists: true, content: 'master content' },
        soul: { exists: true, content: 'soul content' },
        memory: { exists: true, content: 'memory content' },
      },
    });

    const { PersonaDrawer } = await import('@/pages/Chat/PersonaDrawer');
    render(
      <PersonaDrawer
        open
        agentId="stockexpert"
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText('Managed preset agents cannot edit persona files until they are unmanaged')).toBeInTheDocument();

    const textbox = screen.getByRole('textbox');
    expect(textbox).toBeDisabled();

    fireEvent.change(textbox, { target: { value: 'updated content' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await waitFor(() => expect(hostApiFetchMock).toHaveBeenCalledTimes(1));
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/stockexpert/persona');
  });
});
