import {
  stripEnvelope,
  stripInboundMetadata,
  stripMessageIdHints,
  stripOpenClawInternalContextBlocks,
} from '@/lib/chat-message-text';
import { splitMediaFromOutput } from '@/lib/media-output';
import type { ContentBlock, RawMessage, ToolStatus } from '@/stores/chat';
import { extractToolUse, shouldHideToolTrace } from './message-utils';
import { extractEvolutionProposalCardData } from './evolution-proposal';

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

export type AssistantToolGroupItem = {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
  timestamp?: number;
};

export type AssistantToolGroupSummaryPart = {
  category: 'read_files' | 'edit_files' | 'execute_commands' | 'web_access' | 'generic_tools';
  count: number;
  label: string;
};

export type AssistantDisplayToolGroupPart = {
  type: 'tool_group';
  items: AssistantToolGroupItem[];
  summary: string;
  summaryParts: AssistantToolGroupSummaryPart[];
  collapsed: boolean;
};

export type AssistantDisplayPart = AssistantDisplaySegment | AssistantDisplayToolGroupPart;

export type AssistantTurnDisplayModel = {
  parts: AssistantDisplayPart[];
  visibleText: string;
  markdownImages: AssistantMarkdownImage[];
};

export type BuildAssistantDisplayModelOptions = {
  showThinking: boolean;
  showToolCalls: boolean;
  isStreaming: boolean;
  liveToolMessages: RawMessage[];
  liveStreamSegments: Array<{ text: string; ts: number }>;
  liveToolStatuses?: ToolStatus[];
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

function collectProcessedAssistantSegments(
  rawText: string,
  blockIndex: number,
  showThinking: boolean,
): {
  parts: AssistantDisplaySegment[];
  markdownImages: AssistantMarkdownImage[];
} {
  const parts: AssistantDisplaySegment[] = [];
  const markdownImages: AssistantMarkdownImage[] = [];
  appendProcessedSegments(parts, markdownImages, rawText, blockIndex, showThinking);
  return { parts, markdownImages };
}

function extractPlainTextFromUnknown(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text?.trim()) {
      parts.push(block.text.trim());
      continue;
    }

    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      const nested = extractPlainTextFromUnknown(block.content);
      if (nested) {
        parts.push(nested);
      }
    }
  }

  return parts.join('\n').trim();
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

export function isEmptyAssistantTurn(message: RawMessage): boolean {
  const entry = getMessageContentRecord(message);
  if (!entry) {
    return false;
  }

  const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : '';
  if (role !== 'assistant') {
    return false;
  }

  if (extractAssistantVisibleText(message)) {
    return false;
  }

  if ((message._attachedFiles?.length ?? 0) > 0) {
    return false;
  }

  const content = entry.content;
  if (typeof content === 'string') {
    return content.trim().length === 0;
  }

  if (!Array.isArray(content)) {
    return typeof entry.text === 'string' ? entry.text.trim().length === 0 : true;
  }

  return !(content as ContentBlock[]).some((block) => {
    if (block.type === 'text') {
      return Boolean(block.text?.trim());
    }

    return block.type === 'thinking'
      || block.type === 'image'
      || block.type === 'tool_use'
      || block.type === 'toolCall'
      || block.type === 'tool_result'
      || block.type === 'toolResult';
  });
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

function findMatchingToolStatus(
  toolStatuses: ToolStatus[],
  id?: string,
  name?: string,
): ToolStatus | undefined {
  if (id) {
    const byId = toolStatuses.find((status) => status.toolCallId === id || status.id === id);
    if (byId) {
      return byId;
    }
  }

  return name ? toolStatuses.find((status) => status.name === name) : undefined;
}

function extractInlineToolResultText(block: ContentBlock): string | undefined {
  const raw = extractPlainTextFromUnknown(block.content ?? block.text ?? '');
  if (raw) {
    return raw;
  }

  if (typeof block.error === 'string' && block.error.trim()) {
    return block.error.trim();
  }

  return undefined;
}

function getInlineToolResultStatus(block: ContentBlock, resultText?: string): AssistantToolGroupItem['status'] {
  const rawStatus = typeof block.status === 'string' ? block.status.toLowerCase() : '';
  const hasErrorPayload = typeof block.error === 'string' && block.error.trim().length > 0;
  const isFailedStatus = rawStatus === 'error'
    || rawStatus === 'failed'
    || rawStatus === 'failure';
  if (isFailedStatus || block.isError === true || block.is_error === true || hasErrorPayload) {
    return 'error';
  }
  if (rawStatus === 'completed' || rawStatus === 'success' || typeof resultText === 'string') {
    return 'completed';
  }
  return 'running';
}

function toAssistantToolGroupItem(
  name: string,
  id: string | undefined,
  input: unknown,
  toolStatus?: ToolStatus,
  timestamp?: number,
): AssistantToolGroupItem {
  return {
    id: id || name,
    name,
    input,
    status: toolStatus?.status || 'running',
    durationMs: toolStatus?.durationMs,
    result: toolStatus?.result,
    ...(typeof timestamp === 'number' ? { timestamp } : {}),
  };
}

function shouldIncludeToolDisplay(
  name: string,
  input: unknown,
  result: unknown,
  showToolCalls: boolean,
): boolean {
  return showToolCalls || extractEvolutionProposalCardData(name, input, result) !== null;
}

type InlineToolResultData = {
  status: AssistantToolGroupItem['status'];
  result?: string;
};

function buildInlineToolResultMap(content: ContentBlock[]): Map<string, InlineToolResultData> {
  const inlineResults = new Map<string, InlineToolResultData>();

  const remember = (key: string | undefined, value: InlineToolResultData) => {
    if (!key) {
      return;
    }
    inlineResults.set(key, value);
  };

  for (const block of content) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') {
      continue;
    }

    const resultText = extractInlineToolResultText(block);
    const inlineResult = {
      status: getInlineToolResultStatus(block, resultText),
      result: resultText,
    } satisfies InlineToolResultData;

    remember(block.id, inlineResult);
    remember(block.name, inlineResult);
    if (!block.id && !block.name) {
      remember('__unnamed__', inlineResult);
    }
  }

  return inlineResults;
}

function extractFinalizedAssistantDisplayParts(
  message: RawMessage | null,
  options: Pick<BuildAssistantDisplayModelOptions, 'showThinking' | 'showToolCalls'>,
): {
  parts: Array<AssistantDisplaySegment | AssistantToolGroupItem>;
  markdownImages: AssistantMarkdownImage[];
} {
  if (!message) {
    return { parts: [], markdownImages: [] };
  }

  const display = extractAssistantDisplaySegments(message, { showThinking: options.showThinking });
  const parts: Array<AssistantDisplaySegment | AssistantToolGroupItem> = [];
  const toolStatuses = message._toolStatuses || [];
  const textPartsByBlock = display.parts.reduce<Map<number, AssistantDisplaySegment[]>>((map, part) => {
    const blockParts = map.get(part.blockIndex) || [];
    blockParts.push(part);
    map.set(part.blockIndex, blockParts);
    return map;
  }, new Map());
  const content = Array.isArray(message.content) ? message.content : null;

  if (!content) {
    for (const tool of extractToolUse(message)) {
      if (shouldHideToolTrace(tool.name)) {
        continue;
      }
      const toolStatus = findMatchingToolStatus(toolStatuses, tool.id, tool.name);
      if (!shouldIncludeToolDisplay(tool.name, tool.input, toolStatus?.result, options.showToolCalls)) {
        continue;
      }
      parts.push(toAssistantToolGroupItem(tool.name, tool.id, tool.input, toolStatus));
    }

    parts.push(...display.parts);
    return { parts, markdownImages: display.markdownImages };
  }

  const pushTextPartsForBlock = (blockIndex: number) => {
    const blockParts = textPartsByBlock.get(blockIndex);
    if (!blockParts) {
      return;
    }
    parts.push(...blockParts);
  };
  const hasInlineToolBlocks = content.some((block) => (
    block?.type === 'tool_use' || block?.type === 'toolCall'
  ));
  const inlineToolResults = buildInlineToolResultMap(content);

  for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
    pushTextPartsForBlock(blockIndex);
    const block = content[blockIndex];

    if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
      if (shouldHideToolTrace(block.name)) {
        continue;
      }
      const toolStatus = findMatchingToolStatus(toolStatuses, block.id, block.name);
      const inlineResult = inlineToolResults.get(block.id) ?? inlineToolResults.get(block.name);
      const mergedStatus = inlineResult?.status ?? toolStatus?.status;
      const mergedResult = inlineResult?.result ?? toolStatus?.result;
      if (!shouldIncludeToolDisplay(
        block.name,
        block.input ?? block.arguments,
        mergedResult,
        options.showToolCalls,
      )) {
        continue;
      }
      parts.push({
        ...toAssistantToolGroupItem(
          block.name,
          block.id,
          block.input ?? block.arguments,
          toolStatus,
        ),
        ...(mergedStatus ? { status: mergedStatus } : {}),
        ...(typeof mergedResult === 'string' ? { result: mergedResult } : {}),
      });
      continue;
    }

    if (block.type === 'tool_result' || block.type === 'toolResult') {
      const resultText = extractInlineToolResultText(block);
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if ('type' in part) {
          continue;
        }
        const matchesById = Boolean(block.id) && part.id === block.id;
        const matchesByName = Boolean(block.name) && part.name === block.name;
        const matchesUnnamedResult = !block.id && !block.name;
        if (!matchesById && !matchesByName && !matchesUnnamedResult) {
          continue;
        }

        parts[index] = {
          ...part,
          status: getInlineToolResultStatus(block, resultText),
          result: resultText ?? part.result,
        };
        break;
      }
    }
  }

  const missingToolParts: AssistantToolGroupItem[] = [];
  for (const tool of extractToolUse(message)) {
    if (shouldHideToolTrace(tool.name)) {
      continue;
    }

    const alreadyRendered = parts.some((part) => (
      !('type' in part)
      && (tool.id ? part.id === tool.id : part.name === tool.name)
    ));
    if (alreadyRendered) {
      continue;
    }

    const toolStatus = findMatchingToolStatus(toolStatuses, tool.id, tool.name);
    const inlineResult = inlineToolResults.get(tool.id) ?? inlineToolResults.get(tool.name);
    const mergedResult = inlineResult?.result ?? toolStatus?.result;
    if (!shouldIncludeToolDisplay(tool.name, tool.input, mergedResult, options.showToolCalls)) {
      continue;
    }
    missingToolParts.push({
      ...toAssistantToolGroupItem(tool.name, tool.id, tool.input, toolStatus),
      ...(inlineResult?.status ? { status: inlineResult.status } : {}),
      ...(typeof mergedResult === 'string' ? { result: mergedResult } : {}),
    });
  }

  if (missingToolParts.length > 0) {
    parts.splice(hasInlineToolBlocks ? parts.length : 0, 0, ...missingToolParts);
  }
  return { parts, markdownImages: display.markdownImages };
}

function extractLiveAssistantDisplayParts(
  options: Pick<BuildAssistantDisplayModelOptions, 'showThinking' | 'showToolCalls' | 'liveToolMessages' | 'liveStreamSegments' | 'liveToolStatuses'>,
): {
  parts: Array<(AssistantDisplaySegment & { sortTs: number; order: number }) | AssistantToolGroupItem>;
  markdownImages: AssistantMarkdownImage[];
} {
  const parts: Array<(AssistantDisplaySegment & { sortTs: number; order: number }) | AssistantToolGroupItem> = [];
  const markdownImages: AssistantMarkdownImage[] = [];

  options.liveStreamSegments.forEach((segment, index) => {
    const processed = collectProcessedAssistantSegments(segment.text, index, options.showThinking);
    markdownImages.push(...processed.markdownImages);
    processed.parts.forEach((part, partIndex) => {
      parts.push({
        ...part,
        sortTs: segment.ts,
        order: (index * 100) + partIndex,
      });
    });
  });

  if (!options.showToolCalls) {
    return { parts, markdownImages };
  }

  options.liveToolMessages.forEach((message, index) => {
    const tool = extractToolUse(message)[0];
    if (!tool || shouldHideToolTrace(tool.name)) {
      return;
    }

    const toolStatuses = [
      ...(message._toolStatuses || []),
      ...(options.liveToolStatuses || []),
    ];
    const toolStatus = findMatchingToolStatus(
      toolStatuses,
      tool.id || message.toolCallId,
      tool.name || message.toolName,
    );

    parts.push({
      ...toAssistantToolGroupItem(
        tool.name,
        tool.id || message.toolCallId,
        tool.input,
        toolStatus,
        typeof message.timestamp === 'number' ? message.timestamp : undefined,
      ),
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : Number.MAX_SAFE_INTEGER - index,
    });
  });

  parts.sort((left, right) => {
    const leftTs = 'sortTs' in left ? left.sortTs : (left.timestamp ?? Number.MAX_SAFE_INTEGER);
    const rightTs = 'sortTs' in right ? right.sortTs : (right.timestamp ?? Number.MAX_SAFE_INTEGER);
    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }

    const leftOrder = 'order' in left ? left.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = 'order' in right ? right.order : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  return { parts, markdownImages };
}

function isAssistantToolGroupItem(
  part: AssistantDisplaySegment | AssistantToolGroupItem | (AssistantDisplaySegment & { sortTs: number; order: number }),
): part is AssistantToolGroupItem {
  return !('type' in part);
}

function extractToolFilePaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') {
    return [];
  }

  const record = input as Record<string, unknown>;
  const candidates = [
    record.filePath,
    record.path,
    record.targetFile,
    record.target_file,
    record.relativePath,
    record.cwd,
    record.paths,
    record.files,
  ];

  return candidates.flatMap((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }

    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    return [];
  });
}

function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildToolGroupSummaryPart(
  category: AssistantToolGroupSummaryPart['category'],
  count: number,
  label: string,
): AssistantToolGroupSummaryPart | null {
  return count > 0 ? { category, count, label } : null;
}

function summarizeToolGroup(items: AssistantToolGroupItem[]): {
  summary: string;
  summaryParts: AssistantToolGroupSummaryPart[];
} {
  const readItems = items.filter((item) => ['read', 'view', 'glob', 'grep'].includes(item.name.trim().toLowerCase()));
  const editItems = items.filter((item) => ['edit', 'write', 'apply_patch'].includes(item.name.trim().toLowerCase()));
  const commandItems = items.filter((item) => ['bash', 'exec', 'run_command'].includes(item.name.trim().toLowerCase()));
  const webItems = items.filter((item) => (
    ['fetch', 'web_search', 'browser', 'browser_fetch', 'browser_open'].includes(item.name.trim().toLowerCase())
    || item.name.trim().toLowerCase().includes('search')
    || item.name.trim().toLowerCase().includes('web')
  ));

  const categorizedNames = new Set([
    ...readItems.map((item) => item.id),
    ...editItems.map((item) => item.id),
    ...commandItems.map((item) => item.id),
    ...webItems.map((item) => item.id),
  ]);
  const genericItems = items.filter((item) => !categorizedNames.has(item.id));

  const readCount = new Set(readItems.flatMap((item) => extractToolFilePaths(item.input))).size || readItems.length;
  const editCount = new Set(editItems.flatMap((item) => extractToolFilePaths(item.input))).size || editItems.length;

  const summaryParts = [
    buildToolGroupSummaryPart('edit_files', editCount, `Edited ${formatCountLabel(editCount, 'file')}`),
    buildToolGroupSummaryPart('execute_commands', commandItems.length, `Ran ${formatCountLabel(commandItems.length, 'command')}`),
    buildToolGroupSummaryPart('read_files', readCount, `Read ${formatCountLabel(readCount, 'file')}`),
    buildToolGroupSummaryPart('web_access', webItems.length, `Made ${formatCountLabel(webItems.length, 'web request')}`),
    buildToolGroupSummaryPart('generic_tools', genericItems.length, `Used ${formatCountLabel(genericItems.length, 'tool')}`),
  ].filter((part): part is AssistantToolGroupSummaryPart => Boolean(part));

  return {
    summaryParts,
    summary: summaryParts.slice(0, 3).map((part) => part.label).join(', ') || `Used ${formatCountLabel(items.length, 'tool')}`,
  };
}

function groupConsecutiveToolParts(
  parts: Array<AssistantDisplaySegment | AssistantToolGroupItem>,
): AssistantDisplayPart[] {
  const grouped: AssistantDisplayPart[] = [];
  let toolBuffer: AssistantToolGroupItem[] = [];

  const flushToolBuffer = () => {
    if (toolBuffer.length === 0) {
      return;
    }

    const summary = summarizeToolGroup(toolBuffer);
    grouped.push({
      type: 'tool_group',
      items: toolBuffer,
      summary: summary.summary,
      summaryParts: summary.summaryParts,
      collapsed: false,
    });
    toolBuffer = [];
  };

  for (const part of parts) {
    if (isAssistantToolGroupItem(part)) {
      toolBuffer.push(part);
      continue;
    }

    flushToolBuffer();
    grouped.push(part);
  }

  flushToolBuffer();
  return grouped;
}

function resolveToolGroupCollapseState(
  parts: AssistantDisplayPart[],
  isStreaming: boolean,
): AssistantDisplayPart[] {
  return parts.map((part, index) => {
    if (part.type !== 'tool_group') {
      return part;
    }

    const hasLaterAssistantText = parts.slice(index + 1).some((candidate) => (
      candidate.type === 'text' && candidate.text.trim().length > 0
    ));

    return {
      ...part,
      collapsed: !isStreaming || hasLaterAssistantText,
    };
  });
}

export function buildAssistantDisplayModel(
  message: RawMessage | null,
  options: BuildAssistantDisplayModelOptions,
): AssistantTurnDisplayModel {
  const finalized = extractFinalizedAssistantDisplayParts(message, options);
  const live = extractLiveAssistantDisplayParts(options);
  const normalizedParts = groupConsecutiveToolParts([
    ...finalized.parts,
    ...live.parts,
  ]);
  const parts = resolveToolGroupCollapseState(normalizedParts, options.isStreaming);
  const visibleText = parts
    .filter((part): part is AssistantDisplaySegment => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim();

  return {
    parts,
    visibleText,
    markdownImages: [...finalized.markdownImages, ...live.markdownImages],
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
