import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn(async () => undefined);

const settingsState = {
  sidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
};

const chatState = {
  desktopSessions: [],
  currentAgentId: 'main',
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
  'sidebar.agentMainSessionHint': 'Open session',
  'sidebar.expand': 'Expand sidebar',
  'sidebar.collapse': 'Collapse sidebar',
  'actions.cancel': 'Cancel',
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
    chatState.openAgentMainSession.mockReset().mockResolvedValue(undefined);
    agentsState.fetchAgents.mockReset().mockResolvedValue(undefined);
    channelsState.fetchChannels.mockReset().mockResolvedValue(undefined);
    bootstrapState.logoutToLogin.mockReset().mockResolvedValue(undefined);
    invokeIpcMock.mockReset().mockResolvedValue(undefined);

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
});
