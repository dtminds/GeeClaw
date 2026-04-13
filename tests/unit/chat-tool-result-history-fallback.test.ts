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

  it('removes live tool cards once history contains the persisted result for the same tool call', async () => {
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

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]?._toolStatuses?.[0]).toMatchObject({
      toolCallId: 'tool-1',
      status: 'completed',
      result: '/workspace',
    });
    expect(useChatStore.getState().toolMessages).toEqual([]);
  });
});
