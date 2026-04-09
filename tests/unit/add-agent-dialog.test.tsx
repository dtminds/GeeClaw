import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAgentMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

const agentsState = {
  agents: [],
  createAgent: createAgentMock,
};

const translations: Record<string, string> = {
  'createDialog.title': 'Add Agent',
  'createDialog.description': 'Create a new agent',
  'createDialog.nameLabel': 'Name',
  'createDialog.namePlaceholder': 'Research Helper',
  'createDialog.idLabel': 'Agent ID',
  'createDialog.idPlaceholder': 'research-helper',
  'createDialog.idHint': 'Use lowercase letters, numbers, and hyphens.',
  'createDialog.idFormatError': 'Invalid format',
  'createDialog.idDuplicateError': 'Already exists',
  'createDialog.avatarLabel': 'Avatar',
  'createDialog.avatarDescription': 'Choose a preset avatar.',
  'toast.agentCreated': 'Agent created',
  'toast.agentCreateFailed': 'Create failed',
  'creating': 'Creating...',
  'common:actions.cancel': 'Cancel',
  'common:actions.save': 'Save',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'toast.agentCreateFailed') {
        return `Create failed: ${options?.error ?? ''}`;
      }
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe('AddAgentDialog', () => {
  beforeEach(() => {
    agentsState.agents = [];
    createAgentMock.mockReset().mockResolvedValue(undefined);
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('submits the selected avatar preset', async () => {
    const onOpenChange = vi.fn();
    const { AddAgentDialog } = await import('@/pages/Chat/AddAgentDialog');

    render(<AddAgentDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Sunset/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Research Helper' } });
    fireEvent.change(screen.getByLabelText('Agent ID'), { target: { value: 'research-helper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createAgentMock).toHaveBeenCalledWith('Research Helper', 'research-helper', 'gradient-sunset');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
