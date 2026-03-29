import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { buildChatItems } from '@/pages/Chat/build-chat-items';
import type { RawMessage } from '@/stores/chat';

const { invokeIpcMock } = vi.hoisted(() => ({
  invokeIpcMock: vi.fn(),
}));

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
        language: 'zh-CN',
        resolvedLanguage: 'zh-CN',
      },
    }),
  };
});

describe('chat live rendering', () => {
  beforeEach(() => {
    invokeIpcMock.mockReset();
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
});
