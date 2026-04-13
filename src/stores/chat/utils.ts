import {
  cleanUserMessageText,
  renderSkillMarkersAsPlainText,
  stripRuntimeChannelTags,
} from '@/lib/chat-message-text';
import { extractAssistantVisibleText } from '@/pages/Chat/assistant-display';
import type { ContentBlock, RawMessage } from './model';

const EXEC_TOOL_NAMES = new Set(['exec', 'bash', 'shell', 'run_command', 'command']);
const RAW_PATH_SCAN_COMMANDS = new Set(['ls', 'find', 'tree', 'fd', 'rg', 'grep', 'ag', 'locate', 'which', 'where']);
const INTERNAL_ASSISTANT_ACK_MESSAGES = new Set(['HEARTBEAT_OK', 'NO_REPLY']);

/** Normalize a timestamp to milliseconds. Handles both seconds and ms. */
export function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (before ~2033); >= 1e12 are milliseconds
  return ts < 1e12 ? ts * 1000 : ts;
}

/** Extract plain text from message content (string or content blocks) */
export function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('\n');
  }
  return '';
}

export function isInternalMessage(message: RawMessage): boolean {
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  if (role === 'system') {
    return true;
  }

  if (role !== 'assistant') {
    return false;
  }

  const contentText = getMessageText(message.content).trim();
  if (contentText) {
    return INTERNAL_ASSISTANT_ACK_MESSAGES.has(contentText);
  }

  const messageRecord = message as unknown as Record<string, unknown>;
  return typeof messageRecord.text === 'string'
    && INTERNAL_ASSISTANT_ACK_MESSAGES.has(messageRecord.text.trim());
}

export function hasEquivalentFinalAssistantMessage(
  messages: RawMessage[],
  candidate: RawMessage,
  candidateId?: string,
): boolean {
  if (candidateId && messages.some((message) => message.id === candidateId)) {
    return true;
  }

  const candidateText = getMessageText(candidate.content).trim();
  if (!candidateText) return false;

  const candidateTs = typeof candidate.timestamp === 'number' ? toMs(candidate.timestamp) : null;

  return messages.some((message) => {
    if (message.role !== 'assistant') return false;
    const existingText = getMessageText(message.content).trim();
    if (!existingText || existingText !== candidateText) return false;

    if (candidateTs == null || typeof message.timestamp !== 'number') {
      return true;
    }

    return Math.abs(toMs(message.timestamp) - candidateTs) < 5000;
  });
}

function getMessageAttachmentFingerprint(message: RawMessage): string {
  const attachments = (message._attachedFiles || [])
    .map((file) => file.filePath || file.url || file.fileName || '')
    .filter(Boolean)
    .sort();

  return attachments.join('|');
}

export function hasEquivalentUserMessage(
  messages: RawMessage[],
  candidate: RawMessage,
): boolean {
  if (candidate.role !== 'user') return false;

  const candidateText = getMessageText(candidate.content).trim();
  const candidateAttachments = getMessageAttachmentFingerprint(candidate);
  const candidateTs = candidate.timestamp ? toMs(candidate.timestamp) : null;
  const recentMessages = messages.slice(-3);

  return recentMessages.some((message) => {
    if (message.role !== 'user') return false;
    if (getMessageText(message.content).trim() !== candidateText) return false;
    if (getMessageAttachmentFingerprint(message) !== candidateAttachments) return false;

    if (candidateTs != null) {
      if (message.timestamp == null) return false;
      const messageTs = toMs(message.timestamp);
      return messageTs >= candidateTs - 2_000 && messageTs <= candidateTs + 10_000;
    }

    return true;
  });
}

export function stripRenderedPrefixFromStreamingText(
  fullText: string,
  streamSegments: Array<{ text: string; ts: number }>,
): string {
  if (!fullText || streamSegments.length === 0) {
    return fullText;
  }

  let matchedPrefix = '';
  for (let start = 0; start < streamSegments.length; start += 1) {
    const candidate = streamSegments
      .slice(start)
      .map((segment) => segment.text)
      .join('');
    if (!candidate) continue;
    if (fullText.startsWith(candidate) && candidate.length > matchedPrefix.length) {
      matchedPrefix = candidate;
    }
  }

  return matchedPrefix ? fullText.slice(matchedPrefix.length) : fullText;
}

export function toSessionPreview(text: string): string {
  const normalized = renderSkillMarkersAsPlainText(stripRuntimeChannelTags(cleanUserMessageText(text)))
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > 80 ? `${normalized.slice(0, 80)}…` : normalized;
}

function getMessagePreviewText(message: RawMessage): string {
  if (message.role === 'assistant') {
    const assistantPreview = extractAssistantVisibleText(message)?.trim();
    if (assistantPreview) {
      return assistantPreview;
    }
  }

  const contentText = getMessageText(message.content);
  if (contentText.trim()) {
    return contentText;
  }

  const messageRecord = message as unknown as Record<string, unknown>;
  return typeof messageRecord.text === 'string' ? messageRecord.text : '';
}

export function getLatestMessagePreview(messages: RawMessage[]): string {
  // Prefer the latest assistant answer. If we don't have one yet,
  // fall back to the latest user message so drafts still show context.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant' || isInternalMessage(message)) continue;
    const preview = toSessionPreview(getMessagePreviewText(message));
    if (preview) return preview;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user' || isInternalMessage(message)) continue;
    const preview = toSessionPreview(getMessagePreviewText(message));
    if (preview) return preview;
  }
  return '';
}

export function extractTextFromRuntimeMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const contentText = getMessageText(record.content);
  if (contentText.trim()) return contentText;
  return typeof record.text === 'string' ? record.text : '';
}

export function extractToolOutputText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return record.text;
  }

  const content = record.content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  const parts = content
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      return entry.type === 'text' && typeof entry.text === 'string' ? entry.text : null;
    })
    .filter((part): part is string => Boolean(part));

  if (parts.length > 0) {
    return parts.join('\n');
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function normalizeToolName(name: string | undefined): string {
  return (name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function extractExecCommand(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        input = parsed;
      } else {
        return trimmed;
      }
    } catch {
      return trimmed;
    }
  }

  if (!input || typeof input !== 'object') return undefined;

  const value = input as Record<string, unknown>;
  const candidates = [
    value.command,
    value.cmd,
    value.bash,
    value.script,
    value.shellCommand,
    value.shell_command,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function stripShellWrapper(command: string): string {
  const wrapped = command.match(/^\s*(?:\/bin\/)?(?:bash|sh|zsh|fish)\s+-[a-z]*c\s+(['"])([\s\S]*)\1\s*$/i);
  return wrapped?.[2]?.trim() || command.trim();
}

export function getBaseCommand(command: string): string {
  const trimmed = stripShellWrapper(command);
  const match = trimmed.match(/^\s*(\S+)/);
  if (!match) return '';
  const token = match[1].replace(/^['"]|['"]$/g, '');
  const base = token.split(/[\\/]/).pop() || token;
  return base.toLowerCase();
}

export function shouldExtractRawFilePathsForTool(toolName: string | undefined, toolInput: unknown): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (!EXEC_TOOL_NAMES.has(normalizedToolName)) return true;

  const command = extractExecCommand(toolInput);
  if (!command) return true;

  const normalizedCommand = stripShellWrapper(command);
  const baseCommand = getBaseCommand(normalizedCommand);
  if (RAW_PATH_SCAN_COMMANDS.has(baseCommand)) return false;
  if (baseCommand === 'git' && /\bgit\s+ls-files\b/i.test(normalizedCommand)) return false;
  return true;
}

export function getToolCallInput(message: unknown, toolCallId?: string, toolName?: string): unknown {
  if (!message || typeof message !== 'object') return undefined;
  const msg = message as Record<string, unknown>;

  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type !== 'tool_use' && block.type !== 'toolCall') continue;
      if (toolCallId && block.id === toolCallId) return block.input ?? block.arguments;
      if (!toolCallId && toolName && block.name === toolName) return block.input ?? block.arguments;
    }
  }

  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls as Array<Record<string, unknown>>) {
      const fn = (call.function ?? call) as Record<string, unknown>;
      if (toolCallId && call.id === toolCallId) return fn.arguments ?? fn.input;
      if (!toolCallId && toolName && fn.name === toolName) return fn.arguments ?? fn.input;
    }
  }

  return undefined;
}

export function findToolCallInputBeforeIndex(
  messages: RawMessage[],
  beforeIndex: number,
  toolCallId?: string,
  toolName?: string,
): unknown {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const input = getToolCallInput(messages[index], toolCallId, toolName);
    if (input !== undefined) return input;
  }
  return undefined;
}
