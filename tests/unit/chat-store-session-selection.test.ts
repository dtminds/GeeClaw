import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import { AppError } from '@/lib/error-model';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import type { DesktopSessionSummary } from '@/stores/chat';

const initialAgentsState = useAgentsStore.getState();
const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

const mainSession: DesktopSessionSummary = {
  id: 'desktop-main',
  gatewaySessionKey: 'agent:main:geeclaw_main',
  title: '',
  lastMessagePreview: '',
  createdAt: 1,
  updatedAt: 1,
};

const writerSession: DesktopSessionSummary = {
  id: 'desktop-writer',
  gatewaySessionKey: 'agent:writer:geeclaw_main',
  title: '',
  lastMessagePreview: '',
  createdAt: 2,
  updatedAt: 2,
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('chat store session selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentsStore.setState(initialAgentsState, true);
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState({
      ...initialGatewayState,
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history') {
          return { messages: [] };
        }
        return {};
      }),
    });

    useAgentsStore.setState({
      ...useAgentsStore.getState(),
      agents: [
        {
          id: 'main',
          name: 'Main',
          isDefault: true,
          modelDisplay: 'gpt-4.1',
          inheritedModel: false,
          workspace: '/tmp/main',
          agentDir: '/tmp/main/agent',
          mainSessionKey: 'agent:main:geeclaw_main',
          channelTypes: [],
          channelAccounts: [],
          source: 'custom',
          managed: false,
          presetId: undefined,
          lockedFields: [],
          canUnmanage: false,
          managedFiles: [],
          skillScope: { mode: 'default' },
          presetSkills: [],
          canUseDefaultSkillScope: true,
        },
        {
          id: 'writer',
          name: 'Writer',
          isDefault: false,
          modelDisplay: 'gpt-4.1',
          inheritedModel: false,
          workspace: '/tmp/writer',
          agentDir: '/tmp/writer/agent',
          mainSessionKey: 'agent:writer:geeclaw_main',
          channelTypes: [],
          channelAccounts: [],
          source: 'custom',
          managed: false,
          presetId: undefined,
          lockedFields: [],
          canUnmanage: false,
          managedFiles: [],
          skillScope: { mode: 'default' },
          presetSkills: [],
          canUseDefaultSkillScope: true,
        },
      ],
      defaultAgentId: 'main',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the targeted agent selected when session refresh does not include the newly created main session yet', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      session: writerSession,
    });

    await useChatStore.getState().openAgentMainSession('writer');

    expect(useChatStore.getState().currentAgentId).toBe('writer');
    expect(useChatStore.getState().currentSessionKey).toBe('agent:writer:geeclaw_main');

    hostApiFetchMock.mockResolvedValue({
      sessions: [mainSession],
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentAgentId).toBe('writer');
    expect(useChatStore.getState().currentDesktopSessionId).toBe(writerSession.id);
    expect(useChatStore.getState().currentSessionKey).toBe(writerSession.gatewaySessionKey);
    expect(useChatStore.getState().desktopSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: writerSession.id,
          gatewaySessionKey: writerSession.gatewaySessionKey,
        }),
      ]),
    );
  });

  it('does not auto-delete an empty main session during cleanup', async () => {
    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession, mainSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      isDraftSession: false,
      messages: [],
    });

    await useChatStore.getState().cleanupEmptySession();

    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().desktopSessions).toEqual([writerSession, mainSession]);
    expect(useChatStore.getState().currentSessionKey).toBe(writerSession.gatewaySessionKey);
  });

  it('loads desktop session summaries without forcing chat history', async () => {
    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [],
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: 'main',
      isDraftSession: false,
    });

    hostApiFetchMock.mockResolvedValueOnce({
      sessions: [writerSession, mainSession],
    });

    await useChatStore.getState().loadDesktopSessionSummaries();

    expect(useChatStore.getState().desktopSessions).toEqual([writerSession, mainSession]);
    expect(useChatStore.getState().currentSessionKey).toBe('');
    expect(useChatStore.getState().currentDesktopSessionId).toBe('');
    expect(useChatStore.getState().currentAgentId).toBe('main');
  });

  it('refreshes session selection without eagerly loading chat history', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      return {};
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: rpcMock,
    });

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [],
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: 'writer',
      isDraftSession: false,
    });

    hostApiFetchMock.mockResolvedValueOnce({
      sessions: [writerSession, mainSession],
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe(writerSession.gatewaySessionKey);
    expect(useChatStore.getState().currentDesktopSessionId).toBe(writerSession.id);
    expect(rpcMock).toHaveBeenCalledWith('sessions.list', {});
    expect(rpcMock).not.toHaveBeenCalledWith('chat.history', expect.anything());
  });

  it('marks the chat as loading while opening an existing agent main session history', async () => {
    const historyDeferred = createDeferred<{ messages: [] }>();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession, mainSession],
      currentDesktopSessionId: mainSession.id,
      currentSessionKey: mainSession.gatewaySessionKey,
      currentAgentId: 'main',
      loading: false,
      messages: [{ id: 'old', role: 'assistant', content: 'stale' }],
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history') {
          return historyDeferred.promise;
        }
        return {};
      }),
    });

    const openPromise = useChatStore.getState().openAgentMainSession('writer');

    expect(useChatStore.getState().currentSessionKey).toBe(writerSession.gatewaySessionKey);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().loading).toBe(true);

    historyDeferred.resolve({ messages: [] });
    await openPromise;

    expect(useChatStore.getState().loading).toBe(false);
  });

  it('retries history loading when gateway startup unavailability is surfaced via structured error metadata', async () => {
    vi.useFakeTimers();

    hostApiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/desktop-sessions/desktop-main' && init?.method === 'PUT') {
        return { success: true, session: { ...mainSession, lastMessagePreview: 'main session', updatedAt: 1000 } };
      }
      return { sessions: [] };
    });

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [mainSession],
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: 'main',
      loading: false,
      messages: [],
      error: null,
    });

    let historyCalls = 0;
    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history' && params?.sessionKey === mainSession.gatewaySessionKey) {
          historyCalls += 1;
          if (historyCalls === 1) {
            throw new AppError('GATEWAY', 'gateway startup still warming history', undefined, {
              gatewayErrorCode: 'CHAT_HISTORY_STARTUP_UNAVAILABLE',
            });
          }
          return {
            messages: [{ id: 'main-msg', role: 'assistant', content: 'main session', timestamp: 1 }],
          };
        }
        return {};
      }),
    });

    await useChatStore.getState().openAgentMainSession('main');

    expect(historyCalls).toBe(1);
    expect(useChatStore.getState().loading).toBe(true);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().error).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);

    expect(historyCalls).toBe(2);
    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'main-msg', content: 'main session' }),
    ]);
    expect(useChatStore.getState().currentSessionKey).toBe(mainSession.gatewaySessionKey);
    expect(useChatStore.getState().isDraftSession).toBe(false);
  });

  it('stops retrying chat history after bounded startup attempts and surfaces the error', async () => {
    vi.useFakeTimers();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [mainSession],
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: 'main',
      loading: false,
      messages: [],
      error: null,
    });

    let historyCalls = 0;
    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history' && params?.sessionKey === mainSession.gatewaySessionKey) {
          historyCalls += 1;
          throw new AppError('GATEWAY', `startup unavailable attempt ${historyCalls}`, undefined, {
            gatewayErrorCode: 'CHAT_HISTORY_STARTUP_UNAVAILABLE',
          });
        }
        return {};
      }),
    });

    await useChatStore.getState().openAgentMainSession('main');

    expect(historyCalls).toBe(1);
    expect(useChatStore.getState().loading).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(historyCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(historyCalls).toBe(3);

    await vi.advanceTimersByTimeAsync(4000);
    expect(historyCalls).toBe(4);

    await vi.advanceTimersByTimeAsync(10000);
    expect(historyCalls).toBe(4);
    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().error).toContain('startup unavailable attempt 4');
  });

  it('keeps existing messages visible while startup retries run in the background', async () => {
    vi.useFakeTimers();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      loading: false,
      messages: [{ id: 'existing-msg', role: 'assistant', content: 'existing session', timestamp: 1 }],
      error: null,
    });

    let historyCalls = 0;
    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history' && params?.sessionKey === writerSession.gatewaySessionKey) {
          historyCalls += 1;
          if (historyCalls === 1) {
            throw new AppError('GATEWAY', 'startup unavailable while existing messages are visible', undefined, {
              gatewayErrorCode: 'CHAT_HISTORY_STARTUP_UNAVAILABLE',
            });
          }
          return {
            messages: [{ id: 'writer-msg', role: 'assistant', content: 'writer session', timestamp: 2 }],
          };
        }
        return {};
      }),
    });

    const loadPromise = useChatStore.getState().loadHistory();
    await Promise.resolve();

    expect(historyCalls).toBe(1);
    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'existing-msg', content: 'existing session' }),
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    await loadPromise;

    expect(historyCalls).toBe(2);
    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'writer-msg', content: 'writer session' }),
    ]);
  });

  it('clears stale errors after a successful quiet history reload', async () => {
    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      loading: false,
      messages: [{ id: 'existing-msg', role: 'assistant', content: 'existing session', timestamp: 1 }],
      error: 'previous transient failure',
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history' && params?.sessionKey === writerSession.gatewaySessionKey) {
          return {
            messages: [{ id: 'writer-msg', role: 'assistant', content: 'writer session', timestamp: 2 }],
          };
        }
        return {};
      }),
    });

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'writer-msg', content: 'writer session' }),
    ]);
    expect(useChatStore.getState().error).toBeNull();
  });

  it('ignores stale history responses after the selected session changes', async () => {
    const historyDeferred = createDeferred<{ messages: Array<{ id: string; role: 'assistant'; content: string; timestamp: number }> }>();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession, mainSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      loading: false,
      messages: [],
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history') {
          if (params?.sessionKey === writerSession.gatewaySessionKey) {
            return historyDeferred.promise;
          }
          return { messages: [] };
        }
        return {};
      }),
    });

    const initialLoadPromise = useChatStore.getState().loadHistory(true);

    useChatStore.setState({
      ...useChatStore.getState(),
      currentDesktopSessionId: mainSession.id,
      currentSessionKey: mainSession.gatewaySessionKey,
      currentAgentId: 'main',
      messages: [{ id: 'main-msg', role: 'assistant', content: 'main session', timestamp: 2 }],
    });

    historyDeferred.resolve({
      messages: [{ id: 'writer-msg', role: 'assistant', content: 'writer session', timestamp: 1 }],
    });

    await initialLoadPromise;

    expect(useChatStore.getState().currentSessionKey).toBe(mainSession.gatewaySessionKey);
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'main-msg', content: 'main session' }),
    ]);
  });

  it('shows chat history before session token info refresh completes', async () => {
    const tokenInfoDeferred = createDeferred<{ sessions: [] }>();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      loading: false,
      messages: [],
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/desktop-sessions/')) {
        return { success: true, session: writerSession };
      }
      return { sessions: [] };
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'chat.history' && params?.sessionKey === writerSession.gatewaySessionKey) {
          return {
            messages: [{ id: 'writer-msg', role: 'assistant', content: 'writer session', timestamp: 1 }],
          };
        }
        if (method === 'sessions.list') {
          return tokenInfoDeferred.promise;
        }
        return {};
      }),
    });

    const loadPromise = useChatStore.getState().loadHistory();
    await Promise.resolve();

    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'writer-msg', content: 'writer session' }),
    ]);

    tokenInfoDeferred.resolve({ sessions: [] });
    await loadPromise;
  });

  it('shows chat history before attachment preview hydration completes', async () => {
    const thumbnailsDeferred = createDeferred<Record<string, { exists: boolean; preview: string | null; fileSize: number }>>();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      loading: false,
      messages: [],
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/files/thumbnails') {
        return thumbnailsDeferred.promise;
      }
      if (path.startsWith('/api/desktop-sessions/')) {
        return { success: true, session: writerSession };
      }
      return { sessions: [] };
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history' && params?.sessionKey === writerSession.gatewaySessionKey) {
          return {
            messages: [{
              id: 'writer-msg',
              role: 'assistant',
              content: 'image response',
              timestamp: 1,
              _attachedFiles: [
                {
                  fileName: 'image.png',
                  mimeType: 'image/png',
                  fileSize: 0,
                  preview: null,
                  filePath: '/tmp/image.png',
                },
              ],
            }],
          };
        }
        return {};
      }),
    });

    const loadPromise = useChatStore.getState().loadHistory();
    await Promise.resolve();

    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'writer-msg', content: 'image response' }),
    ]);

    thumbnailsDeferred.resolve({
      '/tmp/image.png': {
        exists: true,
        preview: 'data:image/png;base64,preview',
        fileSize: 42,
      },
    });
    await loadPromise;
  });

  it('preserves newer messages when attachment preview hydration finishes', async () => {
    const thumbnailsDeferred = createDeferred<Record<string, { exists: boolean; preview: string | null; fileSize: number }>>();

    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      loading: false,
      messages: [],
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/files/thumbnails') {
        return thumbnailsDeferred.promise;
      }
      if (path.startsWith('/api/desktop-sessions/')) {
        return { success: true, session: writerSession };
      }
      return { sessions: [] };
    });

    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      rpc: vi.fn(async (method: string, params?: { sessionKey?: string }) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history' && params?.sessionKey === writerSession.gatewaySessionKey) {
          return {
            messages: [{
              id: 'writer-msg',
              role: 'assistant',
              content: 'image response',
              timestamp: 1,
              _attachedFiles: [
                {
                  fileName: 'image.png',
                  mimeType: 'image/png',
                  fileSize: 0,
                  preview: null,
                  filePath: '/tmp/image.png',
                },
              ],
            }],
          };
        }
        return {};
      }),
    });

    await useChatStore.getState().loadHistory();

    useChatStore.setState((state) => ({
      ...state,
      messages: [
        ...state.messages,
        {
          id: 'new-msg',
          role: 'user',
          content: 'newer optimistic message',
          timestamp: 2,
        },
      ],
    }));

    thumbnailsDeferred.resolve({
      '/tmp/image.png': {
        exists: true,
        preview: 'data:image/png;base64,preview',
        fileSize: 42,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.id)).toEqual(['writer-msg', 'new-msg']);
    expect(messages[0]?._attachedFiles?.[0]?.preview).toBe('data:image/png;base64,preview');
    expect(messages[0]?._attachedFiles?.[0]?.fileSize).toBe(42);
    expect(messages[1]?.id).toBe('new-msg');
    expect(messages[1]?.content).toBe('newer optimistic message');
  });
});
