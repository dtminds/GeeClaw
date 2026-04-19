/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import type { RawMessage, ContentBlock } from '@/stores/chat';
import {
  cleanUserMessageText,
  decideOpenClawUserMessageForUi,
  sanitizeMessageForDisplay,
  type UiMessageDecision,
} from '@/lib/chat-message-text';
import { splitMediaFromOutput } from '@/lib/media-output';
import i18n from '@/i18n';
import { formatRelativeTime } from '@/lib/utils';

function toMessageDate(timestamp: number): Date {
  return new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function getMessageTimeLocale(): string {
  return i18n.resolvedLanguage
    || i18n.language
    || (typeof navigator !== 'undefined' ? navigator.language : 'en');
}

function formatAbsoluteMessageTimestamp(date: Date, locale: string, now: Date): string {
  const sameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleString(locale, sameYear
    ? {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }
    : {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/**
 * Clean Gateway metadata from user message text for display.
 * Strips: [media attached: ... | ...], [message_id: ...],
 * and the timestamp prefix [Day Date Time Timezone].
 */
function cleanUserText(text: string): string {
  return cleanUserMessageText(text);
}

function cleanAssistantText(text: string): string {
  return splitMediaFromOutput(text).text;
}

function normalizeToolName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

export function shouldHideToolTrace(name: unknown): boolean {
  return normalizeToolName(name) === 'process';
}

function extractTextContentFromMessage(msg: Record<string, unknown>): string {
  const content = msg.content;

  if (typeof content === 'string') {
    return content.trim().length > 0 ? content : '';
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim().length > 0) {
        parts.push(block.text);
      }
    }
    const combined = parts.join('\n\n');
    return combined.trim().length > 0 ? combined : '';
  }

  if (typeof msg.text === 'string') {
    return msg.text.trim().length > 0 ? msg.text : '';
  }

  return '';
}

export function extractUserDisplayDecision(message: RawMessage | unknown): UiMessageDecision | null {
  if (!message || typeof message !== 'object') return null;
  const msg = sanitizeMessageForDisplay(message as Record<string, unknown>) as Record<string, unknown>;
  if (msg.role !== 'user') {
    return null;
  }

  const text = extractTextContentFromMessage(msg);
  if (!text) {
    return null;
  }

  return decideOpenClawUserMessageForUi(text);
}

/**
 * Extract displayable text from a message's content field.
 * Handles both string content and array-of-blocks content.
 * For user messages, strips Gateway-injected metadata.
 */
export function extractText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = sanitizeMessageForDisplay(message as Record<string, unknown>) as Record<string, unknown>;
  const isUser = msg.role === 'user';

  let result = extractTextContentFromMessage(msg);

  // Strip Gateway metadata from user messages for clean display
  if (isUser && result) {
    const decision = decideOpenClawUserMessageForUi(result);
    result = decision.action === 'show_chat_user' ? cleanUserText(result) : '';
  } else if (result) {
    result = cleanAssistantText(result);
  }

  return result;
}

/**
 * Extract thinking/reasoning content from a message.
 * Returns null if no thinking content found.
 */
export function extractThinking(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking) {
      const cleaned = block.thinking.trim();
      if (cleaned) {
        parts.push(cleaned);
      }
    }
  }

  const combined = parts.join('\n\n').trim();
  return combined.length > 0 ? combined : null;
}

/**
 * Extract media file references from Gateway-formatted user message text.
 * Returns array of { filePath, mimeType } from [media attached: path (mime) | path] patterns.
 */
export function extractMediaRefs(message: RawMessage | unknown): Array<{ filePath: string; mimeType: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  if (msg.role !== 'user') return [];
  const content = msg.content;

  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as ContentBlock[])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }

  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/**
 * Extract image attachments from a message.
 * Returns array of { mimeType, data } for base64 images.
 */
export function extractImages(message: RawMessage | unknown): Array<{ mimeType: string; data: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const images: Array<{ mimeType: string; data: string }> = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format
      if (block.source) {
        const src = block.source;
        if (src.type === 'base64' && src.media_type && src.data) {
          images.push({ mimeType: src.media_type, data: src.data });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        images.push({ mimeType: block.mimeType || 'image/jpeg', data: block.data });
      }
    }
  }

  return images;
}

/**
 * Extract tool use blocks from a message.
 * Handles both Anthropic format (tool_use in content array) and
 * OpenAI format (tool_calls array on the message object).
 */
export function extractToolUse(message: RawMessage | unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const tools: Array<{ id: string; name: string; input: unknown }> = [];

  // Path 1: Anthropic/normalized format — tool_use / toolCall blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
        tools.push({
          id: block.id || '',
          name: block.name,
          input: block.input ?? block.arguments,
        });
      }
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  // Real-time streaming events from OpenAI-compatible models (DeepSeek, etc.)
  // use this format; the Gateway normalizes to Path 1 when storing history.
  if (tools.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        let input: unknown;
        try {
          input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments ?? fn.input;
        } catch {
          input = fn.arguments;
        }
        tools.push({
          id: typeof tc.id === 'string' ? tc.id : '',
          name,
          input,
        });
      }
    }
  }

  return tools;
}

/**
 * Format a message timestamp into a localized short relative label,
 * then fall back to a localized date/time label once it is no longer today.
 */
export function formatTimestamp(timestamp: unknown): string {
  if (!timestamp) return '';
  const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!ts || isNaN(ts)) return '';

  const date = toMessageDate(ts);
  const now = new Date();
  const locale = getMessageTimeLocale();

  if (!isSameCalendarDay(date, now)) {
    return formatAbsoluteMessageTimestamp(date, locale, now);
  }

  return formatRelativeTime(date, {
    locale,
    now,
    style: 'short',
    absoluteAfterMs: 86_400_000,
    absoluteFormatter: (currentDate, locale) => formatAbsoluteMessageTimestamp(currentDate, locale, now),
  });
}
