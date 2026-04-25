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
    expect(loadHistoryMock).toHaveBeenCalledWith(true, 'tool_patch');
  });

  it('triggers a full history reload when the deferred final text is waiting on the last running tool', () => {
    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      pendingFinal: true,
      streamingText: '现在我为你查询',
      streamingTextStartedAt: 2,
      streamingTextLastEventAt: 2,
      loadHistory: loadHistoryMock,
      toolStreamById: new Map([
        ['tool-1', {
          toolCallId: 'tool-1',
          runId: 'run-1',
          sessionKey: 'agent:test:geeclaw_main',
          name: 'exec',
          args: { command: 'pwd' },
          status: 'running',
          startedAt: 1,
          updatedAt: 1_000,
          message: {
            role: 'assistant',
            id: 'live-tool:tool-1',
            toolCallId: 'tool-1',
            toolName: 'exec',
            timestamp: 1,
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'exec',
                arguments: { command: 'pwd' },
              },
            ],
            _toolStatuses: [
              {
                id: 'tool-1',
                toolCallId: 'tool-1',
                name: 'exec',
                status: 'running',
                updatedAt: 1_000,
                input: { command: 'pwd' },
              },
            ],
          },
        }],
      ]),
      toolStreamOrder: ['tool-1'],
      toolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-1',
          toolCallId: 'tool-1',
          toolName: 'exec',
          timestamp: 1,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'exec',
              arguments: { command: 'pwd' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'running',
              updatedAt: 1_000,
              input: { command: 'pwd' },
            },
          ],
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
        phase: 'result',
        result: '/workspace',
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

  it('preserves existing streamed assistant text when history is used only to patch tool results', async () => {
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.history') {
        return {
          thinkingLevel: 'high',
          messages: [
            {
              role: 'assistant',
              id: 'assistant-final-history',
              timestamp: 3,
              content: '这条 history 文本不应该替换现有流式输出',
              tool_calls: [
                {
                  id: 'tool-1',
                  function: {
                    name: 'exec',
                    arguments: '{"command":"pwd"}',
                  },
                },
              ],
            },
            {
              role: 'toolresult',
              id: 'tool-result-1',
              toolCallId: 'tool-1',
              toolName: 'exec',
              timestamp: 2,
              content: [{ type: 'text', text: '/workspace' }],
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
      sending: false,
      messages: [
        {
          role: 'user',
          id: 'user-1',
          timestamp: 0,
          content: '查一下当前目录',
        },
        {
          role: 'assistant',
          id: 'assistant-final-live',
          timestamp: 3,
          content: '好的，接下去我们来..',
          tool_calls: [
            {
              id: 'tool-1',
              function: {
                name: 'exec',
                arguments: '{"command":"pwd"}',
              },
            },
          ],
        } as unknown as ReturnType<typeof useChatStore.getState>['messages'][number],
      ],
    });

    await useChatStore.getState().loadHistory(true, 'tool_patch');

    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({
        role: 'user',
        id: 'user-1',
      }),
      expect.objectContaining({
        role: 'assistant',
        id: 'assistant-final-live',
        content: '好的，接下去我们来..',
        _toolStatuses: [
          expect.objectContaining({
            toolCallId: 'tool-1',
            status: 'completed',
            result: '/workspace',
          }),
        ],
      }),
    ]);
    expect(useChatStore.getState().messages.some((message) => message.id === 'assistant-final-history')).toBe(false);
  });

  it('keeps live tool statuses on the final assistant message after streaming completes', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
      messages: [
        {
          role: 'user',
          id: 'user-1',
          timestamp: 0,
          content: '查一下当前目录',
        },
      ],
      toolStreamById: new Map([
        ['tool-1', {
          toolCallId: 'tool-1',
          runId: 'run-1',
          sessionKey: 'agent:test:geeclaw_main',
          name: 'exec',
          args: { command: 'pwd' },
          output: '/workspace',
          status: 'completed',
          startedAt: 1,
          updatedAt: 2_000,
          message: {
            role: 'assistant',
            id: 'live-tool:tool-1',
            toolCallId: 'tool-1',
            toolName: 'exec',
            timestamp: 1,
            content: [
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
            ],
            _toolStatuses: [
              {
                id: 'tool-1',
                toolCallId: 'tool-1',
                name: 'exec',
                status: 'completed',
                result: '/workspace',
                updatedAt: 2_000,
                input: { command: 'pwd' },
              },
            ],
          },
        }],
      ]),
      toolStreamOrder: ['tool-1'],
      toolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-1',
          toolCallId: 'tool-1',
          toolName: 'exec',
          timestamp: 1,
          content: [
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
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'completed',
              result: '/workspace',
              updatedAt: 2_000,
              input: { command: 'pwd' },
            },
          ],
        },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-final-1',
        timestamp: 3,
        content: '好的，接下去我们来..',
      },
    });

    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({
        role: 'user',
        id: 'user-1',
      }),
      expect.objectContaining({
        role: 'assistant',
        id: 'assistant-final-1',
        content: [
          expect.objectContaining({
            type: 'toolCall',
            id: 'tool-1',
            name: 'exec',
          }),
          expect.objectContaining({
            type: 'toolResult',
            id: 'tool-1',
            name: 'exec',
            text: '/workspace',
          }),
          expect.objectContaining({
            type: 'text',
            text: '好的，接下去我们来..',
          }),
        ],
        _toolStatuses: [
          expect.objectContaining({
            toolCallId: 'tool-1',
            status: 'completed',
            result: '/workspace',
          }),
        ],
      }),
    ]);
    expect(useChatStore.getState().toolMessages).toEqual([]);
  });

  it('carries live tool blocks onto the final assistant message after streaming completes', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
      messages: [],
      toolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-1',
          toolCallId: 'tool-1',
          toolName: 'exec',
          timestamp: 1,
          content: [
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
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'completed',
              result: '/workspace',
              updatedAt: 2_000,
              input: { command: 'pwd' },
            },
          ],
        },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-final-2',
        timestamp: 3,
        content: '好的，接下去我们来..',
      },
    });

    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'assistant-final-2',
      content: [
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
        {
          type: 'text',
          text: '好的，接下去我们来..',
        },
      ],
    });
  });

  it('does not commit an assistant text message as a finished turn if more tool events continue afterward', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
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

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-midrun',
        timestamp: 2,
        content: '现在我为你查询',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'start',
        args: { url: 'https://example.com' },
      },
    });

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().toolMessages.map((message) => message.toolCallId)).toEqual(['tool-1', 'tool-2']);
    expect(useChatStore.getState().streamSegments).toEqual([
      { text: '现在我为你查询', ts: 2 },
    ]);
    expect(useChatStore.getState().streamingText).toBe('');
    expect(useChatStore.getState().sending).toBe(true);
  });

  it('keeps pre-tool streamed text ahead of tool blocks when the final assistant text repeats its prefix', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
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

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-midrun-prefix',
        timestamp: 2,
        content: '文本1',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'start',
        args: { url: 'https://example.com/search' },
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
        result: '/workspace',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'result',
        result: 'done',
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-final-prefix-repeat',
        timestamp: 5,
        content: '文本1\n文本2',
      },
    });

    expect(useChatStore.getState().messages).toEqual([
      {
        role: 'assistant',
        id: 'assistant-final-prefix-repeat',
        timestamp: 5,
        content: [
          { type: 'text', text: '文本1' },
          { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } },
          { type: 'toolResult', id: 'tool-1', name: 'exec', text: '/workspace', status: 'completed', isError: false },
          { type: 'toolCall', id: 'tool-2', name: 'fetch', arguments: { url: 'https://example.com/search' } },
          { type: 'toolResult', id: 'tool-2', name: 'fetch', text: 'done', status: 'completed', isError: false },
          { type: 'text', text: '文本2' },
        ],
        _hiddenAttachmentCount: undefined,
        _toolStatuses: [
          expect.objectContaining({ toolCallId: 'tool-1', status: 'completed', result: '/workspace' }),
          expect.objectContaining({ toolCallId: 'tool-2', status: 'completed', result: 'done' }),
        ],
      },
    ]);
    expect(useChatStore.getState().streamSegments).toEqual([]);
    expect(useChatStore.getState().toolMessages).toEqual([]);
  });

  it('strips already rendered text prefixes even when the final assistant content also contains images', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
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

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-midrun-image-prefix',
        timestamp: 2,
        content: '文本1',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'start',
        args: { url: 'https://example.com/search' },
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
        result: '/workspace',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'result',
        result: 'done',
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-final-image-prefix',
        timestamp: 5,
        content: [
          { type: 'text', text: '文本1\n文本2' },
          { type: 'image', data: 'AAA=', mimeType: 'image/png' },
        ],
      },
    });

    expect(useChatStore.getState().messages).toEqual([
      {
        role: 'assistant',
        id: 'assistant-final-image-prefix',
        timestamp: 5,
        content: [
          { type: 'text', text: '文本1' },
          { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } },
          { type: 'toolResult', id: 'tool-1', name: 'exec', text: '/workspace', status: 'completed', isError: false },
          { type: 'toolCall', id: 'tool-2', name: 'fetch', arguments: { url: 'https://example.com/search' } },
          { type: 'toolResult', id: 'tool-2', name: 'fetch', text: 'done', status: 'completed', isError: false },
          { type: 'text', text: '文本2' },
          { type: 'image', data: 'AAA=', mimeType: 'image/png' },
        ],
        _hiddenAttachmentCount: undefined,
        _toolStatuses: [
          expect.objectContaining({ toolCallId: 'tool-1', status: 'completed', result: '/workspace' }),
          expect.objectContaining({ toolCallId: 'tool-2', status: 'completed', result: 'done' }),
        ],
      },
    ]);
  });

  it('preserves interleaved image positions when stripping already rendered text prefixes', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
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

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-midrun-image-interleave',
        timestamp: 2,
        content: '文本1',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'start',
        args: { url: 'https://example.com/search' },
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
        result: '/workspace',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      data: {
        toolCallId: 'tool-2',
        name: 'fetch',
        phase: 'result',
        result: 'done',
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-final-image-interleave',
        timestamp: 5,
        content: [
          { type: 'text', text: '文本1' },
          { type: 'image', data: 'AAA=', mimeType: 'image/png' },
          { type: 'text', text: '文本2' },
        ],
      },
    });

    expect(useChatStore.getState().messages).toEqual([
      {
        role: 'assistant',
        id: 'assistant-final-image-interleave',
        timestamp: 5,
        content: [
          { type: 'text', text: '文本1' },
          { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } },
          { type: 'toolResult', id: 'tool-1', name: 'exec', text: '/workspace', status: 'completed', isError: false },
          { type: 'toolCall', id: 'tool-2', name: 'fetch', arguments: { url: 'https://example.com/search' } },
          { type: 'toolResult', id: 'tool-2', name: 'fetch', text: 'done', status: 'completed', isError: false },
          { type: 'image', data: 'AAA=', mimeType: 'image/png' },
          { type: 'text', text: '文本2' },
        ],
        _hiddenAttachmentCount: undefined,
        _toolStatuses: [
          expect.objectContaining({ toolCallId: 'tool-1', status: 'completed', result: '/workspace' }),
          expect.objectContaining({ toolCallId: 'tool-2', status: 'completed', result: 'done' }),
        ],
      },
    ]);
  });

  it('updates equivalent final assistant messages with reconstructed live content blocks', () => {
    useGatewayStore.setState({
      rpc: vi.fn(async (method: string) => {
        if (method === 'chat.history') {
          return { thinkingLevel: 'high', messages: [] };
        }
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }) as never,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
      messages: [
        {
          role: 'assistant',
          id: 'assistant-final-existing',
          timestamp: 3,
          content: '好的，接下去我们来..',
        },
      ],
      toolMessages: [
        {
          role: 'assistant',
          id: 'live-tool:tool-1',
          toolCallId: 'tool-1',
          toolName: 'exec',
          timestamp: 1,
          content: [
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
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'completed',
              result: '/workspace',
              updatedAt: 2_000,
              input: { command: 'pwd' },
            },
          ],
        },
      ],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'final',
      message: {
        role: 'assistant',
        id: 'assistant-final-existing',
        timestamp: 3,
        content: '好的，接下去我们来..',
      },
    });

    expect(useChatStore.getState().messages).toEqual([
      {
        role: 'assistant',
        id: 'assistant-final-existing',
        timestamp: 3,
        content: [
          { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'pwd' } },
          { type: 'toolResult', id: 'tool-1', name: 'exec', text: '/workspace', status: 'completed', isError: false },
          { type: 'text', text: '好的，接下去我们来..' },
        ],
        _hiddenAttachmentCount: undefined,
        _toolStatuses: [
          expect.objectContaining({ toolCallId: 'tool-1', status: 'completed', result: '/workspace' }),
        ],
      },
    ]);
  });

  it('uses the latest fallback delta timestamp when freezing text before a tool starts', () => {
    useChatStore.setState({
      currentSessionKey: 'agent:test:geeclaw_main',
      currentDesktopSessionId: '',
      currentViewMode: 'session',
      desktopSessions: [],
      sending: true,
      activeRunId: 'run-1',
      messages: [],
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'mystery',
      message: {
        role: 'assistant',
        timestamp: 10,
        content: '现在',
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      state: 'mystery',
      message: {
        role: 'assistant',
        timestamp: 12,
        content: '现在我为你查询',
      },
    });

    useChatStore.getState().handleAgentEvent({
      stream: 'tool',
      runId: 'run-1',
      sessionKey: 'agent:test:geeclaw_main',
      ts: 20,
      data: {
        toolCallId: 'tool-1',
        name: 'fetch',
        phase: 'start',
        args: { url: 'https://example.com' },
      },
    });

    expect(useChatStore.getState().streamSegments).toEqual([
      { text: '现在我为你查询', ts: 12 },
    ]);
  });

  it('does not emit debug console logs for routine stream handling', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      useChatStore.setState({
        currentSessionKey: 'agent:test:geeclaw_main',
        currentDesktopSessionId: '',
        currentViewMode: 'session',
        desktopSessions: [],
        sending: true,
        activeRunId: 'run-1',
        messages: [],
      });

      useChatStore.getState().handleChatEvent({
        runId: 'run-1',
        sessionKey: 'agent:test:geeclaw_main',
        state: 'delta',
        message: {
          role: 'assistant',
          timestamp: 10,
          content: '现在我为你查询',
        },
      });

      useChatStore.getState().handleAgentEvent({
        stream: 'tool',
        runId: 'run-1',
        sessionKey: 'agent:test:geeclaw_main',
        ts: 12,
        data: {
          toolCallId: 'tool-1',
          name: 'fetch',
          phase: 'start',
          args: { url: 'https://example.com' },
        },
      });

      useChatStore.getState().handleChatEvent({
        runId: 'run-1',
        sessionKey: 'agent:test:geeclaw_main',
        state: 'final',
        message: {
          role: 'assistant',
          id: 'assistant-final-quiet',
          timestamp: 14,
          content: '查询好了',
        },
      });

      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
