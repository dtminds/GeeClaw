import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import {
  extractAssistantDisplaySegments,
  extractAssistantVisibleText,
  formatToolResultText,
  parseAssistantTextSignature,
  resolveAssistantMessagePhase,
  shouldRenderStandaloneToolResult,
} from '@/pages/Chat/assistant-display';

const commentarySignature = JSON.stringify({ v: 1, id: 'msg-commentary', phase: 'commentary' });
const finalSignature = JSON.stringify({ v: 1, id: 'msg-final', phase: 'final_answer' });

describe('assistant-display', () => {
  it('parses OpenClaw-style text signatures', () => {
    expect(parseAssistantTextSignature(finalSignature)).toEqual({
      id: 'msg-final',
      phase: 'final_answer',
    });
  });

  it('resolves assistant phase from top-level or block metadata', () => {
    expect(resolveAssistantMessagePhase({ role: 'assistant', phase: 'commentary' })).toBe('commentary');
    expect(resolveAssistantMessagePhase({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Final', textSignature: finalSignature },
      ],
    })).toBe('final_answer');
  });

  it('hides commentary-only assistant messages', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking like caveman', textSignature: commentarySignature },
      ],
    } as unknown as RawMessage;

    expect(extractAssistantVisibleText(message)).toBeUndefined();
    expect(extractAssistantDisplaySegments(message, { showThinking: false }).visibleText).toBe('');
  });

  it('prefers final_answer text over commentary text', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'working...', textSignature: commentarySignature },
        { type: 'text', text: 'Actual final answer', textSignature: finalSignature },
      ],
    } as unknown as RawMessage;

    expect(extractAssistantVisibleText(message)).toBe('Actual final answer');
  });

  it('keeps legacy unphased assistant text working', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Legacy answer' }],
    } as unknown as RawMessage;

    expect(extractAssistantVisibleText(message)).toBe('Legacy answer');
  });

  it('parses think/final tags with trace-aware visibility', () => {
    const message = {
      role: 'assistant',
      content: '<think>inner reasoning</think><final>Visible answer</final>',
    } as unknown as RawMessage;

    expect(extractAssistantDisplaySegments(message, { showThinking: false })).toMatchObject({
      visibleText: 'Visible answer',
      parts: [{ type: 'text', text: 'Visible answer' }],
    });

    expect(extractAssistantDisplaySegments(message, { showThinking: true })).toMatchObject({
      visibleText: 'Visible answer',
      parts: [
        { type: 'thinking', text: 'inner reasoning' },
        { type: 'text', text: 'Visible answer' },
      ],
    });
  });

  it('does not create a visible assistant bubble for pure think content when trace is off', () => {
    const message = {
      role: 'assistant',
      content: '<think>inner reasoning only</think>',
    } as unknown as RawMessage;

    expect(extractAssistantDisplaySegments(message, { showThinking: false })).toMatchObject({
      visibleText: '',
      parts: [],
    });

    expect(extractAssistantDisplaySegments(message, { showThinking: true })).toMatchObject({
      visibleText: '',
      parts: [{ type: 'thinking', text: 'inner reasoning only' }],
    });
  });

  it('flattens remote markdown images to alt text and extracts data images separately', () => {
    const message = {
      role: 'assistant',
      content: 'Before ![diagram](https://example.com/diagram.png) after ![](https://example.com/raw.png)\n![inline](data:image/png;base64,AAA=)',
    } as unknown as RawMessage;

    expect(extractAssistantDisplaySegments(message, { showThinking: false })).toMatchObject({
      visibleText: 'Before diagram after image',
      markdownImages: [{ mimeType: 'image/png', data: 'AAA=', alt: 'inline' }],
    });
  });

  it('preserves markdown-significant spacing inside assistant text', () => {
    const message = {
      role: 'assistant',
      content: '```ts\nconst  value = 1;\n  return value;\n```\n\n| col a | col b |\n| --- | --- |\n| 1 |  two |\n',
    } as unknown as RawMessage;

    expect(extractAssistantDisplaySegments(message, { showThinking: false }).visibleText).toBe(
      '```ts\nconst  value = 1;\n  return value;\n```\n\n| col a | col b |\n| --- | --- |\n| 1 |  two |',
    );
  });

  it('only shows standalone tool_result turns when tool traces are enabled and content is displayable', () => {
    const visibleToolResult = {
      role: 'toolresult',
      content: 'orphan tool result',
    } as unknown as RawMessage;
    const emptyToolResult = {
      role: 'toolresult',
      content: '',
    } as unknown as RawMessage;

    expect(shouldRenderStandaloneToolResult(visibleToolResult, { showToolCalls: false })).toBe(false);
    expect(shouldRenderStandaloneToolResult(visibleToolResult, { showToolCalls: true })).toBe(true);
    expect(shouldRenderStandaloneToolResult(emptyToolResult, { showToolCalls: true })).toBe(false);
  });

  it('suppresses opaque JSON-only tool results instead of rendering raw payloads', () => {
    const message = {
      role: 'toolresult',
      toolName: 'bash',
      content: '{"foo":"bar"}',
    } as unknown as RawMessage;

    expect(extractAssistantVisibleText(message)).toBeUndefined();
    expect(extractAssistantDisplaySegments(message, { showThinking: false })).toMatchObject({
      visibleText: '',
      parts: [],
    });
    expect(shouldRenderStandaloneToolResult(message, { showToolCalls: true })).toBe(false);
  });

  it('formats structured tool errors and suppresses opaque JSON previews', () => {
    expect(formatToolResultText('{"error":"Command failed"}', 'bash')).toBe('Error: Command failed');
    expect(formatToolResultText('{"foo":"bar"}', 'bash')).toBe('');
    expect(formatToolResultText('plain text output', 'bash')).toBe('plain text output');
  });
});
