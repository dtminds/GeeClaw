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
  beforeEach(() => {
    invokeIpcMock.mockReset();
    sendMessageMock = vi.fn(async () => undefined);
    useChatStore.setState({ sending: false, sendMessage: sendMessageMock });
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
    expect(screen.getByText(/pwd/)).toBeInTheDocument();
    expect(screen.getByText('接着我继续分析结果。')).toBeInTheDocument();

    const renderedText = container.textContent || '';
    expect(renderedText.indexOf('我先看一下当前目录。')).toBeLessThan(renderedText.indexOf('pwd'));
    expect(renderedText.indexOf('pwd')).toBeLessThan(renderedText.indexOf('接着我继续分析结果。'));

    const markdownBlocks = container.querySelectorAll('.chat-markdown');
    expect(markdownBlocks).toHaveLength(2);
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
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-card',
          timestamp: 1,
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
              updatedAt: 1,
            },
          ],
        } as unknown as RawMessage}
        showThinking
        showToolCalls={false}
      />,
    );

    expect(screen.getByText('Hermes 进化请求')).toBeInTheDocument();
    expect(screen.getByText('基于工具调用失败的教训，固化一套资讯搜索回退策略')).toBeInTheDocument();
    expect(screen.getByText('工具调用')).toBeInTheDocument();
    expect(screen.getByText('/tmp/tool-policy.md')).toBeInTheDocument();
    expect(screen.getByText('确认进化')).toBeInTheDocument();
    expect(screen.getByText('拒绝')).toBeInTheDocument();
  });

  it('sends rejection commands from evolution proposal cards', async () => {
    render(
      <ChatMessage
        message={{
          role: 'assistant',
          id: 'assistant-evolution-reject',
          timestamp: 1,
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
              updatedAt: 1,
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
    expect(screen.queryByText('Hermes 进化请求')).not.toBeInTheDocument();
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
