import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn(async () => undefined);
const navigateMock = vi.fn();

const settingsState = {
  sidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
};

const chatState = {
  desktopSessions: [],
  currentAgentId: 'main',
  loadDesktopSessionSummaries: vi.fn(async () => undefined),
  openAgentMainSession: vi.fn(async () => undefined),
};

const agentsState = {
  agents: [],
  fetchAgents: vi.fn(async () => undefined),
};

const channelsState = {
  channels: [],
  fetchChannels: vi.fn(async () => undefined),
};

const gatewayState = {
  status: { state: 'running' },
};

const sessionState = {
  status: 'authenticated' as const,
  account: {
    id: 'user-1',
    displayName: 'GeeClaw User',
  },
};

const bootstrapState = {
  logoutToLogin: vi.fn(async () => undefined),
};

const translations: Record<string, string> = {
  'sidebar.dashboard': 'Dashboard',
  'sidebar.cronTasks': 'Cron Tasks',
  'sidebar.skills': 'Skills',
  'sidebar.channels': 'Channels',
  'sidebar.onlineCount': '{{count}} online',
  'sidebar.offlineCount': '0 online',
  'sidebar.loggedIn': 'Logged in',
  'sidebar.settings': 'Settings',
  'sidebar.logout': 'Log out',
  'sidebar.login': 'Log in',
  'sidebar.agents': 'Agents',
  'sidebar.createAgent': 'Create agent',
  'sidebar.agentMainSessionHint': 'Open session',
  'sidebar.expand': 'Expand sidebar',
  'sidebar.collapse': 'Collapse sidebar',
  'actions.cancel': 'Cancel',
  'createDialog.title': 'Add Agent',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'sidebar.onlineCount') {
        return `${options?.count ?? 0} online`;
      }
      if (key === 'sidebar.offlineCount') {
        return `0 online`;
      }
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/lib/api-client', () => ({
  invokeIpc: invokeIpcMock,
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/channels', () => ({
  useChannelsStore: (selector: (state: typeof channelsState) => unknown) => selector(channelsState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionState) => unknown) => selector(sessionState),
}));

vi.mock('@/stores/bootstrap', () => ({
  useBootstrapStore: (selector: (state: typeof bootstrapState) => unknown) => selector(bootstrapState),
}));

describe('Sidebar settings menu trigger', () => {
  beforeEach(() => {
    settingsState.sidebarCollapsed = false;
    settingsState.setSidebarCollapsed.mockReset();
    chatState.loadDesktopSessionSummaries.mockReset().mockResolvedValue(undefined);
    chatState.openAgentMainSession.mockReset().mockResolvedValue(undefined);
    agentsState.fetchAgents.mockReset().mockResolvedValue(undefined);
    channelsState.fetchChannels.mockReset().mockResolvedValue(undefined);
    bootstrapState.logoutToLogin.mockReset().mockResolvedValue(undefined);
    invokeIpcMock.mockReset().mockResolvedValue(undefined);
    navigateMock.mockReset();

    if (!window.PointerEvent) {
      Object.defineProperty(window, 'PointerEvent', {
        value: MouseEvent,
        writable: true,
        configurable: true,
      });
    }
  });

  it('opens from pointer interaction instead of hover', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar');

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const settingsButton = screen.getByTitle('Settings');

    fireEvent.mouseEnter(settingsButton);

    expect(screen.queryByText('Log out')).not.toBeInTheDocument();

    fireEvent.pointerDown(settingsButton, { button: 0, ctrlKey: false });

    expect(await screen.findByText('Log out')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows the agent section immediately when expanding the sidebar', async () => {
    vi.useFakeTimers();
    settingsState.sidebarCollapsed = true;
    agentsState.agents = [
      {
        id: 'agent-1',
        name: 'Alpha',
        isDefault: true,
      },
    ];
    chatState.desktopSessions = [
      {
        gatewaySessionKey: 'agent:agent-1:main',
        updatedAt: '2026-03-31T08:00:00.000Z',
        lastMessagePreview: '',
      },
    ];

    try {
      const { Sidebar } = await import('@/components/layout/Sidebar');

      const { rerender } = render(
        <MemoryRouter initialEntries={['/chat']}>
          <Sidebar />
        </MemoryRouter>,
      );

      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();

      settingsState.sidebarCollapsed = false;
      rerender(
        <MemoryRouter initialEntries={['/chat']}>
          <Sidebar />
        </MemoryRouter>,
      );

      expect(screen.getByText('Alpha')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      agentsState.agents = [];
      chatState.desktopSessions = [];
    }
  });

  it('opens the add agent dialog from the sidebar plus action', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar');

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    expect(await screen.findByRole('dialog', { name: 'Add Agent' })).toBeInTheDocument();
  });

  it('preloads desktop session summaries for sidebar previews on startup', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar');

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
      </MemoryRouter>,
    );

    await vi.waitFor(() => {
      expect(chatState.loadDesktopSessionSummaries).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the default agent first and sorts other agents by latest main session update', async () => {
    agentsState.agents = [
      {
        id: 'default-agent',
        name: 'Default',
        isDefault: true,
        mainSessionKey: 'agent:default-agent:geeclaw_main',
      },
      {
        id: 'alpha',
        name: 'Alpha',
        isDefault: false,
        mainSessionKey: 'agent:alpha:geeclaw_main',
      },
      {
        id: 'zeta',
        name: 'Zeta',
        isDefault: false,
        mainSessionKey: 'agent:zeta:geeclaw_main',
      },
      {
        id: 'unused',
        name: 'Unused',
        isDefault: false,
        mainSessionKey: 'agent:unused:geeclaw_main',
      },
    ];
    chatState.desktopSessions = [
      {
        id: 'default-session',
        gatewaySessionKey: 'agent:default-agent:geeclaw_main',
        title: '',
        lastMessagePreview: 'Default preview',
        createdAt: 1,
        updatedAt: '2026-03-31T08:00:00.000Z',
      },
      {
        id: 'alpha-session',
        gatewaySessionKey: 'agent:alpha:geeclaw_main',
        title: '',
        lastMessagePreview: 'Older preview',
        createdAt: 1,
        updatedAt: '2026-04-01T08:00:00.000Z',
      },
      {
        id: 'zeta-session',
        gatewaySessionKey: 'agent:zeta:geeclaw_main',
        title: '',
        lastMessagePreview: 'Newer preview',
        createdAt: 1,
        updatedAt: '2026-04-02T08:00:00.000Z',
      },
    ];

    try {
      const { Sidebar } = await import('@/components/layout/Sidebar');

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar />
        </MemoryRouter>,
      );

      const getAgentButton = (name: string): HTMLButtonElement => {
        const button = screen.getByText(name).closest('button');
        expect(button).not.toBeNull();
        return button as HTMLButtonElement;
      };

      const defaultButton = getAgentButton('Default');
      const zetaButton = getAgentButton('Zeta');
      const alphaButton = getAgentButton('Alpha');
      const unusedButton = getAgentButton('Unused');

      expect(defaultButton.compareDocumentPosition(zetaButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(zetaButton.compareDocumentPosition(alphaButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(alphaButton.compareDocumentPosition(unusedButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      agentsState.agents = [];
      chatState.desktopSessions = [];
    }
  });

  it('navigates to chat immediately with the requested agent instead of waiting for main session loading', async () => {
    agentsState.agents = [
      {
        id: 'agent-1',
        name: 'Alpha',
        isDefault: false,
      },
    ];

    try {
      const { Sidebar } = await import('@/components/layout/Sidebar');

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
      expect(chatState.openAgentMainSession).not.toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/chat', { state: { requestedAgentId: 'agent-1' } });
    } finally {
      agentsState.agents = [];
    }
  });
});
