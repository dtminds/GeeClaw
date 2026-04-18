import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const capturedChatInputProps: Array<Record<string, unknown>> = [];

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
  loadSessions: vi.fn(async () => undefined),
  openAgentMainSession: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
  abortRun: vi.fn(async () => undefined),
  clearError: vi.fn(),
  cleanupEmptySession: vi.fn(async () => undefined),
};

const agentsState = {
  agents: [{ id: 'main', name: 'Main' }],
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

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/components/common/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading</div>,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: (props: Record<string, unknown>) => {
    capturedChatInputProps.push(props);
    return <div>ChatInput</div>;
  },
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
  BrandOrbLogo: () => <div data-testid="brand-orb-logo">BrandOrbLogo</div>,
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

describe('Chat model gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedChatInputProps.length = 0;
    chatState.loading = false;
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/agents/default-model') {
        return {
          model: { configured: false, primary: null, fallbacks: [] },
          imageModel: { configured: false, primary: null, fallbacks: [] },
          pdfModel: { configured: false, primary: null, fallbacks: [] },
          imageGenerationModel: { configured: false, primary: null, fallbacks: [] },
          videoGenerationModel: { configured: false, primary: null, fallbacks: [] },
          primary: null,
          fallbacks: [],
          availableModels: [],
        };
      }
      return {};
    });
  });

  it('routes users to model providers when no provider models are available', async () => {
    const { Chat } = await import('@/pages/Chat');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/default-model');
      expect(capturedChatInputProps.at(-1)).toMatchObject({
        disabled: true,
        disabledAction: {
          to: '/settings/model-providers',
        },
      });
    });
  });

  it('routes users to model config when provider models exist but no default chat model is configured', async () => {
    hostApiFetchMock.mockImplementationOnce(async (path: string) => {
      if (path === '/api/agents/default-model') {
        return {
          model: { configured: false, primary: null, fallbacks: [] },
          imageModel: { configured: false, primary: null, fallbacks: [] },
          pdfModel: { configured: false, primary: null, fallbacks: [] },
          imageGenerationModel: { configured: false, primary: null, fallbacks: [] },
          videoGenerationModel: { configured: false, primary: null, fallbacks: [] },
          primary: null,
          fallbacks: [],
          availableModels: [
            {
              providerId: 'openai',
              providerName: 'OpenAI',
              modelRefs: ['openai/gpt-5.4'],
            },
          ],
        };
      }
      return {};
    });

    const { Chat } = await import('@/pages/Chat');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(capturedChatInputProps.at(-1)).toMatchObject({
        disabled: true,
        disabledAction: {
          to: '/settings/model-config',
        },
      });
    });
  });

  it('shows the brand orb and disables the composer while chat history is loading', async () => {
    chatState.loading = true;
    hostApiFetchMock.mockImplementationOnce(async (path: string) => {
      if (path === '/api/agents/default-model') {
        return {
          model: { configured: true, primary: 'openai/gpt-5.4', fallbacks: [] },
          imageModel: { configured: false, primary: null, fallbacks: [] },
          pdfModel: { configured: false, primary: null, fallbacks: [] },
          imageGenerationModel: { configured: false, primary: null, fallbacks: [] },
          videoGenerationModel: { configured: false, primary: null, fallbacks: [] },
          primary: 'openai/gpt-5.4',
          fallbacks: [],
          availableModels: [
            {
              providerId: 'openai',
              providerName: 'OpenAI',
              modelRefs: ['openai/gpt-5.4'],
            },
          ],
        };
      }
      return {};
    });

    const { Chat } = await import('@/pages/Chat');
    const { screen } = await import('@testing-library/react');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Chat />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('brand-orb-logo')).toBeInTheDocument();
      expect(screen.getByText('loadingSessionInit')).toBeInTheDocument();
      expect(capturedChatInputProps.at(-1)).toMatchObject({
        disabled: true,
      });
    });
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });
});
