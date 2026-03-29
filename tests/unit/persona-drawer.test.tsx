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
      'toolbar.persona.lockedManaged.identity': 'Managed agents do not support editing this file.',
      'toolbar.persona.lockedManaged.default': 'This file is locked for managed agents.',
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
  it('locks identity while allowing managed agents to edit soul', async () => {
    hostApiFetchMock
      .mockResolvedValueOnce({
        agentId: 'stockexpert',
        workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
        editable: true,
        lockedFiles: ['identity'],
        files: {
          identity: { exists: true, content: 'identity content' },
          master: { exists: true, content: 'master content' },
          soul: { exists: true, content: 'soul content' },
          memory: { exists: true, content: 'memory content' },
        },
      })
      .mockResolvedValueOnce({
      agentId: 'stockexpert',
      workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
      editable: true,
      lockedFiles: ['identity'],
      files: {
        identity: { exists: true, content: 'identity content' },
        master: { exists: true, content: 'master content' },
        soul: { exists: true, content: 'updated soul content' },
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

    expect(await screen.findByText('Managed agents do not support editing this file.')).toBeInTheDocument();

    const identityTextbox = screen.getByRole('textbox');
    expect(identityTextbox).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Soul' }));
    expect(screen.queryByText('Managed agents do not support editing this file.')).not.toBeInTheDocument();

    const soulTextbox = screen.getByRole('textbox');
    expect(soulTextbox).not.toBeDisabled();

    fireEvent.change(soulTextbox, { target: { value: 'updated soul content' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(hostApiFetchMock).toHaveBeenCalledTimes(2));
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/stockexpert/persona');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/stockexpert/persona', {
      method: 'PUT',
      body: JSON.stringify({ soul: 'updated soul content' }),
    });
  });
});
