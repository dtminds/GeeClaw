import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';

const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

describe('chat tool result history fallback', () => {
  beforeEach(() => {
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState(initialGatewayState, true);
  });

  it('triggers a quiet history reload once per tool call when a tool result stream ends without output', () => {
    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      loadHistory: loadHistoryMock,
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'result',
        isError: false,
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'result',
        isError: false,
      },
    });

    expect(loadHistoryMock).toHaveBeenCalledTimes(1);
    expect(loadHistoryMock).toHaveBeenCalledWith(true);
  });

  it('updates the live tool card once history contains the persisted result for the same tool call', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          thinkingLevel: 'high',
          messages: [
            {
              role: 'assistant',
              id: 'assistant-tool-1',
              timestamp: 1,
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-1',
                  name: 'exec',
                  arguments: { command: 'pwd' },
                },
              ],
            },
            {
              role: 'toolresult',
              id: 'tool-result-1',
              toolCallId: 'tool-1',
              toolName: 'exec',
              timestamp: 2,
              content: [
                {
                  type: 'text',
                  text: '/workspace',
                },
              ],
            },
          ],
        };
      }

      if (method === 'sessions.list') {
        return { sessions: [] };
      }

      throw new Error(`Unexpected RPC method: ${method}`);
    });

    useGatewayStore.setState({
      rpc: rpcMock as never,
    });
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      messages: [],
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'result',
        isError: false,
      },
    });

    expect(useChatStore.getState().toolMessages).toHaveLength(1);

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().toolMessages).toHaveLength(1);
    expect(useChatStore.getState().toolMessages[0]?._toolStatuses?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      status: 'completed',
      result: '/workspace',
    });
  });

  it('only patches tool history during an active send and ignores assistant text from chat.history', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          thinkingLevel: 'high',
          messages: [
            {
              role: 'assistant',
              id: 'assistant-tool-1',
              timestamp: 1,
              content: [
                {
                  type: 'text',
                  text: '你好，老板！我是 Friday。很高兴为你服务。',
                },
                {
                  type: 'toolCall',
                  id: 'tool-1',
                  name: 'exec',
                  arguments: { command: 'pwd' },
                },
              ],
            },
            {
              role: 'toolresult',
              id: 'tool-result-1',
              toolCallId: 'tool-1',
              toolName: 'exec',
              timestamp: 2,
              content: [
                {
                  type: 'text',
                  text: '/workspace',
                },
              ],
            },
            {
              role: 'assistant',
              id: 'assistant-final-1',
              timestamp: 3,
              content: '杭州现在有小雨，气温 17°C。',
            },
          ],
        };
      }

      if (method === 'sessions.list') {
        return { sessions: [] };
      }

      throw new Error(`Unexpected RPC method: ${method}`);
    });

    useGatewayStore.setState({
      rpc: rpcMock as never,
    });
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      messages: [
        {
          role: 'user',
          id: 'user-1',
          timestamp: 0,
          content: '查一下杭州天气',
        },
      ],
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'start',
        args: { command: 'pwd' },
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-1',
        name: 'exec',
        phase: 'result',
        isError: false,
      },
    });

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({
        role: 'user',
        id: 'user-1',
      }),
    ]);
    expect(useChatStore.getState().toolMessages).toHaveLength(1);
    expect(useChatStore.getState().toolMessages[0]).toMatchObject({
      role: 'assistant',
      id: 'live-tool:tool-1',
    });
    expect(useChatStore.getState().toolMessages[0]?.content).toEqual([
      {
        type: 'toolCall',
        id: 'tool-1',
        name: 'exec',
        arguments: { command: 'pwd' },
      },
      {
        type: 'toolResult',
        id: 'tool-1',
        name: 'exec',
        text: '/workspace',
        status: 'completed',
        isError: false,
      },
    ]);
    expect(useChatStore.getState().toolMessages[0]?._toolStatuses?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      result: '/workspace',
      status: 'completed',
    });
    expect(useChatStore.getState().messages.some((message) => message.id === 'assistant-final-1')).toBe(false);
  });

  it('does not rehydrate tool cards from an older run during a new active send', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          thinkingLevel: 'high',
          messages: [
            {
              role: 'assistant',
              id: 'assistant-old-tool',
              timestamp: 1,
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-old',
                  name: 'exec',
                  arguments: { command: 'pwd' },
                },
              ],
            },
            {
              role: 'toolresult',
              id: 'tool-result-old',
              toolCallId: 'tool-old',
              toolName: 'exec',
              timestamp: 2,
              content: [{ type: 'text', text: '/old-workspace' }],
            },
            {
              role: 'assistant',
              id: 'assistant-new-tool',
              timestamp: 11,
              content: [
                {
                  type: 'toolCall',
                  id: 'tool-new',
                  name: 'exec',
                  arguments: { command: 'curl wttr.in/Hangzhou?format=3' },
                },
              ],
            },
            {
              role: 'toolresult',
              id: 'tool-result-new',
              toolCallId: 'tool-new',
              toolName: 'exec',
              timestamp: 12,
              content: [{ type: 'text', text: 'Hangzhou: +17°C' }],
            },
          ],
        };
      }

      if (method === 'sessions.list') {
        return { sessions: [] };
      }

      throw new Error(`Unexpected RPC method: ${method}`);
    });

    useGatewayStore.setState({
      rpc: rpcMock as never,
    });
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      lastUserMessageAt: 10_000,
      messages: [
        {
          role: 'user',
          id: 'user-2',
          timestamp: 10,
          content: '重新查一下杭州天气',
        },
      ],
      toolStreamById: new Map([
        ['tool-new', {
          toolCallId: 'tool-new',
          runId: 'run-2',
          sessionKey: 'agent:test:geeclaw_main',
          name: 'exec',
          args: { command: 'curl wttr.in/Hangzhou?format=3' },
          status: 'running',
          startedAt: 11,
          updatedAt: 11_000,
          message: {
            role: 'assistant',
            id: 'live-tool:tool-new',
            toolCallId: 'tool-new',
            toolName: 'exec',
            timestamp: 11,
            content: [
              {
                type: 'toolCall',
                id: 'tool-new',
                name: 'exec',
                arguments: { command: 'curl wttr.in/Hangzhou?format=3' },
              },
            ],
            _toolStatuses: [
              {
                id: 'tool-new',
                toolCallId: 'tool-new',
                name: 'exec',
                status: 'running',
                updatedAt: 11_000,
                input: { command: 'curl wttr.in/Hangzhou?format=3' },
              },
            ],
          },
        }],
      ]),
      toolStreamOrder: ['tool-new'],
      toolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-new',
          toolCallId: 'tool-new',
          toolName: 'exec',
          timestamp: 11,
          content: [
            {
              type: 'toolCall',
              id: 'tool-new',
              name: 'exec',
              arguments: { command: 'curl wttr.in/Hangzhou?format=3' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-new',
              toolCallId: 'tool-new',
              name: 'exec',
              status: 'running',
              updatedAt: 11_000,
              input: { command: 'curl wttr.in/Hangzhou?format=3' },
            },
          ],
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().toolMessages).toHaveLength(1);
    expect(useChatStore.getState().toolMessages[0]?.toolCallId).toBe('tool-new');
    expect(useChatStore.getState().toolMessages[0]?._toolStatuses?.[0]).toMatchObject({
      toolCallId: 'tool-new',
      result: 'Hangzhou: +17°C',
      status: 'completed',
    });
    expect(useChatStore.getState().toolMessages.some((message) => message.toolCallId === 'tool-old')).toBe(false);
  });
});
