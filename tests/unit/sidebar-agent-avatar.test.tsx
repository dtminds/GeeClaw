import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = {
  sidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
};

const chatState = {
  desktopSessions: [
    {
      gatewaySessionKey: 'agent:alpha:main',
      updatedAt: '2026-03-31T08:00:00.000Z',
      lastMessagePreview: '',
    },
  ],
  currentAgentId: 'alpha',
  loadDesktopSessionSummaries: vi.fn(async () => undefined),
};

const agentsState = {
  agents: [
    {
      id: 'alpha',
      name: 'Alpha',
      isDefault: true,
      modelDisplay: 'gpt-4.1',
      inheritedModel: false,
      workspace: '/tmp/alpha',
      agentDir: '/tmp/alpha/agent',
      mainSessionKey: 'agent:alpha:main',
      channelTypes: [],
      channelAccounts: [],
      source: 'custom',
      managed: false,
      presetId: undefined,
      packageVersion: undefined,
      lockedFields: [],
      canUnmanage: false,
      managedFiles: [],
      skillScope: { mode: 'default' },
      presetSkills: [],
      canUseDefaultSkillScope: true,
      avatarPresetId: 'chibi-coder',
      avatarSource: 'user',
    },
  ],
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

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'sidebar.onlineCount') return `${options?.count ?? 0} online`;
      if (key === 'sidebar.offlineCount') return '0 online';
      if (key === 'sidebar.switchToAgent') return `Switch to ${options?.name ?? ''}`;
      return key;
    },
  }),
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

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(async () => undefined),
}));

describe('Sidebar agent avatars', () => {
  beforeEach(() => {
    settingsState.sidebarCollapsed = false;
  });

  it('renders full avatars in the expanded sidebar', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const agentButton = screen.getByRole('button', { name: /Alpha/i });
    const avatar = within(agentButton).getByTestId('agent-avatar');
    expect(avatar).toHaveAttribute('data-avatar-size', 'full');
    expect(avatar).toHaveAttribute('data-avatar-preset', 'chibi-coder');
  });

  it('renders compact avatars in the collapsed sidebar', async () => {
    settingsState.sidebarCollapsed = true;
    const { Sidebar } = await import('@/components/layout/Sidebar');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const avatar = within(screen.getByRole('button', { name: 'Switch to Alpha' })).getByTestId('agent-avatar');
    expect(avatar).toHaveAttribute('data-avatar-size', 'compact');
    expect(avatar).toHaveAttribute('data-avatar-preset', 'chibi-coder');
  });
});
