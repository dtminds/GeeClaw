import {
  stripEnvelope,
  stripInboundMetadata,
  stripMessageIdHints,
  stripOpenClawInternalContextBlocks,
} from '@/lib/chat-message-text';
import { splitMediaFromOutput } from '@/lib/media-output';
import type { ContentBlock, RawMessage } from '@/stores/chat';
import { shouldHideToolTrace } from './message-utils';

export type AssistantPhase = 'commentary' | 'final_answer';

export type AssistantDisplaySegment = {
  type: 'text' | 'thinking';
  text: string;
  blockIndex: number;
};

export type AssistantMarkdownImage = {
  alt: string;
  mimeType: string;
  data: string;
};

export type AssistantDisplayModel = {
  parts: AssistantDisplaySegment[];
  visibleText: string;
  markdownImages: AssistantMarkdownImage[];
};

const REPLY_DIRECTIVE_RE = /\[\[\s*(?:reply_to_current|reply_to:[^\]]+)\s*\]\]/gi;
const DATA_IMAGE_RE = /^data:(image\/[^;,]+);base64,([^)\s]+)$/i;

function normalizeAssistantPhase(value: unknown): AssistantPhase | undefined {
  return value === 'commentary' || value === 'final_answer' ? value : undefined;
}

function getMessageContentRecord(message: unknown): Record<string, unknown> | null {
  return message && typeof message === 'object' ? message as Record<string, unknown> : null;
}

function normalizeDisplayText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripAssistantDirectiveTags(text: string): string {
  return text.replace(REPLY_DIRECTIVE_RE, '');
}

function getTextBlocks(message: unknown): Array<{ block: ContentBlock; blockIndex: number }> {
  const content = getMessageContentRecord(message)?.content;
  if (!Array.isArray(content)) return [];

  return (content as ContentBlock[])
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => block?.type === 'text' && typeof block.text === 'string');
}

type ResolvedTextBlock = {
  block: ContentBlock;
  blockIndex: number;
  resolvedPhase?: AssistantPhase;
  text: string;
};

function resolveTextBlocks(message: unknown): ResolvedTextBlock[] {
  const entry = getMessageContentRecord(message);
  const blocks = getTextBlocks(message);
  const messagePhase = normalizeAssistantPhase(entry?.phase);
  const hasExplicitPhasedTextBlocks = blocks.some(
    ({ block }) => Boolean(parseAssistantTextSignature(block.textSignature)?.phase),
  );

  return blocks.map(({ block, blockIndex }) => ({
    block,
    blockIndex,
    resolvedPhase: parseAssistantTextSignature(block.textSignature)?.phase
      ?? (hasExplicitPhasedTextBlocks ? undefined : messagePhase),
    text: typeof block.text === 'string' ? block.text.trim() : '',
  }));
}

function shouldIncludeResolvedTextBlock(block: ResolvedTextBlock, resolvedBlocks: ResolvedTextBlock[]): boolean {
  const hasFinalAnswer = resolvedBlocks.some(
    (candidate) => candidate.resolvedPhase === 'final_answer' && candidate.text,
  );

  if (hasFinalAnswer) {
    return block.resolvedPhase === 'final_answer' && Boolean(block.text);
  }

  return block.resolvedPhase === undefined && Boolean(block.text);
}

function matchFenceMarker(text: string, index: number): { char: '`' | '~'; length: number } | null {
  let cursor = index;
  let leadingSpaces = 0;
  while (text[cursor] === ' ' && leadingSpaces < 3) {
    cursor += 1;
    leadingSpaces += 1;
  }

  const char = text[cursor];
  if (char !== '`' && char !== '~') {
    return null;
  }

  let length = 0;
  while (text[cursor + length] === char) {
    length += 1;
  }

  return length >= 3 ? { char, length } : null;
}

function startsWithIgnoreCase(text: string, pattern: string, index: number): boolean {
  return text.slice(index, index + pattern.length).toLowerCase() === pattern.toLowerCase();
}

function findClosingAssistantTagIndex(text: string, tag: 'think' | 'final', startIndex: number): number {
  let inFence = false;
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;
  let atLineStart = true;

  for (let index = startIndex; index < text.length; index += 1) {
    if (atLineStart) {
      const fence = matchFenceMarker(text, index);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceChar = fence.char;
          fenceLength = fence.length;
        } else if (fence.char === fenceChar && fence.length >= fenceLength) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }
      }
    }

    if (!inFence && startsWithIgnoreCase(text, `</${tag}>`, index)) {
      return index;
    }

    atLineStart = text[index] === '\n';
  }

  return -1;
}

function parseTaggedAssistantText(text: string): Array<{ type: 'text' | 'thinking'; text: string }> {
  const parts: Array<{ type: 'text' | 'thinking'; text: string }> = [];
  let cursor = 0;
  let matched = false;
  const openingTagPattern = /<(think|final)>/gi;
  let match: RegExpExecArray | null;

  while ((match = openingTagPattern.exec(text)) !== null) {
    matched = true;
    const index = match.index ?? 0;
    const rawTag = (match[1] || '').toLowerCase() as 'think' | 'final';
    const leadingText = text.slice(cursor, index);
    if (leadingText.trim()) {
      parts.push({ type: 'text', text: leadingText });
    }

    const bodyStart = index + match[0].length;
    const bodyEnd = findClosingAssistantTagIndex(text, rawTag, bodyStart);
    if (bodyEnd === -1) {
      return text.trim() ? [{ type: 'text', text }] : [];
    }

    const body = text.slice(bodyStart, bodyEnd).trim();
    if (body) {
      parts.push({
        type: rawTag === 'think' ? 'thinking' : 'text',
        text: body,
      });
    }
    cursor = bodyEnd + rawTag.length + 3;
    openingTagPattern.lastIndex = cursor;
  }

  if (!matched) {
    return text.trim() ? [{ type: 'text', text }] : [];
  }

  const trailingText = text.slice(cursor);
  if (trailingText.trim()) {
    parts.push({ type: 'text', text: trailingText });
  }

  return parts;
}

function parseBalancedMarkdownSection(
  text: string,
  startIndex: number,
  openChar: '[' | '(',
  closeChar: ']' | ')',
): { value: string; endIndex: number } | null {
  if (text[startIndex] !== openChar) {
    return null;
  }

  let depth = 0;
  let value = '';
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\\' && index + 1 < text.length) {
      if (depth > 0) {
        value += text.slice(index, index + 2);
      }
      index += 1;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      if (depth > 1) {
        value += char;
      }
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { value, endIndex: index + 1 };
      }
      if (depth < 0) {
        return null;
      }
      value += char;
      continue;
    }

    if (depth > 0) {
      value += char;
    }
  }

  return null;
}

function flattenMarkdownImages(text: string): {
  text: string;
  markdownImages: AssistantMarkdownImage[];
} {
  const markdownImages: AssistantMarkdownImage[] = [];
  let flattened = '';

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '!' || text[index + 1] !== '[') {
      flattened += text[index];
      continue;
    }

    const alt = parseBalancedMarkdownSection(text, index + 1, '[', ']');
    if (!alt || text[alt.endIndex] !== '(') {
      flattened += text[index];
      continue;
    }

    const src = parseBalancedMarkdownSection(text, alt.endIndex, '(', ')');
    if (!src) {
      flattened += text[index];
      continue;
    }

    const original = text.slice(index, src.endIndex);
    const normalizedAlt = alt.value.trim();
    const normalizedSrc = src.value.trim();
    const dataMatch = normalizedSrc.match(DATA_IMAGE_RE);
    if (dataMatch) {
      markdownImages.push({
        alt: normalizedAlt || 'image',
        mimeType: dataMatch[1],
        data: dataMatch[2],
      });
      index = src.endIndex - 1;
      continue;
    }

    if (/^https?:\/\//i.test(normalizedSrc)) {
      flattened += original;
      index = src.endIndex - 1;
      continue;
    }

    flattened += original;
    index = src.endIndex - 1;
  }

  return { text: flattened, markdownImages };
}

function preprocessAssistantMarkdown(text: string): {
  text: string;
  markdownImages: AssistantMarkdownImage[];
} {
  const sanitizedText = normalizeDisplayText(
    stripAssistantDirectiveTags(
      splitMediaFromOutput(
        stripMessageIdHints(
          stripEnvelope(
            stripOpenClawInternalContextBlocks(
              stripInboundMetadata(text),
            ),
          ),
        ),
      ).text,
    ),
  );

  if (!sanitizedText) {
    return { text: '', markdownImages: [] };
  }

  const flattened = flattenMarkdownImages(sanitizedText);

  return {
    text: normalizeDisplayText(flattened.text),
    markdownImages: flattened.markdownImages,
  };
}

function sanitizeAssistantVisibilityText(text: string): string {
  return stripAssistantDirectiveTags(
    stripMessageIdHints(
      stripEnvelope(
        stripOpenClawInternalContextBlocks(
          stripInboundMetadata(text),
        ),
      ),
    ),
  ).trim();
}

function appendProcessedSegments(
  target: AssistantDisplaySegment[],
  markdownImages: AssistantMarkdownImage[],
  rawText: string,
  blockIndex: number,
  showThinking: boolean,
): void {
  for (const segment of parseTaggedAssistantText(rawText)) {
    const processed = preprocessAssistantMarkdown(segment.text);
    markdownImages.push(...processed.markdownImages);

    if (!processed.text) {
      continue;
    }

    if (segment.type === 'thinking') {
      if (showThinking) {
        target.push({ type: 'thinking', text: processed.text, blockIndex });
      }
      continue;
    }

    target.push({ type: 'text', text: processed.text, blockIndex });
  }
}

function getFallbackAssistantText(message: unknown): string {
  const entry = getMessageContentRecord(message);
  if (!entry) return '';

  if (typeof entry.content === 'string') {
    return entry.content;
  }
  if (typeof entry.text === 'string') {
    return entry.text;
  }
  return '';
}

function getDirectThinkingBlocks(message: unknown): Array<{ blockIndex: number; text: string }> {
  const content = getMessageContentRecord(message)?.content;
  if (!Array.isArray(content)) return [];

  return (content as ContentBlock[])
    .map((block, blockIndex) => ({
      blockIndex,
      text: block.type === 'thinking' && typeof block.thinking === 'string' ? block.thinking.trim() : '',
    }))
    .filter((block) => Boolean(block.text));
}

function extractToolResultRawText(message: RawMessage): string {
  const entry = getMessageContentRecord(message);
  if (!entry) return '';

  if (typeof entry.content === 'string') {
    return entry.content;
  }
  if (!Array.isArray(entry.content)) {
    return '';
  }

  const parts: string[] = [];
  for (const block of entry.content as ContentBlock[]) {
    if (block.type === 'text' && block.text?.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.join('\n').trim();
}

export function parseAssistantTextSignature(
  value: unknown,
): { id?: string; phase?: AssistantPhase } | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  if (!value.startsWith('{')) {
    return { id: value };
  }
  try {
    const parsed = JSON.parse(value) as { id?: unknown; phase?: unknown; v?: unknown };
    if (parsed.v !== 1) {
      return null;
    }
    return {
      ...(typeof parsed.id === 'string' ? { id: parsed.id } : {}),
      ...(normalizeAssistantPhase(parsed.phase)
        ? { phase: normalizeAssistantPhase(parsed.phase) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function resolveAssistantMessagePhase(message: unknown): AssistantPhase | undefined {
  const entry = getMessageContentRecord(message);
  if (!entry) {
    return undefined;
  }

  const directPhase = normalizeAssistantPhase(entry.phase);
  if (directPhase) {
    return directPhase;
  }

  const explicitPhases = new Set<AssistantPhase>();
  for (const { block } of getTextBlocks(message)) {
    const phase = parseAssistantTextSignature(block.textSignature)?.phase;
    if (phase) {
      explicitPhases.add(phase);
    }
  }

  return explicitPhases.size === 1 ? [...explicitPhases][0] : undefined;
}

export function extractAssistantVisibleText(message: unknown): string | undefined {
  const entry = getMessageContentRecord(message);
  if (!entry) {
    return undefined;
  }

  if (!Array.isArray(entry.content)) {
    const text = sanitizeAssistantVisibilityText(getFallbackAssistantText(message));
    if (!text) {
      return undefined;
    }
    const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : '';
    if (role === 'toolresult' || role === 'tool_result') {
      return formatToolResultText(text, typeof entry.toolName === 'string' ? entry.toolName : undefined) || undefined;
    }
    return text;
  }

  const resolvedBlocks = resolveTextBlocks(message);
  const visibleParts = resolvedBlocks
    .filter((block) => shouldIncludeResolvedTextBlock(block, resolvedBlocks))
    .map((block) => sanitizeAssistantVisibilityText(block.text))
    .filter(Boolean);

  if (visibleParts.length === 0) {
    return undefined;
  }

  return visibleParts.join('\n');
}

export function extractAssistantDisplaySegments(
  message: RawMessage,
  options: { showThinking: boolean },
): AssistantDisplayModel {
  const parts: AssistantDisplaySegment[] = [];
  const markdownImages: AssistantMarkdownImage[] = [];
  const entry = getMessageContentRecord(message);

  if (!entry) {
    return { parts, visibleText: '', markdownImages };
  }

  const content = entry.content;
  if (Array.isArray(content)) {
    const resolvedBlocks = resolveTextBlocks(message);
    const visibleBlockIndexes = new Set(
      resolvedBlocks
        .filter((block) => shouldIncludeResolvedTextBlock(block, resolvedBlocks))
        .map((block) => block.blockIndex),
    );

    for (const thinkingBlock of getDirectThinkingBlocks(message)) {
      if (options.showThinking) {
        parts.push({ type: 'thinking', text: thinkingBlock.text, blockIndex: thinkingBlock.blockIndex });
      }
    }

    for (const { block, blockIndex } of getTextBlocks(message)) {
      if (!visibleBlockIndexes.has(blockIndex) || !block.text) {
        continue;
      }
      appendProcessedSegments(parts, markdownImages, block.text, blockIndex, options.showThinking);
    }
  } else {
    const fallbackText = getFallbackAssistantText(message);
    if (fallbackText.trim()) {
      const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : '';
      const displayText = (role === 'toolresult' || role === 'tool_result')
        ? formatToolResultText(fallbackText, typeof entry.toolName === 'string' ? entry.toolName : undefined)
        : fallbackText;
      if (displayText) {
        appendProcessedSegments(parts, markdownImages, displayText, 0, options.showThinking);
      }
    }
  }

  const visibleText = parts
    .filter((part) => part.type === 'text' && part.text.trim())
    .map((part) => part.text)
    .join('\n\n')
    .trim();

  return {
    parts,
    visibleText,
    markdownImages,
  };
}

function truncateText(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function formatStructuredError(value: string): string {
  let next = value.trim();
  if (/\bagent=/.test(next) && /\baction=/.test(next) && next.includes(': ')) {
    next = next.slice(next.indexOf(': ') + 2);
  }
  const firstLine = next.split(/\r?\n/, 1)[0]?.trim() || next;
  return truncateText(firstLine, 220);
}

function stringifyJsonField(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function summarizeNodesResult(payload: Record<string, unknown>): string {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes as Array<Record<string, unknown>> : null;
  if (nodes) {
    if (nodes.length === 0) {
      return 'No nodes found.';
    }

    const lines = nodes.map((node) => {
      const displayName = typeof node.displayName === 'string'
        ? node.displayName
        : typeof node.name === 'string'
          ? node.name
          : 'Node';
      const connected = node.connected === true ? 'connected' : node.connected === false ? 'disconnected' : null;
      const platform = typeof node.platform === 'string' ? node.platform : null;
      const detail = [connected, platform].filter(Boolean).join(', ');
      return detail ? `• ${displayName} - ${detail}` : `• ${displayName}`;
    });

    return `${nodes.length} node${nodes.length === 1 ? '' : 's'} found.\n${lines.join('\n')}`;
  }

  const pendingCount = Array.isArray(payload.pending) ? payload.pending.length : 0;
  const pairedCount = Array.isArray(payload.paired) ? payload.paired.length : 0;
  if (pendingCount > 0 || pairedCount > 0) {
    return `Pairing requests: ${pendingCount} pending, ${pairedCount} paired.`;
  }

  return '';
}

export function formatToolResultText(text: string | undefined, toolName?: string): string {
  const trimmed = text?.trim() || '';
  if (!trimmed) {
    return '';
  }

  if (!/^[[{]/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return 'No items.';
      }
      return `${parsed.length} item${parsed.length === 1 ? '' : 's'}.`;
    }

    if (!parsed || typeof parsed !== 'object') {
      return trimmed;
    }

    const payload = parsed as Record<string, unknown>;
    const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
    const errorValue = stringifyJsonField(payload.error) || stringifyJsonField(payload.reason);
    if (status === 'error' || errorValue) {
      return `Error: ${formatStructuredError(errorValue || status)}`;
    }

    if ((toolName || '').trim().toLowerCase() === 'nodes') {
      const nodesSummary = summarizeNodesResult(payload);
      if (nodesSummary) {
        return nodesSummary;
      }
    }

    for (const key of ['message', 'result', 'detail'] as const) {
      const value = stringifyJsonField(payload[key]);
      if (value) {
        return value;
      }
    }

    if (status) {
      return `Status: ${status}`;
    }

    return '';
  } catch {
    return trimmed;
  }
}

export function shouldRenderStandaloneToolResult(
  message: RawMessage,
  options: { showToolCalls: boolean },
): boolean {
  if ((message.role || '').toLowerCase() !== 'toolresult' && (message.role || '').toLowerCase() !== 'tool_result') {
    return false;
  }
  if (message._toolResultMatched) {
    return false;
  }
  if (!options.showToolCalls) {
    return false;
  }
  if (shouldHideToolTrace(message.toolName)) {
    return false;
  }

  const display = extractAssistantDisplaySegments(message, { showThinking: false });
  const rawToolText = extractToolResultRawText(message);
  return Boolean(display.visibleText || formatToolResultText(rawToolText, message.toolName));
}
