import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';

const initialAgentsState = useAgentsStore.getState();
const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

async function flushPromises(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('chat store agent deletion fallback', () => {
  beforeEach(() => {
    useAgentsStore.setState(initialAgentsState, true);
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
  });

  it('switches to a fallback agent when the current agent is deleted', async () => {
    useAgentsStore.setState({
      agents: [
        {
          id: 'main',
          name: 'Main',
          isDefault: true,
          modelDisplay: 'gpt-4.1',
          inheritedModel: false,
          workspace: '/tmp/main',
          agentDir: '/tmp/main/agent',
          mainSessionKey: 'agent:main:main',
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

    const openAgentMainSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentAgentId: 'writer',
      currentSessionKey: 'agent:writer:main',
      openAgentMainSession,
    });

    const { handleAgentDeleted } = useChatStore.getState() as unknown as {
      handleAgentDeleted: (agentId: string) => Promise<void>;
    };

    await handleAgentDeleted('writer');

    expect(openAgentMainSession).toHaveBeenCalledWith('main');
  });

  it('does nothing when deleting a non-active agent', async () => {
    const openAgentMainSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentAgentId: 'main',
      currentSessionKey: 'agent:main:main',
      openAgentMainSession,
    });

    const { handleAgentDeleted } = useChatStore.getState() as unknown as {
      handleAgentDeleted: (agentId: string) => Promise<void>;
    };

    await handleAgentDeleted('writer');

    expect(openAgentMainSession).not.toHaveBeenCalled();
  });
});

describe('chat store internal final message handling', () => {
  beforeEach(() => {
    useAgentsStore.setState(initialAgentsState, true);
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
  });

  it('reloads history after an internal NO_REPLY final message', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          messages: [
            { role: 'user', content: 'hello', id: 'u1', timestamp: 1 },
            { role: 'assistant', content: 'Real answer', id: 'a2', timestamp: 2 },
          ],
        };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      return {};
    });

    useGatewayStore.setState({
      rpc: rpcMock as never,
    });
    useChatStore.setState({
      currentSessionKey: 'agent:main:geeclaw_main',
      currentAgentId: 'main',
      currentViewMode: 'session',
      sending: true,
      activeRunId: 'run-internal',
      streamingText: 'NO_REPLY',
      streamingTextStartedAt: 1,
      streamingTextLastEventAt: 1,
      pendingFinal: true,
      messages: [
        { role: 'user', content: 'hello', id: 'u1-local', timestamp: 1 },
      ],
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-internal',
      sessionKey: 'agent:main:geeclaw_main',
      message: { role: 'assistant', content: 'NO_REPLY', id: 'a1', timestamp: 2 },
    });

    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:geeclaw_main',
      limit: 200,
    });
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'hello',
      'Real answer',
    ]);
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().streamingText).toBe('');
  });
});

describe('chat store terminal model error handling', () => {
  beforeEach(() => {
    useAgentsStore.setState(initialAgentsState, true);
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
  });

  it('treats assistant finals with stopReason=error as terminal run errors', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { role: 'user', content: '你是什么模型？', id: 'u1-history', timestamp: 1 },
            {
              role: 'assistant',
              id: 'assistant-error-history',
              content: [],
              stopReason: 'error',
              errorMessage: '404 Resource not found',
              timestamp: 2,
            },
          ],
        };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'agent:main:geeclaw_main',
      currentAgentId: 'main',
      currentViewMode: 'session',
      sending: true,
      activeRunId: 'run-model-error',
      pendingFinal: true,
      streamingText: '',
      messages: [
        { role: 'user', content: '你是什么模型？', id: 'u1', timestamp: 1 },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-model-error',
      sessionKey: 'agent:main:geeclaw_main',
      message: {
        role: 'assistant',
        id: 'assistant-error',
        content: [],
        stopReason: 'error',
        errorMessage: '404 Resource not found',
        timestamp: 2,
      },
    });

    const state = useChatStore.getState() as unknown as {
      error: string | null;
      runError: string | null;
      sending: boolean;
      activeRunId: string | null;
      pendingFinal: boolean;
    };
    expect(state.error).toBeNull();
    expect(state.runError).toBe('404 Resource not found');
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);

    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:geeclaw_main',
      limit: 200,
    });
  });

  it('treats assistant isError payloads as terminal run errors', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { role: 'user', content: '继续', id: 'u1-history', timestamp: 1 },
            {
              role: 'assistant',
              id: 'assistant-incomplete-turn-error-history',
              content: "⚠️ Agent couldn't generate a response. Please try again.",
              isError: true,
              timestamp: 2,
            },
          ],
        };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'agent:main:geeclaw_main',
      currentAgentId: 'main',
      currentViewMode: 'session',
      sending: true,
      activeRunId: 'run-incomplete-turn',
      pendingFinal: true,
      streamingText: '',
      messages: [
        { role: 'user', content: '继续', id: 'u1', timestamp: 1 },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-incomplete-turn',
      sessionKey: 'agent:main:geeclaw_main',
      message: {
        role: 'assistant',
        id: 'assistant-incomplete-turn-error',
        content: "⚠️ Agent couldn't generate a response. Please try again.",
        isError: true,
        timestamp: 2,
      },
    });

    const state = useChatStore.getState() as unknown as {
      error: string | null;
      runError: string | null;
      sending: boolean;
      activeRunId: string | null;
      pendingFinal: boolean;
    };
    expect(state.error).toBeNull();
    expect(state.runError).toBe("⚠️ Agent couldn't generate a response. Please try again.");
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);

    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:geeclaw_main',
      limit: 200,
    });
  });

  it('does not drop terminal assistant errors when runtime runId differs from the active run', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { role: 'user', content: '继续', id: 'u1-history', timestamp: 1 },
            {
              role: 'assistant',
              id: 'assistant-incomplete-turn-error-history',
              content: "⚠️ Agent couldn't generate a response. Please try again.",
              isError: true,
              timestamp: 2,
            },
          ],
        };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'agent:main:geeclaw_main',
      currentAgentId: 'main',
      currentViewMode: 'session',
      sending: true,
      activeRunId: 'run-started',
      pendingFinal: true,
      streamingText: '',
      messages: [
        { role: 'user', content: '继续', id: 'u1', timestamp: 1 },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-runtime-incomplete',
      sessionKey: 'agent:main:geeclaw_main',
      message: {
        role: 'assistant',
        id: 'assistant-incomplete-turn-error',
        content: "⚠️ Agent couldn't generate a response. Please try again.",
        isError: true,
        timestamp: 2,
      },
    });

    const state = useChatStore.getState() as unknown as {
      error: string | null;
      runError: string | null;
      sending: boolean;
      activeRunId: string | null;
    };
    expect(state.error).toBeNull();
    expect(state.runError).toBe("⚠️ Agent couldn't generate a response. Please try again.");
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();

    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:geeclaw_main',
      limit: 200,
    });
  });

  it('keeps stderr-bridged terminal errors when the follow-up history reload has no persisted error', async () => {
    await i18n.changeLanguage('zh');
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { role: 'user', content: '继续', id: 'u1-history', timestamp: 1 },
          ],
        };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'agent:main:geeclaw_main',
      currentAgentId: 'main',
      currentViewMode: 'session',
      sending: true,
      activeRunId: 'run-incomplete-turn',
      pendingFinal: true,
      streamingText: '',
      messages: [
        { role: 'user', content: '继续', id: 'u1', timestamp: 1 },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-incomplete-turn',
      state: 'error',
      errorCode: 'gateway.incompleteTurn',
      message: {
        role: 'assistant',
        content: '',
        stopReason: 'error',
        errorCode: 'gateway.incompleteTurn',
        isError: true,
        timestamp: 2,
      },
    });

    await flushPromises();

    const state = useChatStore.getState() as unknown as {
      error: string | null;
      runError: string | null;
      sending: boolean;
      activeRunId: string | null;
    };
    expect(state.error).toBeNull();
    expect(state.runError).toBe('Agent 未能生成回复，请重试');
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:geeclaw_main',
      limit: 200,
    });
  });

  it('localizes terminal assistant errors found in history by structured error code', async () => {
    await i18n.changeLanguage('zh');
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          messages: [
            { role: 'user', content: '继续', id: 'u1-history', timestamp: 1 },
            {
              role: 'assistant',
              id: 'assistant-incomplete-turn-error-history',
              content: '',
              stopReason: 'error',
              errorCode: 'gateway.incompleteTurn',
              isError: true,
              timestamp: 2,
            },
          ],
        };
      }
      return {};
    });
    useGatewayStore.setState({ rpc: rpcMock as never });
    useChatStore.setState({
      currentSessionKey: 'agent:main:geeclaw_main',
      currentAgentId: 'main',
      currentViewMode: 'session',
      sending: true,
      activeRunId: 'run-incomplete-turn',
      pendingFinal: true,
      lastUserMessageAt: 1,
      messages: [
        { role: 'user', content: '继续', id: 'u1', timestamp: 1 },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState() as unknown as {
      error: string | null;
      runError: string | null;
      sending: boolean;
      activeRunId: string | null;
    };
    expect(state.error).toBeNull();
    expect(state.runError).toBe('Agent 未能生成回复，请重试');
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
  });
});
