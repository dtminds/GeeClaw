import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
  it('opens the requested agent main session after chat page mount', async () => {
    const { Chat } = await import('@/pages/Chat');

    render(
      <MemoryRouter initialEntries={[{ pathname: '/chat', state: { requestedAgentId: 'writer' } }]}>
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
      <MemoryRouter initialEntries={[{ pathname: '/chat', state: { requestedAgentId: 'writer' } }]}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(agentsState.fetchAgents).toHaveBeenCalled();
      expect(chatState.openAgentMainSession).toHaveBeenCalledWith('writer');
    });

    fetchAgentsDeferred.resolve();
  });
});
