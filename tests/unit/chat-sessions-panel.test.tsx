import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatState = {
  desktopSessions: [
    {
      id: 'main-session',
      gatewaySessionKey: 'agent:writer:geeclaw_main',
      title: 'Writer',
      lastMessagePreview: 'Main preview',
      createdAt: 1,
      updatedAt: 100,
    },
    {
      id: 'temp-session-1',
      gatewaySessionKey: 'agent:writer:geeclaw_tmp_1',
      title: 'Draft outline',
      lastMessagePreview: 'Temp preview',
      createdAt: 2,
      updatedAt: 200,
    },
  ],
  currentAgentId: 'writer',
  currentDesktopSessionId: 'temp-session-1',
  currentSessionKey: 'agent:writer:geeclaw_tmp_1',
  currentViewMode: 'session' as const,
  selectedCronRun: null,
  isDraftSession: false,
  openAgentMainSession: vi.fn(async () => undefined),
  switchSession: vi.fn(),
  openCronRun: vi.fn(async () => undefined),
  newTemporarySession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined),
  renameSession: vi.fn(async () => undefined),
};

const agentsState = {
  agents: [{ id: 'writer', name: 'Writer', mainSessionKey: 'agent:writer:geeclaw_main' }],
};

const translations: Record<string, string> = {
  'sessionPanel.mainSection': 'Main session',
  'sessionPanel.mainSession': 'Main session',
  'sessionPanel.mainSessionHint': 'Main hint',
  'sessionPanel.temporaryTab': 'Chats',
  'sessionPanel.cronTab': 'Cron',
  'sessionPanel.temporarySection': 'Temporary sessions',
  'sessionPanel.temporarySessionHint': 'Temporary hint',
  'sessionPanel.renameTitle': 'Rename session',
  'sessionPanel.renameDescription': 'Update the title shown in GeeClaw.',
  'sessionPanel.renameLabel': 'Session title',
  'sessionPanel.renamePlaceholder': 'Untitled chat',
  'sessionPanel.renameAction': 'Rename',
  'sessionPanel.moreActions': 'More actions',
  'sessionPanel.renameMenuItem': 'Rename',
  'sessionPanel.deleteMenuItem': 'Delete',
  'toolbar.deleteTemporarySession': 'Delete session',
  'toolbar.untitledTemporarySession': 'Untitled chat',
  'common:actions.cancel': 'Cancel',
  'common:actions.save': 'Save',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(async () => ({ runs: [] })),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: vi.fn(() => () => undefined),
}));

describe('ChatSessionsPanel', () => {
  beforeEach(() => {
    chatState.openAgentMainSession.mockReset().mockResolvedValue(undefined);
    chatState.switchSession.mockReset();
    chatState.openCronRun.mockReset().mockResolvedValue(undefined);
    chatState.newTemporarySession.mockReset().mockResolvedValue(undefined);
    chatState.deleteSession.mockReset().mockResolvedValue(undefined);
    chatState.renameSession.mockReset().mockResolvedValue(undefined);

    if (!window.PointerEvent) {
      Object.defineProperty(window, 'PointerEvent', {
        value: MouseEvent,
        writable: true,
        configurable: true,
      });
    }
  });

  it('renames a temporary session from the overflow menu dialog', async () => {
    const { ChatSessionsPanel } = await import('@/pages/Chat/ChatSessionsPanel');

    render(<ChatSessionsPanel />);

    const menuButtons = screen.getAllByRole('button', { name: 'More actions' });
    fireEvent.pointerDown(menuButtons[0], { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    expect(await screen.findByRole('dialog', { name: 'Rename session' })).toBeInTheDocument();

    const input = screen.getByLabelText('Session title');
    fireEvent.change(input, { target: { value: 'Renamed session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(chatState.renameSession).toHaveBeenCalledWith('temp-session-1', 'Renamed session');
    });
  });

  it('deletes a temporary session from the overflow menu', async () => {
    const { ChatSessionsPanel } = await import('@/pages/Chat/ChatSessionsPanel');

    render(<ChatSessionsPanel />);

    const menuButtons = screen.getAllByRole('button', { name: 'More actions' });
    fireEvent.pointerDown(menuButtons[0], { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => {
      expect(chatState.deleteSession).toHaveBeenCalledWith('temp-session-1');
    });
  });

  it('renders the overflow trigger as a sibling action instead of padding the row button', async () => {
    const { ChatSessionsPanel } = await import('@/pages/Chat/ChatSessionsPanel');

    render(<ChatSessionsPanel />);

    const titleButton = screen.getByRole('button', { name: 'Draft outline Temp preview' });
    const moreActionsButton = screen.getByRole('button', { name: 'More actions' });

    expect(titleButton.className).not.toContain('pr-12');
    expect(titleButton.className).toContain('w-full');
    expect(moreActionsButton.parentElement).not.toBe(titleButton);
  });

  it('shows the temporary section label between divider lines', async () => {
    const { ChatSessionsPanel } = await import('@/pages/Chat/ChatSessionsPanel');

    render(<ChatSessionsPanel />);

    expect(screen.getByText('Temporary sessions')).toBeInTheDocument();
  });

  it('hides the temporary section divider when there are no temporary sessions', async () => {
    const { ChatSessionsPanel } = await import('@/pages/Chat/ChatSessionsPanel');
    const previousSessions = chatState.desktopSessions;
    const previousCurrentDesktopSessionId = chatState.currentDesktopSessionId;
    const previousCurrentSessionKey = chatState.currentSessionKey;

    chatState.desktopSessions = [
      {
        id: 'main-session',
        gatewaySessionKey: 'agent:writer:geeclaw_main',
        title: 'Writer',
        lastMessagePreview: 'Main preview',
        createdAt: 1,
        updatedAt: 100,
      },
    ];
    chatState.currentDesktopSessionId = '';
    chatState.currentSessionKey = 'agent:writer:geeclaw_main';

    try {
      render(<ChatSessionsPanel />);

      expect(screen.queryByText('Temporary sessions')).not.toBeInTheDocument();
    } finally {
      chatState.desktopSessions = previousSessions;
      chatState.currentDesktopSessionId = previousCurrentDesktopSessionId;
      chatState.currentSessionKey = previousCurrentSessionKey;
    }
  });
});
