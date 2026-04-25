import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { buildChatItems } from '@/pages/Chat/build-chat-items';
import { useChatStore, type RawMessage } from '@/stores/chat';

const { invokeIpcMock } = vi.hoisted(() => ({
  invokeIpcMock: vi.fn(),
}));

let mockLanguage = 'zh-CN';
let sendMessageMock = vi.fn(async () => undefined);

vi.mock('@/lib/api-client', () => ({
  invokeIpc: invokeIpcMock,
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: {
        language: mockLanguage,
        resolvedLanguage: mockLanguage,
      },
    }),
  };
});

describe('chat live rendering', () => {
  const currentTs = () => Date.now();

  beforeEach(() => {
    invokeIpcMock.mockReset();
    invokeIpcMock.mockImplementation(async (channel: string, payload?: { method?: string; path?: string; body?: string }) => {
      if (channel === 'hostapi:base') {
        return 'http://127.0.0.1:13210';
      }
      if (channel === 'hostapi:token') {
        return '';
      }
      if (channel === 'hostapi:fetch' && payload?.method === 'PUT' && payload.path === '/api/desktop-sessions/desktop-session-1') {
        const parsedBody = payload.body ? JSON.parse(payload.body) as {
          proposalStateEntries?: Array<{ proposalId: string; decision: 'approved' | 'rejected'; updatedAt: number }>;
        } : {};
        return {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              session: {
                id: 'desktop-session-1',
                gatewaySessionKey: 'agent:main:geeclaw_main',
                title: 'Main',
                lastMessagePreview: '',
                createdAt: 1,
                updatedAt: 2,
                proposalStateEntries: parsedBody.proposalStateEntries || [],
              },
            },
          },
        };
      }
      return undefined;
    });
    sendMessageMock = vi.fn(async () => undefined);
    useChatStore.setState({
      sending: false,
      sendMessage: sendMessageMock,
      currentDesktopSessionId: 'desktop-session-1',
      desktopSessions: [{
        id: 'desktop-session-1',
        gatewaySessionKey: 'agent:main:geeclaw_main',
        title: 'Main',
        lastMessagePreview: '',
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    mockLanguage = 'zh-CN';
  });

  it('renders text-tool-text as three separate live items', () => {
    const liveToolMessage: RawMessage = {
      role: 'assistant',
      id: 'live-tool:tool-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      timestamp: 2,
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'bash',
          status: 'running',
          input: { command: 'pwd' },
          updatedAt: 2,
        },
      ],
    };

    const chatItems = buildChatItems({
      messages: [],
      toolMessages: [liveToolMessage],
      streamSegments: [{ text: '我先看一下当前目录。', ts: 1 }],
      streamingText: '接着我继续分析结果。',
      streamingTextStartedAt: 3,
      sessionKey: 'session-live',
    });

    const { container } = render(
      <div>
        {chatItems.map((item) => (
          <ChatMessage
            key={item.key}
            message={item.message}
            showThinking
            showToolCalls
            isStreaming={item.isStreaming}
          />
        ))}
      </div>,
    );

    expect(screen.getByText('我先看一下当前目录。')).toBeInTheDocument();
    expect(screen.getByLabelText('执行本地命令 pwd')).toBeInTheDocument();
    expect(screen.getByText('接着我继续分析结果。')).toBeInTheDocument();

    const renderedText = container.textContent || '';
    expect(renderedText.indexOf('我先看一下当前目录。')).toBeLessThan(renderedText.indexOf('pwd'));
    expect(renderedText.indexOf('pwd')).toBeLessThan(renderedText.indexOf('接着我继续分析结果。'));

    const markdownBlocks = container.querySelectorAll('.chat-markdown');
    expect(markdownBlocks).toHaveLength(2);
  });

  it('keeps a frozen assistant text segment between the surrounding tool cards', () => {
    const firstToolMessage: RawMessage = {
      role: 'assistant',
      id: 'live-tool:tool-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      timestamp: 1,
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'bash',
          status: 'running',
          input: { command: 'pwd' },
          updatedAt: 1,
        },
      ],
    };

    const secondToolMessage: RawMessage = {
      role: 'assistant',
      id: 'live-tool:tool-2',
      toolCallId: 'tool-2',
      toolName: 'fetch',
      timestamp: 3,
      content: [
        {
          type: 'toolCall',
          id: 'tool-2',
          name: 'fetch',
          arguments: { url: 'https://example.com/search?q=clawx' },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-2',
          toolCallId: 'tool-2',
          name: 'fetch',
          status: 'running',
          input: { url: 'https://example.com/search?q=clawx' },
          updatedAt: 3,
        },
      ],
    };

    const chatItems = buildChatItems({
      messages: [],
      toolMessages: [firstToolMessage, secondToolMessage],
      streamSegments: [{ text: '现在我为你查询', ts: 2 }],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'session-live-order',
    });

    const { container } = render(
      <div>
        {chatItems.map((item) => (
          <ChatMessage
            key={item.key}
            message={item.message}
            showThinking
            showToolCalls
            isStreaming={item.isStreaming}
          />
        ))}
      </div>,
    );

    expect(screen.getByText('现在我为你查询')).toBeInTheDocument();
    expect(screen.getByText(/pwd/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/search\?q=clawx/)).toBeInTheDocument();

    const renderedText = container.textContent || '';
    expect(renderedText.indexOf('pwd')).toBeLessThan(renderedText.indexOf('现在我为你查询'));
    expect(renderedText.indexOf('现在我为你查询')).toBeLessThan(renderedText.indexOf('https://example.com/search?q=clawx'));
  });

  it('stores explicit live runtime payloads and collapses only the older finished live tool group', () => {
    const completedCommandTool: RawMessage = {
      role: 'assistant',
      id: 'live-tool:tool-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      timestamp: 1,
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          name: 'bash',
          status: 'completed',
          input: { command: 'pwd' },
          updatedAt: 1,
        },
      ],
    };

    const completedReadTool: RawMessage = {
      role: 'assistant',
      id: 'live-tool:tool-2',
      toolCallId: 'tool-2',
      toolName: 'read',
      timestamp: 2,
      content: [
        {
          type: 'toolCall',
          id: 'tool-2',
          name: 'read',
          arguments: { filePath: '/tmp/notes.md' },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-2',
          toolCallId: 'tool-2',
          name: 'read',
          status: 'completed',
          input: { filePath: '/tmp/notes.md' },
          updatedAt: 2,
        },
      ],
    };

    const runningFetchTool: RawMessage = {
      role: 'assistant',
      id: 'live-tool:tool-3',
      toolCallId: 'tool-3',
      toolName: 'fetch',
      timestamp: 4,
      content: [
        {
          type: 'toolCall',
          id: 'tool-3',
          name: 'fetch',
          arguments: { url: 'https://example.com/search?q=clawx-live' },
        },
      ],
      _toolStatuses: [
        {
          id: 'tool-3',
          toolCallId: 'tool-3',
          name: 'fetch',
          status: 'running',
          input: { url: 'https://example.com/search?q=clawx-live' },
          updatedAt: 4,
        },
      ],
    };

    const liveToolMessages = [completedCommandTool, completedReadTool, runningFetchTool];
    const liveStreamSegments = [
      { text: '我先检查本地环境。', ts: 0 },
      { text: '接着我继续联网确认。', ts: 3 },
    ];

    const chatItems = buildChatItems({
      messages: [],
      toolMessages: liveToolMessages,
      streamSegments: liveStreamSegments,
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'session-live-collapse',
    });

    expect(chatItems).toHaveLength(1);

    const liveMessage = chatItems[0].message as RawMessage & {
      _liveToolMessages?: RawMessage[];
      _liveStreamSegments?: Array<{ text: string; ts: number }>;
    };

    expect(liveMessage._liveToolMessages).toEqual(liveToolMessages);
    expect(liveMessage._liveStreamSegments).toEqual(liveStreamSegments);

    render(
      <ChatMessage
        message={liveMessage}
        showThinking
        showToolCalls
        isStreaming={chatItems[0].isStreaming}
      />,
    );

    expect(screen.getByText('我先检查本地环境。')).toBeInTheDocument();
    expect(screen.getByText('接着我继续联网确认。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已执行 1 条命令，读取 1 个文件/i })).toBeInTheDocument();
    expect(screen.queryByText(/pwd/)).not.toBeInTheDocument();
    expect(screen.queryByText('/tmp/notes.md')).not.toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/search\?q=clawx-live/)).toBeInTheDocument();
  });

  it('keeps fallback text after top-level tool calls when content has no ordered blocks', () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-openai-fallback-order',
          timestamp: 3,
          content: '先搜一下xxxx',
          tool_calls: [
            {
              id: 'tool-1',
              function: {
                name: 'exec',
                arguments: '{"command":"pwd"}',
              },
            },
            {
              id: 'tool-2',
              function: {
                name: 'fetch',
                arguments: '{"url":"https://example.com/search?q=xxxx"}',
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'running',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
            {
              id: 'tool-2',
              toolCallId: 'tool-2',
              name: 'fetch',
              status: 'running',
              input: { url: 'https://example.com/search?q=xxxx' },
              updatedAt: 2,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('先搜一下xxxx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已执行 1 条命令，发起 1 次网络请求/i })).toBeInTheDocument();

    const renderedText = container.textContent || '';
    expect(renderedText.indexOf('已执行 1 条命令，发起 1 次网络请求')).toBeLessThan(renderedText.indexOf('先搜一下xxxx'));
  });

  it('keeps text blocks after top-level tool calls when ordered tool blocks are missing', () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-openai-text-block-order',
          timestamp: 3,
          content: [
            {
              type: 'text',
              text: '先搜一下xxxx',
            },
          ],
          tool_calls: [
            {
              id: 'tool-1',
              function: {
                name: 'exec',
                arguments: '{"command":"pwd"}',
              },
            },
            {
              id: 'tool-2',
              function: {
                name: 'fetch',
                arguments: '{"url":"https://example.com/search?q=xxxx"}',
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'exec',
              status: 'running',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
            {
              id: 'tool-2',
              toolCallId: 'tool-2',
              name: 'fetch',
              status: 'running',
              input: { url: 'https://example.com/search?q=xxxx' },
              updatedAt: 2,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('先搜一下xxxx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已执行 1 条命令，发起 1 次网络请求/i })).toBeInTheDocument();

    const renderedText = container.textContent || '';
    expect(renderedText.indexOf('已执行 1 条命令，发起 1 次网络请求')).toBeLessThan(renderedText.indexOf('先搜一下xxxx'));
  });

  it('renders reopened history turns with collapsed tool summaries instead of separate tool rows', () => {
    const chatItems = buildChatItems({
      messages: [
        {
          role: 'assistant',
          id: 'assistant-history-1',
          timestamp: 1,
          content: [
            {
              type: 'text',
              text: '好的，接下去我会查询天气',
            },
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'read',
              arguments: { filePath: '/tmp/SKILL.md' },
            },
            {
              type: 'toolCall',
              id: 'tool-2',
              name: 'fetch',
              arguments: { url: 'https://example.com/weather?q=hangzhou' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'read',
              status: 'completed',
              input: { filePath: '/tmp/SKILL.md' },
              updatedAt: 1,
            },
            {
              id: 'tool-2',
              toolCallId: 'tool-2',
              name: 'fetch',
              status: 'completed',
              input: { url: 'https://example.com/weather?q=hangzhou' },
              updatedAt: 2,
            },
          ],
        } as RawMessage,
        {
          role: 'assistant',
          id: 'assistant-history-2',
          timestamp: 2,
          content: '查到了，杭州当前多云，22°C。',
        } as RawMessage,
      ],
      toolMessages: [],
      streamSegments: [],
      streamingText: '',
      streamingTextStartedAt: null,
      sessionKey: 'session-history-collapse',
    });

    expect(chatItems).toHaveLength(1);

    render(
      <div>
        {chatItems.map((item) => (
          <ChatMessage
            key={item.key}
            message={item.message}
            showThinking
            showToolCalls
            isStreaming={item.isStreaming}
          />
        ))}
      </div>,
    );

    expect(screen.getByText('好的，接下去我会查询天气')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已读取 1 个文件，发起 1 次网络请求/i })).toBeInTheDocument();
    expect(screen.queryByText('/tmp/SKILL.md')).not.toBeInTheDocument();
    expect(screen.queryByText(/https:\/\/example\.com\/weather\?q=hangzhou/)).not.toBeInTheDocument();
    expect(screen.getByText('查到了，杭州当前多云，22°C。')).toBeInTheDocument();
  });

  it('renders a collapsed summary row for a completed tool group', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-collapsed-tool-group',
          timestamp: 3,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
            {
              type: 'toolCall',
              id: 'tool-2',
              name: 'fetch',
              arguments: { url: 'https://example.com/search?q=xxxx' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'bash',
              status: 'completed',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
            {
              id: 'tool-2',
              toolCallId: 'tool-2',
              name: 'fetch',
              status: 'completed',
              input: { url: 'https://example.com/search?q=xxxx' },
              updatedAt: 2,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByRole('button', { name: /已执行 1 条命令，发起 1 次网络请求/i })).toBeInTheDocument();
    expect(screen.queryByText(/pwd/)).not.toBeInTheDocument();
    expect(screen.queryByText(/https:\/\/example\.com\/search\?q=xxxx/)).not.toBeInTheDocument();
  });

  it('renders a collapsed summary row for a completed single-tool group', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-collapsed-single-tool-group',
          timestamp: 3,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'bash',
              status: 'completed',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByRole('button', { name: /已执行 1 条命令/i })).toBeInTheDocument();
  });

  it('renders live multi-tool groups without a summary header before they collapse', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-live-expanded-tool-group',
          timestamp: 3,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
            {
              type: 'toolCall',
              id: 'tool-2',
              name: 'fetch',
              arguments: { url: 'https://example.com/search?q=xxxx' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'bash',
              status: 'running',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
            {
              id: 'tool-2',
              toolCallId: 'tool-2',
              name: 'fetch',
              status: 'running',
              input: { url: 'https://example.com/search?q=xxxx' },
              updatedAt: 2,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
        isStreaming
      />,
    );

    expect(screen.queryByRole('button', { name: /已执行 1 条命令，发起 1 次网络请求/i })).not.toBeInTheDocument();
    expect(screen.getByText(/pwd/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/search\?q=xxxx/)).toBeInTheDocument();
  });

  it('renders completed tool rows after expanding a collapsed tool group', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-expanded-tool-group',
          timestamp: 3,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
            {
              type: 'toolCall',
              id: 'tool-2',
              name: 'fetch',
              arguments: { url: 'https://example.com/search?q=xxxx' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'bash',
              status: 'completed',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
            {
              id: 'tool-2',
              toolCallId: 'tool-2',
              name: 'fetch',
              status: 'completed',
              input: { url: 'https://example.com/search?q=xxxx' },
              updatedAt: 2,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /已执行 1 条命令，发起 1 次网络请求/i }));

    expect(screen.getByText(/pwd/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/search\?q=xxxx/)).toBeInTheDocument();
  });

  it('keeps tool group hooks stable when a grouped tool row grows from one item to multiple items', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-growing-tool-group',
          timestamp: 3,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-1',
              toolCallId: 'tool-1',
              name: 'bash',
              status: 'completed',
              input: { command: 'pwd' },
              updatedAt: 1,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText(/pwd/)).toBeInTheDocument();

    expect(() => {
      rerender(
        <ChatMessage
          message={{
            role: 'assistant',
            id: 'assistant-growing-tool-group',
            timestamp: 3,
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'pwd' },
              },
              {
                type: 'toolCall',
                id: 'tool-2',
                name: 'fetch',
                arguments: { url: 'https://example.com/search?q=xxxx' },
              },
            ],
            _toolStatuses: [
              {
                id: 'tool-1',
                toolCallId: 'tool-1',
                name: 'bash',
                status: 'completed',
                input: { command: 'pwd' },
                updatedAt: 1,
              },
              {
                id: 'tool-2',
                toolCallId: 'tool-2',
                name: 'fetch',
                status: 'completed',
                input: { url: 'https://example.com/search?q=xxxx' },
                updatedAt: 2,
              },
            ],
          } as unknown as RawMessage}
          showThinking
          showToolCalls
        />,
      );
    }).not.toThrow();

    expect(screen.getByRole('button', { name: /已执行 1 条命令，发起 1 次网络请求/i })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('hides process tool cards while keeping session tool cards in Chinese', () => {
    render(
      <div>
        <ChatMessage
          message={{
            role: 'assistant',
            id: 'assistant-tool-process',
            timestamp: 1,
            content: [
              {
                type: 'toolCall',
                id: 'tool-process',
                name: 'process',
                arguments: { action: 'poll' },
              },
              {
                type: 'toolCall',
                id: 'tool-spawn',
                name: 'sessions_spawn',
                arguments: { task: '整理日志' },
              },
              {
                type: 'toolCall',
                id: 'tool-yield',
                name: 'sessions_yield',
                arguments: {},
              },
            ],
          } as unknown as RawMessage}
          showThinking
          showToolCalls
        />
      </div>,
    );

    expect(screen.queryByText('process 查看进程状态')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /已调用 2 个工具/i }));
    expect(screen.getByText('启动子任务 整理日志')).toBeInTheDocument();
    expect(screen.getByText('等待子任务结果')).toBeInTheDocument();
  });

  it('hides process tool cards while keeping session tool cards in English outside Chinese locale', () => {
    mockLanguage = 'en-US';

    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-tool-english',
          timestamp: 1,
          content: [
            {
              type: 'toolCall',
              id: 'tool-process-en',
              name: 'process',
              arguments: { action: 'poll' },
            },
            {
              type: 'toolCall',
              id: 'tool-spawn-en',
              name: 'sessions_spawn',
              arguments: { task: 'analyze logs' },
            },
            {
              type: 'toolCall',
              id: 'tool-yield-en',
              name: 'sessions_yield',
              arguments: {},
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.queryByText('process poll')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Used 2 tools/i }));
    expect(screen.getByText('sessions_spawn spawn · analyze logs')).toBeInTheDocument();
    expect(screen.getByText('sessions_yield yield')).toBeInTheDocument();
  });

  it('renders file links as clickable actions that open local paths', () => {
    const message: RawMessage = {
      role: 'assistant',
      id: 'assistant-file-link',
      timestamp: 1,
      content: '[project plan](file:///tmp/project%20plan.md)',
    };

    const { container } = render(
      <ChatMessage
        message={message}
        showThinking
        showToolCalls
      />,
    );

    expect(container.textContent).not.toContain('[blocked]');

    const fileLink = screen.getByRole('button', { name: 'project plan' });
    expect(screen.getByTestId('markdown-file-link-icon')).toBeInTheDocument();
    fireEvent.click(fileLink);

    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openPath', '/tmp/project plan.md');
  });

  it('does not use content-visibility auto on chat message rows', () => {
    const message: RawMessage = {
      role: 'assistant',
      id: 'assistant-simple-text',
      timestamp: 1,
      content: '普通文本消息',
    };

    const { container } = render(
      <ChatMessage
        message={message}
        showThinking
        showToolCalls
      />,
    );

    expect(container.firstElementChild).toBeInstanceOf(HTMLElement);
    expect((container.firstElementChild as HTMLElement).style.contentVisibility).toBe('');
    expect((container.firstElementChild as HTMLElement).style.containIntrinsicSize).toBe('');
  });

  it('does not render internal system messages', () => {
    const message: RawMessage = {
      role: 'system',
      id: 'system-heartbeat',
      timestamp: 1,
      content: 'Heartbeat poll prompt',
    };

    const { container } = render(
      <ChatMessage
        message={message}
        showThinking
        showToolCalls
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Heartbeat poll prompt')).not.toBeInTheDocument();
  });

  it('renders evolution proposal cards from tool input when delivery mode is card', () => {
    const now = currentTs();
    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-card',
          timestamp: now,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-card',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-21-0001',
                signature: 'web-research-fallback',
                description: '基于工具调用失败的教训，固化一套资讯搜索回退策略',
                draftPath: '/tmp/evolution-proposal.md',
                tabs: [
                  {
                    kind: 'tool',
                    label: 'Web Research / 资讯搜索策略',
                    content: '核心原则\n\n1. 先直达媒体主题页\n2. 再抓取正文',
                    targetFile: '/tmp/tool-policy.md',
                  },
                ],
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-evolution-card',
              toolCallId: 'tool-evolution-card',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-2026-04-21-0001","deliveryMode":"card","channel":"desktop"}',
              updatedAt: now,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    expect(screen.getByText('Agent 请求自我进化')).toBeInTheDocument();
    expect(screen.getByText('基于工具调用失败的教训，固化一套资讯搜索回退策略')).toBeInTheDocument();
    expect(screen.getByText('Web Research / 资讯搜索策略', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('/tmp/evolution-proposal.md')).not.toBeInTheDocument();
    expect(screen.queryByText('/tmp/tool-policy.md')).not.toBeInTheDocument();
    expect(screen.queryByText('打开草稿')).not.toBeInTheDocument();
    expect(screen.getByText('确认进化')).toBeInTheDocument();
    expect(screen.getByText('拒绝')).toBeInTheDocument();
    expect(container.textContent || '').toContain('提案将在');
    expect(container.textContent || '').toContain('失效');

    const markdownPanel = container.querySelector('.chat-markdown');
    expect(markdownPanel?.className).toContain('max-h-[22rem]');
    expect(markdownPanel?.className).toContain('overflow-y-auto');
  });

  it('sends rejection commands from evolution proposal cards', async () => {
    const now = currentTs();
    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-reject',
          timestamp: now,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-reject',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-21-0003',
                description: '可拒绝的提案',
                tabs: [
                  {
                    kind: 'tool',
                    label: '策略',
                    content: '拒绝时应发回拒绝命令',
                  },
                ],
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-evolution-reject',
              toolCallId: 'tool-evolution-reject',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-2026-04-21-0003","deliveryMode":"card","channel":"desktop"}',
              updatedAt: now,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('拒绝'));
    });

    expect(sendMessageMock).toHaveBeenCalledWith('拒绝 evo-2026-04-21-0003');
    expect(container.textContent || '').toContain('Agent 请求自我进化 · 已拒绝');
    expect(screen.queryByRole('button', { name: '确认进化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument();
    expect(useChatStore.getState().desktopSessions[0]?.proposalStateEntries).toEqual([
      expect.objectContaining({
        proposalId: 'evo-2026-04-21-0003',
        decision: 'rejected',
      }),
    ]);
  });

  it('sends English decision commands from evolution proposal cards outside Chinese locale', async () => {
    mockLanguage = 'en-US';
    const now = currentTs();

    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-approve-en',
          timestamp: now,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-approve-en',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-21-0004',
                description: 'English approval path',
                tabs: [
                  {
                    kind: 'tool',
                    label: 'Policy',
                    content: 'Approve should send the English command',
                  },
                ],
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-evolution-approve-en',
              toolCallId: 'tool-evolution-approve-en',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-2026-04-21-0004","deliveryMode":"card","channel":"desktop"}',
              updatedAt: now,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Approve evolution'));
    });

    expect(sendMessageMock).toHaveBeenCalledWith('approve evo-2026-04-21-0004');
    expect(container.textContent || '').toContain('Agent Self-Evolution Request · Evolved');
    expect(screen.queryByRole('button', { name: 'Approve evolution' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(useChatStore.getState().desktopSessions[0]?.proposalStateEntries).toEqual([
      expect.objectContaining({
        proposalId: 'evo-2026-04-21-0004',
        decision: 'approved',
      }),
    ]);
  });

  it('restores persisted proposal decisions from the current desktop session', () => {
    const now = currentTs();
    useChatStore.setState({
      desktopSessions: [{
        id: 'desktop-session-1',
        gatewaySessionKey: 'agent:main:geeclaw_main',
        title: 'Main',
        lastMessagePreview: '',
        createdAt: 1,
        updatedAt: 1,
        proposalStateEntries: [{
          proposalId: 'evo-2026-04-21-0005',
          decision: 'approved',
          updatedAt: 1,
        }],
      }],
    });

    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-approved-persisted',
          timestamp: now,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-approved-persisted',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-21-0005',
                description: 'Persisted approval state',
                tabs: [
                  {
                    kind: 'tool',
                    label: 'Policy',
                    content: 'Already approved in local store',
                  },
                ],
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-evolution-approved-persisted',
              toolCallId: 'tool-evolution-approved-persisted',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-2026-04-21-0005","deliveryMode":"card","channel":"desktop"}',
              updatedAt: now,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    expect(container.textContent || '').toContain('Agent 请求自我进化 · 已进化');
    expect(screen.queryByRole('button', { name: '确认进化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument();
  });

  it('auto-rejects stale proposals older than 60 minutes when no persisted decision exists', () => {
    const staleTimestamp = Date.now() - (60 * 60 * 1000) - 1000;

    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-stale',
          timestamp: staleTimestamp,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-stale',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-19-0001',
                description: 'Stale proposal',
                tabs: [
                  {
                    kind: 'tool',
                    label: 'Policy',
                    content: 'Should auto reject after timeout',
                  },
                ],
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-evolution-stale',
              toolCallId: 'tool-evolution-stale',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-2026-04-19-0001","deliveryMode":"card","channel":"desktop"}',
              updatedAt: staleTimestamp,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    expect(container.textContent || '').toContain('Agent 请求自我进化 · 已拒绝');
    expect(screen.queryByRole('button', { name: '确认进化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument();
    expect(container.textContent || '').not.toContain('提案将在');
  });

  it('renders evolution proposal cards from inline tool results even when tool calls are hidden', () => {
    const now = currentTs();

    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-inline-result',
          timestamp: now,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-inline-result',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-21-0006',
                description: 'Inline tool result should still surface the card',
                tabs: [
                  {
                    kind: 'tool',
                    label: 'Policy',
                    content: 'Result metadata only exists in the inline tool result block',
                  },
                ],
              },
            },
            {
              type: 'tool_result',
              id: 'tool-evolution-inline-result',
              name: 'evolution_proposal',
              status: 'completed',
              content: [
                {
                  type: 'text',
                  text: '{"ok":true,"proposalId":"evo-2026-04-21-0006","deliveryMode":"card","channel":"desktop"}',
                },
              ],
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    expect(screen.getByText('Agent 请求自我进化')).toBeInTheDocument();
    expect(screen.getByText('Inline tool result should still surface the card')).toBeInTheDocument();
    expect(screen.getByText('Policy', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('确认进化')).toBeInTheDocument();
    expect(screen.getByText('拒绝')).toBeInTheDocument();
  });

  it('keeps evolution proposal cards visible when surrounded by collapsible tool groups', () => {
    const now = currentTs();

    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-between-tools',
          timestamp: now,
          content: [
            {
              type: 'toolCall',
              id: 'tool-read',
              name: 'read',
              arguments: { filePath: '/tmp/SKILL.md' },
            },
            {
              type: 'toolCall',
              id: 'tool-evolution-between',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-between-tools',
                description: 'Keep proposal cards outside folded tool groups',
                tabs: [
                  {
                    kind: 'tool',
                    label: 'Policy',
                    content: 'Proposal body',
                  },
                ],
              },
            },
            {
              type: 'toolCall',
              id: 'tool-fetch',
              name: 'fetch',
              arguments: { url: 'https://example.com' },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-read',
              toolCallId: 'tool-read',
              name: 'read',
              status: 'completed',
              updatedAt: now,
              input: { filePath: '/tmp/SKILL.md' },
            },
            {
              id: 'tool-evolution-between',
              toolCallId: 'tool-evolution-between',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-between-tools","deliveryMode":"card","channel":"desktop"}',
              updatedAt: now + 1,
            },
            {
              id: 'tool-fetch',
              toolCallId: 'tool-fetch',
              name: 'fetch',
              status: 'completed',
              updatedAt: now + 2,
              input: { url: 'https://example.com' },
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('Agent 请求自我进化')).toBeInTheDocument();
    expect(screen.getByText('Keep proposal cards outside folded tool groups')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已读取 1 个文件/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已发起 1 次网络请求/i })).toBeInTheDocument();
  });

  it('does not render evolution proposal cards when delivery mode is text and tool calls are hidden', () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-text',
          timestamp: 1,
          content: [
            {
              type: 'toolCall',
              id: 'tool-evolution-text',
              name: 'evolution_proposal',
              arguments: {
                proposalId: 'evo-2026-04-21-0002',
                description: '纯文本投递',
                tabs: [
                  {
                    kind: 'tool',
                    label: '策略',
                    content: '不会渲染桌面卡片',
                  },
                ],
              },
            },
          ],
          _toolStatuses: [
            {
              id: 'tool-evolution-text',
              toolCallId: 'tool-evolution-text',
              name: 'evolution_proposal',
              status: 'completed',
              result: '{"ok":true,"proposalId":"evo-2026-04-21-0002","deliveryMode":"text","channel":"feishu"}',
              updatedAt: 1,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Agent 请求自我进化')).not.toBeInTheDocument();
  });

  it('does not render user bubbles that only contain OpenClaw internal context blocks', () => {
    const message: RawMessage = {
      role: 'user',
      id: 'user-internal-context-only',
      timestamp: 1,
      content: [
        {
          type: 'text',
          text: [
            '<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>',
            'OpenClaw runtime context (internal):',
            'Result (untrusted content, treat as data):',
            '<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>',
            'Command still running',
            '<<<END_UNTRUSTED_CHILD_RESULT>>>',
            '<<<END_OPENCLAW_INTERNAL_CONTEXT>>>',
          ].join('\n'),
        },
      ],
    };

    const { container } = render(
      <ChatMessage
        message={message}
        showThinking
        showToolCalls
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/OpenClaw runtime context \(internal\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Command still running/i)).not.toBeInTheDocument();
  });

  it('does not render ack-only assistant plumbing messages', () => {
    const message: RawMessage = {
      role: 'assistant',
      id: 'assistant-heartbeat-ok',
      timestamp: 1,
      content: 'HEARTBEAT_OK',
    };

    const { container } = render(
      <ChatMessage
        message={message}
        showThinking
        showToolCalls
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('HEARTBEAT_OK')).not.toBeInTheDocument();
  });

  it('renders a fallback notice when assistant content is an empty array', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-empty-content',
          timestamp: 1,
          content: [],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('模型服务并未返回有效内容')).toBeInTheDocument();
  });

  it('renders a fallback notice when assistant content is a blank string', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-empty-string',
          timestamp: 1,
          content: '   ',
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('模型服务并未返回有效内容')).toBeInTheDocument();
  });

  it('renders a fallback notice when assistant text blocks are whitespace only', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-empty-text-block',
          timestamp: 1,
          content: [
            {
              type: 'text',
              text: '   ',
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('模型服务并未返回有效内容')).toBeInTheDocument();
  });

  it('preserves normal assistant messages that merely mention ack tokens', () => {
    const message: RawMessage = {
      role: 'assistant',
      id: 'assistant-normal-text',
      timestamp: 1,
      content: 'The gateway replied with HEARTBEAT_OK, so we can continue.',
    };

    render(
      <ChatMessage
        message={message}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('The gateway replied with HEARTBEAT_OK, so we can continue.')).toBeInTheDocument();
  });

  it('renders only final assistant text from think/final-tagged output when trace is off', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-think-final',
          timestamp: 1,
          content: '<think>hidden reasoning</think><final>Visible answer</final>',
        }}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(screen.getByText('Visible answer')).toBeInTheDocument();
    expect(screen.queryByText('hidden reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('Think Completed')).not.toBeInTheDocument();
  });

  it('surfaces think-tagged output through the thinking block when trace is on', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-think-visible',
          timestamp: 1,
          content: '<think>hidden reasoning</think><final>Visible answer</final>',
        }}
        showThinking
        showToolCalls
      />,
    );

    expect(screen.getByText('Visible answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Think Completed/i }));
    expect(screen.getByText('hidden reasoning')).toBeInTheDocument();
  });

  it('does not render commentary-only assistant bubbles', () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-commentary-only',
          timestamp: 1,
          content: [
            {
              type: 'text',
              text: 'thinking like caveman',
              textSignature: JSON.stringify({ v: 1, id: 'msg-commentary', phase: 'commentary' }),
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('thinking like caveman')).not.toBeInTheDocument();
  });

  it('renders unmatched standalone tool_result turns when tool traces are enabled', () => {
    render(
      <ChatMessage
        message={{
          role: 'toolresult',
          id: 'tool-result-orphan',
          timestamp: 1,
          content: 'orphan tool result',
        } as unknown as RawMessage}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(screen.getByText('orphan tool result')).toBeInTheDocument();
  });

  it('keeps standalone tool_result turns hidden when tool traces are disabled', () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: 'toolresult',
          id: 'tool-result-hidden',
          timestamp: 1,
          content: 'orphan tool result',
        } as unknown as RawMessage}
        showThinking={false}
        showToolCalls={false}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('orphan tool result')).not.toBeInTheDocument();
  });

  it('does not render opaque JSON-only standalone tool_result payloads', () => {
    const { container } = render(
      <ChatMessage
        message={{
          role: 'toolresult',
          id: 'tool-result-opaque-json',
          toolName: 'bash',
          timestamp: 1,
          content: '{"foo":"bar"}',
        } as unknown as RawMessage}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('{"foo":"bar"}')).not.toBeInTheDocument();
  });

  it('renders remote markdown images inside assistant messages', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-remote-markdown-image',
          timestamp: 1,
          content: '已为你生成图片：\n\n![underwater-city](https://example.com/underwater-city.png)',
        }}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(screen.getByText('已为你生成图片：')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'underwater-city' })).toHaveAttribute('src', 'https://example.com/underwater-city.png');
  });

  it('preserves tool name mapping and icon while keeping the richer summary detail', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-tool-summary',
          timestamp: 1,
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'browser',
              arguments: { action: 'open', targetUrl: 'https://example.com' },
            },
            {
              type: 'toolResult',
              id: 'tool-1',
              name: 'browser',
              text: '{"foo":"bar"}',
              status: 'completed',
            },
          ],
        } as unknown as RawMessage}
        showThinking={false}
        showToolCalls
      />,
    );

    const trigger = screen.getByRole('button', { name: /使用浏览器 open · https:\/\/example\.com/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain('使用浏览器 open · https://example.com');
    expect(trigger.textContent).not.toContain('browser');
    expect(trigger.querySelector('svg')).not.toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: /使用浏览器 open · https:\/\/example\.com/i })[1]!);
    expect(screen.getByText('Raw Result')).toBeInTheDocument();
    expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
  });

  it('does not show assistant usage badges in the hover row', () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-usage',
          timestamp: 1,
          content: 'Visible answer',
          usage: {
            input: 1200,
            output: 345,
            total: 1545,
            cacheRead: 22,
            cost: { total: 0.0123 },
          },
        }}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(screen.queryByText(/Input 1,200/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Output 345/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total 1,545/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cache read 22/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cost 0.0123/i)).not.toBeInTheDocument();
  });

  it('renders synthetic user notices outside the user bubble', () => {
    const message: RawMessage = {
      role: 'user',
      id: 'user-reminder-notice',
      timestamp: 1,
      content: [
        {
          type: 'text',
          text: 'System: [2026-04-19 14:13:38 GMT+8] Reminder delivered\n\nA scheduled reminder has been triggered. The reminder content is:\n检查线上报警并同步进展\nCurrent time: 2026-04-19 14:13:39 GMT+8 / 2026-04-19 06:13:39 UTC',
        },
      ],
    };

    const { container } = render(
      <ChatMessage
        message={message}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(screen.getByTestId('chat-system-notice')).toBeInTheDocument();
    expect(screen.getByText('System Notice')).toBeInTheDocument();
    expect(container.textContent).toContain('A scheduled reminder has been triggered. The reminder content is:');
    expect(container.textContent).toContain('检查线上报警并同步进展');
  });

  it('renders cleaned user bubble text instead of raw gateway metadata', () => {
    render(
      <ChatMessage
        message={{
          role: 'user',
          id: 'user-clean-text',
          timestamp: 1,
          content: '[Fri 2026-03-13 17:11 GMT+8] hello\n[media attached:/tmp/demo.png (image/png) | /tmp/demo.png]',
        } as RawMessage}
        showThinking={false}
        showToolCalls
      />,
    );

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.queryByText(/\[Fri 2026-03-13 17:11 GMT\+8\]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[media attached:/)).not.toBeInTheDocument();
  });
});
