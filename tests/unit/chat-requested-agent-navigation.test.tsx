import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const chatState = {
  messages: [],
  loading: false,
  sending: false,
  error: null,
  showThinking: false,
  showToolCalls: true,
  streamingText: '',
  streamingTextStartedAt: null,
  streamSegments: [],
  toolMessages: [],
  pendingFinal: false,
  currentDesktopSessionId: 'desktop-main-tmp',
  currentSessionKey: 'agent:main:geeclaw_tmp_123',
  currentViewMode: 'session' as const,
  selectedCronRun: null,
  loadHistory: vi.fn(async () => undefined),
  loadDesktopSessionSummaries: vi.fn(async () => undefined),
  loadSessions: vi.fn(async () => undefined),
  openAgentMainSession: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
  abortRun: vi.fn(async () => undefined),
  clearError: vi.fn(),
  cleanupEmptySession: vi.fn(async () => undefined),
};

const agentsState = {
  agents: [
    { id: 'main', name: 'Main' },
    { id: 'writer', name: 'Writer' },
  ],
  fetchAgents: vi.fn(async () => undefined),
};

const gatewayState = {
  status: { state: 'running' as const },
};

const settingsState = {
  chatSessionsPanelCollapsed: false,
};

const useChatStoreMock = Object.assign(
  (selector: (state: typeof chatState) => unknown) => selector(chatState),
  {
    getState: () => chatState,
  },
);

vi.mock('@/stores/chat', () => ({
  useChatStore: useChatStoreMock,
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/components/common/LoadingSpinner', () => ({
  LoadingSpinner: () => <div>Loading</div>,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => <div>ChatInput</div>,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => <div>ChatToolbar</div>,
}));

vi.mock('@/pages/Chat/ChatSessionsPanel', () => ({
  ChatSessionsPanel: () => <div>ChatSessionsPanel</div>,
}));

vi.mock('@/pages/Chat/ChatMessagesViewport', () => ({
  ChatMessagesViewport: () => <div>ChatMessagesViewport</div>,
}));

vi.mock('@/pages/Chat/useAutoScroll', () => ({
  useAutoScroll: () => ({
    containerRef: { current: null },
    innerRef: { current: null },
    isAutoScrollEnabled: true,
    scrollToBottomAndFollow: vi.fn(),
  }),
}));

vi.mock('@/pages/Chat/build-chat-items', () => ({
  buildChatItems: () => [],
}));

vi.mock('@/components/branding/BrandOrbLogo', () => ({
  BrandOrbLogo: () => <div>BrandOrbLogo</div>,
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

describe('Chat requested-agent navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatState.messages = [];
    chatState.loading = false;
    chatState.currentDesktopSessionId = 'desktop-main-tmp';
    chatState.currentSessionKey = 'agent:main:geeclaw_tmp_123';
    chatState.loadHistory = vi.fn(async () => undefined);
    chatState.loadDesktopSessionSummaries = vi.fn(async () => undefined);
    chatState.loadSessions = vi.fn(async () => undefined);
    chatState.openAgentMainSession = vi.fn(async () => undefined);
    chatState.cleanupEmptySession = vi.fn(async () => undefined);
    agentsState.fetchAgents = vi.fn(async () => undefined);
  });

  it('opens the requested agent main session after chat page mount', async () => {
    const { Chat } = await import('@/pages/Chat');

    render(
      <MemoryRouter initialEntries={[{ pathname: '/chat', key: 'req-writer-open', state: { requestedAgentId: 'writer' } }]}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(agentsState.fetchAgents).toHaveBeenCalled();
      expect(chatState.openAgentMainSession).toHaveBeenCalledWith('writer');
      expect(chatState.loadDesktopSessionSummaries).not.toHaveBeenCalled();
    });
  });

  it('does not wait for fetchAgents before opening the requested agent main session', async () => {
    const fetchAgentsDeferred = createDeferred<void>();
    agentsState.fetchAgents = vi.fn(() => fetchAgentsDeferred.promise);

    const { Chat } = await import('@/pages/Chat');

    render(
      <MemoryRouter initialEntries={[{ pathname: '/chat', key: 'req-writer-no-wait', state: { requestedAgentId: 'writer' } }]}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(agentsState.fetchAgents).toHaveBeenCalled();
      expect(chatState.openAgentMainSession).toHaveBeenCalledWith('writer');
    });

    fetchAgentsDeferred.resolve();
  });

  it('consumes requestedAgentId before a strict-mode remount can reopen the session', async () => {
    const openDeferred = createDeferred<void>();
    chatState.openAgentMainSession = vi.fn(() => openDeferred.promise);

    const { Chat } = await import('@/pages/Chat');

    render(
      <StrictMode>
        <MemoryRouter initialEntries={[{ pathname: '/chat', key: 'req-main-strict', state: { requestedAgentId: 'main' } }]}>
          <Chat />
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(chatState.openAgentMainSession).toHaveBeenCalledTimes(1);
      expect(chatState.openAgentMainSession).toHaveBeenCalledWith('main');
    });

    openDeferred.resolve();
  });

  it('loads startup history only once after the initial session selection resolves', async () => {
    const { Chat } = await import('@/pages/Chat');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(agentsState.fetchAgents).toHaveBeenCalled();
      expect(chatState.loadSessions).toHaveBeenCalledTimes(1);
      expect(chatState.loadHistory).toHaveBeenCalledTimes(1);
    });
  });
});
