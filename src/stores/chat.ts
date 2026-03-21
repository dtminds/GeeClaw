/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import {
  cleanUserMessageText,
  renderSkillMarkersAsPlainText,
  sanitizeMessagesForDisplay,
  stripRuntimeChannelTags,
} from '@/lib/chat-message-text';
import type { CronAgentRunSummary } from '@/types/cron';
import { useAgentsStore } from './agents';
import { useGatewayStore } from './gateway';

// ── Types ────────────────────────────────────────────────────────

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
  exists?: boolean;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  senderLabel?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  api?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  stop_reason?: string;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    totalTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    promptTokens?: number;
    completionTokens?: number;
    cost?: {
      total?: number;
    };
  };
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
  /** Local-only: number of attachments omitted from display due to per-message cap */
  _hiddenAttachmentCount?: number;
  /** Local-only: merged tool execution states for assistant tool-use turns */
  _toolStatuses?: ToolStatus[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
  status?: string;
  error?: string;
  isError?: boolean;
  is_error?: boolean;
}

export interface DesktopSessionSummary {
  id: string;
  gatewaySessionKey: string;
  title: string;
  lastMessagePreview: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** Session from sessions.list, used by the raw Gateway viewer. */
export interface GatewaySessionSummary {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
}

export interface SessionTokenInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  totalTokensFresh?: boolean;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
  summary?: string;
  updatedAt: number;
  input?: unknown;
}

interface ToolStreamEntry {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  status: ToolStatus['status'];
  durationMs?: number;
  startedAt: number;
  updatedAt: number;
  message: RawMessage;
}

interface PendingComposerSeed {
  text: string;
  nonce: number;
}

type ChatViewMode = 'session' | 'cron';

type CronRunMessagesResponse = {
  messages?: RawMessage[];
};

interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingTextStartedAt: number | null;
  streamSegments: Array<{ text: string; ts: number }>;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  toolMessages: RawMessage[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];
  pendingToolHiddenCount: number;

  // Sessions
  desktopSessions: DesktopSessionSummary[];
  isDraftSession: boolean;
  currentDesktopSessionId: string;
  currentSessionKey: string;
  currentAgentId: string;
  currentViewMode: ChatViewMode;
  selectedCronRun: CronAgentRunSummary | null;
  sessionTokenInfoByKey: Record<string, SessionTokenInfo>;
  pendingComposerSeed: PendingComposerSeed | null;

  // Thinking
  showThinking: boolean;
  showToolCalls: boolean;
  thinkingLevel: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  openAgentMainSession: (agentId: string) => Promise<void>;
  switchSession: (key: string) => void;
  openCronRun: (run: CronAgentRunSummary) => Promise<void>;
  newSession: () => Promise<void>;
  newTemporarySession: (agentId?: string) => Promise<void>;
  deleteSession: (key: string) => Promise<void>;
  cleanupEmptySession: () => Promise<void>;
  loadHistory: (quiet?: boolean) => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
    targetAgentId?: string | null,
  ) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  handleAgentEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  toggleToolCalls: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  queueComposerSeed: (text: string) => void;
  consumePendingComposerSeed: () => void;
}

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where the current live text may be empty while
// tool cards are still streaming.
let _lastChatEventAt = 0;

/** Normalize a timestamp to milliseconds. Handles both seconds and ms. */
function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (before ~2033); >= 1e12 are milliseconds
  return ts < 1e12 ? ts * 1000 : ts;
}

// Timer for fallback history polling during active sends.
// If no streaming events arrive within a few seconds, we periodically
// poll chat.history to surface intermediate tool-call turns.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;

// Timer for delayed error finalization. When the Gateway reports a mid-stream
// error (e.g. "terminated"), it may retry internally and recover. We wait
// before committing the error to give the recovery path a chance.
let _errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

function createEmptyToolRuntimeState() {
  return {
    streamingText: '',
    streamingTextStartedAt: null,
    streamSegments: [] as Array<{ text: string; ts: number }>,
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [] as string[],
    toolMessages: [] as RawMessage[],
  };
}

function hasEquivalentFinalAssistantMessage(
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

function stripRenderedPrefixFromStreamingText(
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

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractSessionTokenInfo(session: Record<string, unknown>): SessionTokenInfo | null {
  const info: SessionTokenInfo = {
    inputTokens: asOptionalNumber(session.inputTokens),
    outputTokens: asOptionalNumber(session.outputTokens),
    totalTokens: asOptionalNumber(session.totalTokens),
    contextTokens: asOptionalNumber(session.contextTokens),
    totalTokensFresh: typeof session.totalTokensFresh === 'boolean' ? session.totalTokensFresh : undefined,
  };

  return Object.values(info).some((value) => value !== undefined) ? info : null;
}

async function fetchSessionTokenInfoByKey(): Promise<Record<string, SessionTokenInfo>> {
  const gatewayData = await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {});
  const rawGatewaySessions = Array.isArray(gatewayData.sessions) ? gatewayData.sessions : [];
  return Object.fromEntries(
    rawGatewaySessions.flatMap((session) => {
      const record = session as Record<string, unknown>;
      const key = typeof record.key === 'string' ? record.key : '';
      const tokenInfo = extractSessionTokenInfo(record);
      return key && tokenInfo ? [[key, tokenInfo]] : [];
    }),
  );
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

function buildCronRunSessionKey(run: Pick<CronAgentRunSummary, 'agentId' | 'jobId' | 'id' | 'sessionKey'>): string {
  return run.sessionKey || `agent:${run.agentId || 'main'}:cron:${run.jobId}:run:${run.id}`;
}

function isMainSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(':main');
}

function buildTemporarySessionKey(agentId: string): string {
  return `agent:${agentId}:geeclaw_tmp_${crypto.randomUUID()}`;
}

function clearErrorRecoveryTimer(): void {
  if (_errorRecoveryTimer) {
    clearTimeout(_errorRecoveryTimer);
    _errorRecoveryTimer = null;
  }
}

function clearHistoryPoll(): void {
  if (_historyPollTimer) {
    clearTimeout(_historyPollTimer);
    _historyPollTimer = null;
  }
}

// ── Local image cache ─────────────────────────────────────────
// The Gateway doesn't store image attachments in session content blocks,
// so we cache them locally keyed by staged file path (which appears in the
// [media attached: <path> ...] reference in the Gateway's user message text).
// Keying by path avoids the race condition of keying by runId (which is only
// available after the RPC returns, but history may load before that).
const IMAGE_CACHE_KEY = 'geeclaw:image-cache';
const IMAGE_CACHE_MAX = 100; // max entries to prevent unbounded growth
const MAX_MESSAGE_ATTACHMENTS = 9;
const DESKTOP_SESSIONS_API = '/api/desktop-sessions';

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch { /* ignore parse errors */ }
  return new Map();
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    // Evict oldest entries if over limit
    const entries = Array.from(cache.entries());
    const trimmed = entries.length > IMAGE_CACHE_MAX
      ? entries.slice(entries.length - IMAGE_CACHE_MAX)
      : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

const _imageCache = loadImageCache();

function limitAttachedFilesForMessage(
  files: AttachedFileMeta[],
  hiddenCount = 0,
): { files: AttachedFileMeta[]; hiddenCount: number } {
  if (files.length <= MAX_MESSAGE_ATTACHMENTS) {
    return { files, hiddenCount };
  }

  return {
    files: files.slice(0, MAX_MESSAGE_ATTACHMENTS),
    hiddenCount: hiddenCount + (files.length - MAX_MESSAGE_ATTACHMENTS),
  };
}

type DesktopSessionsListResponse = {
  sessions?: DesktopSessionSummary[];
};

type DesktopSessionResponse = {
  success: boolean;
  session?: DesktopSessionSummary;
  error?: string;
};

async function fetchDesktopSessions(): Promise<DesktopSessionSummary[]> {
  const response = await hostApiFetch<DesktopSessionsListResponse>(DESKTOP_SESSIONS_API);
  return Array.isArray(response.sessions) ? response.sessions : [];
}

async function createDesktopSessionRequest(title = '', gatewaySessionKey?: string): Promise<DesktopSessionSummary> {
  const response = await hostApiFetch<DesktopSessionResponse>(DESKTOP_SESSIONS_API, {
    method: 'POST',
    body: JSON.stringify({ title, gatewaySessionKey, lastMessagePreview: '' }),
  });
  if (!response.success || !response.session) {
    throw new Error(response.error || 'Failed to create desktop session');
  }
  return response.session;
}

async function updateDesktopSessionRequest(
  id: string,
  patch: { title?: string; updatedAt?: number; gatewaySessionKey?: string; lastMessagePreview?: string },
): Promise<DesktopSessionSummary> {
  const response = await hostApiFetch<DesktopSessionResponse>(
    `${DESKTOP_SESSIONS_API}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(patch),
    },
  );
  if (!response.success || !response.session) {
    throw new Error(response.error || `Failed to update desktop session: ${id}`);
  }
  return response.session;
}

function resolveMainSessionKeyForAgent(agentId?: string | null): string | null {
  if (!agentId) return null;
  const agent = useAgentsStore.getState().agents.find((entry) => entry.id === agentId);
  return agent?.mainSessionKey ?? `agent:${agentId}:main`;
}

async function deleteDesktopSessionRequest(id: string): Promise<DesktopSessionSummary> {
  const response = await hostApiFetch<DesktopSessionResponse>(
    `${DESKTOP_SESSIONS_API}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.success || !response.session) {
    throw new Error(response.error || `Failed to delete desktop session: ${id}`);
  }
  return response.session;
}

/** Extract plain text from message content (string or content blocks) */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }
  return '';
}

function toSessionPreview(text: string): string {
  const normalized = renderSkillMarkersAsPlainText(stripRuntimeChannelTags(cleanUserMessageText(text)))
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > 80 ? `${normalized.slice(0, 80)}…` : normalized;
}

function getMessagePreviewText(message: RawMessage): string {
  const contentText = getMessageText(message.content);
  if (contentText.trim()) {
    return contentText;
  }

  const messageRecord = message as unknown as Record<string, unknown>;
  return typeof messageRecord.text === 'string' ? messageRecord.text : '';
}

function getLatestMessagePreview(messages: RawMessage[]): string {
  // Prefer the latest assistant answer. If we don't have one yet,
  // fall back to the latest user message so drafts still show context.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    const preview = toSessionPreview(getMessagePreviewText(message));
    if (preview) return preview;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    const preview = toSessionPreview(getMessagePreviewText(message));
    if (preview) return preview;
  }
  return '';
}

function extractTextFromRuntimeMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const contentText = getMessageText(record.content);
  if (contentText.trim()) return contentText;
  return typeof record.text === 'string' ? record.text : '';
}

function extractToolOutputText(value: unknown): string | null {
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

function buildToolStreamMessage(entry: ToolStreamEntry): RawMessage {
  const content: ContentBlock[] = [
    {
      type: 'toolCall',
      id: entry.toolCallId,
      name: entry.name,
      arguments: entry.args ?? {},
    },
  ];

  if (entry.output) {
    content.push({
      type: 'toolResult',
      id: entry.toolCallId,
      name: entry.name,
      text: entry.output,
      status: entry.status,
      isError: entry.status === 'error',
    });
  }

  return {
    role: 'assistant',
    id: `live-tool:${entry.toolCallId}`,
    toolCallId: entry.toolCallId,
    toolName: entry.name,
    timestamp: entry.startedAt,
    content,
    _toolStatuses: [
      {
        id: entry.toolCallId,
        toolCallId: entry.toolCallId,
        name: entry.name,
        status: entry.status,
        durationMs: entry.durationMs,
        result: entry.output,
        updatedAt: entry.updatedAt,
        input: entry.args,
      },
    ],
  };
}

function syncToolMessages(
  toolStreamOrder: string[],
  toolStreamById: Map<string, ToolStreamEntry>,
): RawMessage[] {
  return toolStreamOrder
    .map((id) => toolStreamById.get(id)?.message)
    .filter((message): message is RawMessage => Boolean(message));
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

const EXEC_TOOL_NAMES = new Set(['exec', 'bash', 'shell', 'run_command', 'command']);
const RAW_PATH_SCAN_COMMANDS = new Set(['ls', 'find', 'tree', 'fd', 'rg', 'grep', 'ag', 'locate', 'which', 'where']);

function normalizeToolName(name: string | undefined): string {
  return (name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function extractExecCommand(input: unknown): string | undefined {
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

function getBaseCommand(command: string): string {
  const trimmed = stripShellWrapper(command);
  const match = trimmed.match(/^\s*(\S+)/);
  if (!match) return '';
  const token = match[1].replace(/^['"]|['"]$/g, '');
  const base = token.split(/[\\/]/).pop() || token;
  return base.toLowerCase();
}

function shouldExtractRawFilePathsForTool(toolName: string | undefined, toolInput: unknown): boolean {
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

function getToolCallInput(message: unknown, toolCallId?: string, toolName?: string): unknown {
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

function findToolCallInputBeforeIndex(
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

/** Map common file extensions to MIME types */
function mimeFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
    'svg': 'image/svg+xml',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'md': 'text/markdown',
    'rtf': 'application/rtf',
    'epub': 'application/epub+zip',
    // Archives
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    // Video
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'm4v': 'video/mp4',
    // HTML
    'htm': 'text/html',
    'html': 'text/html',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, consistent with channel push message behavior.
 */
function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts = 'htm?l|png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Unix absolute paths (/... or ~/...) — lookbehind rejects mid-token slashes
  // (e.g. "path/to/file.mp4", "https://example.com/file.mp4")
  const unixRegex = new RegExp(`(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  // Windows absolute paths (C:\... D:\...) — lookbehind rejects drive letter glued to a word
  const winRegex = new RegExp(`(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  for (const regex of [unixRegex, winRegex]) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const p = match[1];
      if (p && !seen.has(p)) {
        seen.add(p);
        refs.push({ filePath: p, mimeType: mimeFromExtension(p) });
      }
    }
  }
  return refs;
}

/**
 * Extract images from a content array (including nested tool_result content).
 * Converts them to AttachedFileMeta entries with preview set to data URL or remote URL.
 */
function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  if (!Array.isArray(content)) return [];
  const files: AttachedFileMeta[] = [];

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format {source: {type, media_type, data}}
      if (block.source) {
        const src = block.source;
        const mimeType = src.media_type || 'image/jpeg';

        if (src.type === 'base64' && src.data) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: `data:${mimeType};base64,${src.data}`,
          });
        } else if (src.type === 'url' && src.url) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: src.url,
          });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        const mimeType = block.mimeType || 'image/jpeg';
        files.push({
          fileName: 'image',
          mimeType,
          fileSize: 0,
          preview: `data:${mimeType};base64,${block.data}`,
        });
      }
    }
    // Recurse into tool_result content blocks
    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      files.push(...extractImagesAsAttachedFiles(block.content));
    }
  }
  return files;
}

/**
 * Build an AttachedFileMeta entry for a file ref, using cache if available.
 */
function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const cached = _imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath, exists: cached.exists ?? true };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
}

/**
 * Before filtering tool_result messages from history, scan them for any file/image
 * content and attach those to the immediately following assistant message.
 * This mirrors channel push message behavior where tool outputs surface files to the UI.
 * Handles:
 *   - Image content blocks (base64 / url)
 *   - [media attached: path (mime) | path] text patterns in tool result output
 *   - Raw file paths in tool result text
 */
function enrichWithToolResultFiles(messages: RawMessage[]): RawMessage[] {
  const next = [...messages];
  const pending: AttachedFileMeta[] = [];

  for (let index = 0; index < next.length; index += 1) {
    const msg = next[index];
    if (!msg) continue;

    if (msg.role === 'assistant') {
      const inlineToolUpdates = collectToolUpdates(msg, 'final');
      if (inlineToolUpdates.length > 0) {
        next[index] = {
          ...msg,
          _toolStatuses: upsertToolStatuses(msg._toolStatuses || [], inlineToolUpdates),
        };
      }
    }

    if (isToolResultRole(msg.role)) {
      // 1. Image/file content blocks in the structured content array
      const imageFiles = extractImagesAsAttachedFiles(msg.content);
      pending.push(...imageFiles);

      // 2. [media attached: ...] patterns in tool result text output
      const text = getMessageText(msg.content);
      if (text && !isErroredToolResult(msg)) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
        for (const ref of mediaRefs) {
          pending.push(makeAttachedFile(ref));
        }
        // 3. Raw file paths in tool result text (documents, audio, video, etc.)
        const toolName = typeof msg.toolName === 'string' ? msg.toolName : undefined;
        const toolInput = findToolCallInputBeforeIndex(next, index, msg.toolCallId, toolName);
        if (shouldExtractRawFilePathsForTool(toolName, toolInput)) {
          for (const ref of extractRawFilePaths(text)) {
            if (!mediaRefPaths.has(ref.filePath)) {
              pending.push(makeAttachedFile(ref));
            }
          }
        }
      }

      const updates = collectToolUpdates(msg, 'final');
      for (const update of updates) {
        const targetIndex = findPreviousAssistantToolMessageIndex(next, index, update);
        if (targetIndex === -1) continue;
        const target = next[targetIndex];
        next[targetIndex] = {
          ...target,
          _toolStatuses: upsertToolStatuses(target._toolStatuses || [], [update]),
        };
      }

      continue;
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      const toAttach = pending.splice(0);
      // Deduplicate against files already on the assistant message
      const existingPaths = new Set(
        (msg._attachedFiles || []).map(f => f.filePath).filter(Boolean),
      );
      const newFiles = toAttach.filter(f => !f.filePath || !existingPaths.has(f.filePath));
      if (newFiles.length === 0) {
        continue;
      }
      const limited = limitAttachedFilesForMessage(
        [...(msg._attachedFiles || []), ...newFiles],
        msg._hiddenAttachmentCount || 0,
      );
      next[index] = {
        ...msg,
        _attachedFiles: limited.files,
        _hiddenAttachmentCount: limited.hiddenCount || undefined,
      };
      continue;
    }
  }

  return next;
}

/**
 * Restore _attachedFiles for messages loaded from history.
 * Handles:
 *   1. [media attached: path (mime) | path] patterns (attachment-button flow)
 *   2. Raw image file paths typed in message text (e.g. /Users/.../image.png)
 * Uses local cache for previews when available; missing previews are loaded async.
 */
function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg, idx) => {
    // Only process user and assistant messages; skip if already enriched
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    // Path 1: [media attached: path (mime) | path] — guaranteed format from attachment button
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    // Tool-only messages (thinking + tool calls) should not show file previews — those
    // belong to the final answer message that comes after the tool results.
    // User messages never get raw-path previews so the image is not shown twice.
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter(r => !mediaRefPaths.has(r.filePath));

      // Nearest preceding user message text (look back up to 5 messages)
      const seenPaths = new Set(rawRefs.map(r => r.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = getMessageText(prev.content);
          for (const ref of extractRawFilePaths(prevText)) {
            if (!mediaRefPaths.has(ref.filePath) && !seenPaths.has(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break; // only use the nearest user message
        }
      }
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    if (allRefs.length === 0) return msg;

    const files: AttachedFileMeta[] = allRefs.map(ref => {
      const cached = _imageCache.get(ref.filePath);
      if (cached) return { ...cached, filePath: ref.filePath, exists: cached.exists ?? true };
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
    });
    const limited = limitAttachedFilesForMessage(files, msg._hiddenAttachmentCount || 0);
    return {
      ...msg,
      _attachedFiles: limited.files,
      _hiddenAttachmentCount: limited.hiddenCount || undefined,
    };
  });
}

export function prepareHistoryMessagesForDisplay(rawMessages: RawMessage[]): RawMessage[] {
  const sanitizedMessages = sanitizeMessagesForDisplay(rawMessages);
  const messagesWithToolImages = enrichWithToolResultFiles(sanitizedMessages);
  const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role));
  return enrichWithCachedImages(filteredMessages);
}

export async function hydrateHistoryMessagesForDisplay(rawMessages: RawMessage[]): Promise<RawMessage[]> {
  const messages = prepareHistoryMessagesForDisplay(rawMessages);
  const updated = await loadMissingPreviews(messages);
  if (!updated) return messages;

  return messages.map((msg) =>
    msg._attachedFiles
      ? { ...msg, _attachedFiles: msg._attachedFiles.map((file) => ({ ...file })) }
      : msg,
  );
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 * Handles both [media attached: ...] patterns and raw filePath entries.
 */
async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  // Collect all image paths that need previews
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  const seenPaths = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Path 1: files with explicit filePath field (raw path detection or enriched refs)
    for (const file of msg._attachedFiles) {
      const fp = file.filePath;
      if (!fp || seenPaths.has(fp)) continue;
      // Validate existence for extracted file paths before showing them.
      // Images also need previews; non-images need file size for FileCard display.
      const needsLoad = file.exists !== true
        || (file.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0);
      if (needsLoad) {
        seenPaths.add(fp);
        needPreview.push({ filePath: fp, mimeType: file.mimeType });
      }
    }

    // Path 2: [media attached: ...] patterns (legacy — in case filePath wasn't stored)
    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || seenPaths.has(ref.filePath)) continue;
        const needsLoad = file.exists !== true
          || (ref.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0);
        if (needsLoad) {
          seenPaths.add(ref.filePath);
          needPreview.push(ref);
        }
      }
    }
  }

  if (needPreview.length === 0) return false;

  try {
    const thumbnails = await hostApiFetch<Record<string, { exists: boolean; preview: string | null; fileSize: number }>>(
      '/api/files/thumbnails',
      {
        method: 'POST',
        body: JSON.stringify({ paths: needPreview }),
      },
    );

    let updated = false;
    for (const msg of messages) {
      if (!msg._attachedFiles) continue;

      // Update files that have filePath
      for (const file of msg._attachedFiles) {
        const fp = file.filePath;
        if (!fp) continue;
        const thumb = thumbnails[fp];
        if (!thumb) continue;

        file.exists = thumb.exists;
        if (thumb.exists) {
          if (thumb.preview) file.preview = thumb.preview;
          file.fileSize = thumb.fileSize;
          _imageCache.set(fp, { ...file, exists: true });
          updated = true;
        } else {
          updated = true;
        }
      }

      const validFiles = msg._attachedFiles.filter((file) => file.exists !== false);
      if (validFiles.length !== msg._attachedFiles.length) {
        msg._attachedFiles = validFiles;
        updated = true;
      }

      // Legacy: update by index for [media attached: ...] refs
      if (msg.role === 'user') {
        const text = getMessageText(msg.content);
        const refs = extractMediaRefs(text);
        for (let i = 0; i < refs.length; i++) {
          const file = msg._attachedFiles[i];
          const ref = refs[i];
          if (!file || !ref || file.filePath) continue; // skip if already handled via filePath
          const thumb = thumbnails[ref.filePath];
          if (!thumb) continue;
          file.exists = thumb.exists;
          if (thumb.exists) {
            if (thumb.preview) file.preview = thumb.preview;
            file.fileSize = thumb.fileSize;
            _imageCache.set(ref.filePath, { ...file, exists: true });
            updated = true;
          } else {
            updated = true;
          }
        }

        const validFiles = msg._attachedFiles.filter((file) => file.exists !== false);
        if (validFiles.length !== msg._attachedFiles.length) {
          msg._attachedFiles = validFiles;
          updated = true;
        }
      }
    }
    if (updated) saveImageCache(_imageCache);
    return updated;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return false;
  }
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' || block.type === 'tool_result' || block.type === 'toolCall' || block.type === 'toolResult') {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    // Only actual image output disqualifies a tool-only message.
    // Thinking blocks are internal reasoning that can accompany tool_use — they
    // should NOT prevent the message from being treated as an intermediate tool step.
    if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function isErroredToolResult(message: RawMessage | undefined): boolean {
  if (!message || !isToolResultRole(message.role)) return false;

  if (message.isError) return true;

  const msg = message as unknown as Record<string, unknown>;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const status = typeof (msg.status ?? details?.status) === 'string'
    ? String(msg.status ?? details?.status).toLowerCase()
    : '';
  if (status === 'error' || status === 'failed') return true;

  return typeof (msg.error ?? details?.error) === 'string' && String(msg.error ?? details?.error).trim().length > 0;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function assistantMessageHasAnyTool(message: RawMessage): boolean {
  const msg = message as unknown as Record<string, unknown>;
  const content = msg.content;

  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'tool_use' || block.type === 'toolCall') {
        return true;
      }
    }
  }

  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

function assistantMessageHasMatchingTool(message: RawMessage, update: ToolStatus): boolean {
  const msg = message as unknown as Record<string, unknown>;
  const content = msg.content;

  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      if (update.toolCallId && block.id === update.toolCallId) return true;
      if (update.id && block.id === update.id) return true;
      if (block.name === update.name) return true;
    }
  }

  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      const name = typeof fn.name === 'string' ? fn.name : '';
      const id = typeof tc.id === 'string' ? tc.id : '';
      if (update.toolCallId && id === update.toolCallId) return true;
      if (update.id && id === update.id) return true;
      if (name && name === update.name) return true;
    }
  }

  for (const status of message._toolStatuses || []) {
    if (update.toolCallId && status.toolCallId === update.toolCallId) return true;
    if (update.id && status.id === update.id) return true;
    if (status.name === update.name) return true;
  }

  return false;
}

function findPreviousAssistantToolMessageIndex(messages: RawMessage[], beforeIndex: number, update: ToolStatus): number {
  let fallbackIndex = -1;

  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if (assistantMessageHasMatchingTool(message, update)) return index;
    if (fallbackIndex === -1 && assistantMessageHasAnyTool(message)) {
      fallbackIndex = index;
    }
  }

  return fallbackIndex;
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed'): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

function looksLikeToolErrorText(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(error|failed?|exception|traceback|invalid|denied|unauthorized|forbidden|not found|错误|失败|异常|未找到|无权限|拒绝访问)\b/i.test(trimmed);
}

function getToolResultBlockStatus(block: ContentBlock, eventState: string): ToolStatus['status'] {
  if (block.isError || block.is_error) return 'error';
  if (typeof block.error === 'string' && block.error.trim()) return 'error';
  const outputText = extractTextFromContent(block.content ?? block.text ?? '');
  if (looksLikeToolErrorText(outputText)) return 'error';
  return normalizeToolStatus(block.status, eventState === 'delta' ? 'running' : 'completed');
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  // Path 1: Anthropic/normalized format — tool blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
        input: block.input ?? block.arguments,
      });
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof tc.id === 'string' ? tc.id : name;
        updates.push({
          id,
          toolCallId: typeof tc.id === 'string' ? tc.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
          input: fn.arguments ?? fn.input,
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      status: getToolResultBlockStatus(block, eventState),
      result: outputText.trim() || block.error?.trim() || undefined,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName = typeof msg.toolName === 'string' ? msg.toolName : (typeof msg.name === 'string' ? msg.name : '');
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const rawStatus = (msg.status ?? details?.status);
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs);

  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const result = outputText.trim() || String(details?.error ?? msg.error ?? '').trim() || undefined;
  const inferredStatus = looksLikeToolErrorText(result) ? 'error' : undefined;

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status: inferredStatus ?? status,
    durationMs,
    result,
    updatedAt: Date.now(),
  };
}

function mergeToolStatus(existing: ToolStatus['status'], incoming: ToolStatus['status']): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, completed: 1, error: 2 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergeToolStatus(existing.status, update.status),
      durationMs: update.durationMs ?? existing.durationMs,
      result: update.result ?? existing.result,
      updatedAt: update.updatedAt || existing.updatedAt,
      input: update.input ?? existing.input,
    };
  }
  return next;
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  updates.push(...extractToolResultBlocks(message, eventState));
  updates.push(...extractToolUseUpdates(message));
  return updates;
}

function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingTextStartedAt: null,
  streamSegments: [],
  toolStreamById: new Map<string, ToolStreamEntry>(),
  toolStreamOrder: [],
  toolMessages: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],
  pendingToolHiddenCount: 0,

  desktopSessions: [],
  isDraftSession: false,
  currentDesktopSessionId: '',
  currentSessionKey: '',
  currentAgentId: 'main',
  currentViewMode: 'session',
  selectedCronRun: null,
  sessionTokenInfoByKey: {},
  pendingComposerSeed: null,

  showThinking: false,
  showToolCalls: true,
  thinkingLevel: null,

  // ── Load desktop sessions ──

  loadSessions: async () => {
    try {
      const previousGatewayKey = get().currentSessionKey;
      const previousDesktopSessionId = get().currentDesktopSessionId;
      const previousIsDraft = get().isDraftSession;
      let desktopSessions = await fetchDesktopSessions();
      let sessionTokenInfoByKey = get().sessionTokenInfoByKey;
      try {
        sessionTokenInfoByKey = await fetchSessionTokenInfoByKey();
      } catch (gatewayError) {
        console.warn('Failed to load gateway session token info:', gatewayError);
      }
      const defaultAgentId = useAgentsStore.getState().defaultAgentId || 'main';
      const preferredAgentId = get().currentAgentId || defaultAgentId;
      const preferredMainSessionKey = resolveMainSessionKeyForAgent(preferredAgentId) || `agent:${preferredAgentId}:main`;

      const previousSession = previousIsDraft
        ? undefined
        : desktopSessions.find((session) => session.id === previousDesktopSessionId);

      let activeSession = previousIsDraft
        ? undefined
        : (
          previousSession
          ?? desktopSessions.find((session) => session.gatewaySessionKey === preferredMainSessionKey)
          ?? desktopSessions.find((session) => isMainSessionKey(session.gatewaySessionKey))
          ?? desktopSessions[0]
        );

      if (!activeSession && !previousIsDraft) {
        try {
          const createdMainSession = await createDesktopSessionRequest('', preferredMainSessionKey);
          desktopSessions = [createdMainSession, ...desktopSessions];
          activeSession = createdMainSession;
        } catch (createError) {
          console.warn(`Failed to create default main session for agent ${preferredAgentId}:`, createError);
        }
      }

      set({
        desktopSessions,
        isDraftSession: previousIsDraft || !activeSession,
        currentDesktopSessionId: activeSession?.id ?? '',
        currentSessionKey: activeSession?.gatewaySessionKey ?? '',
        currentAgentId: activeSession?.gatewaySessionKey ? getAgentIdFromSessionKey(activeSession.gatewaySessionKey) : 'main',
        currentViewMode: 'session',
        selectedCronRun: null,
        sessionTokenInfoByKey,
      });

      if (activeSession?.gatewaySessionKey && activeSession.gatewaySessionKey !== previousGatewayKey) {
        get().loadHistory();
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    }
  },

  // ── Open agent main session ──

  openAgentMainSession: async (agentId: string) => {
    const normalizedAgentId = agentId || 'main';
    const mainSessionKey = resolveMainSessionKeyForAgent(normalizedAgentId) || `agent:${normalizedAgentId}:main`;
    const existingMainSession = get().desktopSessions.find((session) => session.gatewaySessionKey === mainSessionKey);

    if (existingMainSession) {
      set({
        isDraftSession: false,
        currentDesktopSessionId: existingMainSession.id,
        currentSessionKey: existingMainSession.gatewaySessionKey,
        currentAgentId: normalizedAgentId,
        currentViewMode: 'session',
        selectedCronRun: null,
        messages: [],
        ...createEmptyToolRuntimeState(),
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        pendingToolHiddenCount: 0,
      });
      await get().loadHistory(true);
      return;
    }

    try {
      const createdMainSession = await createDesktopSessionRequest('', mainSessionKey);
      set((state) => ({
        desktopSessions: [createdMainSession, ...state.desktopSessions],
        isDraftSession: false,
        currentDesktopSessionId: createdMainSession.id,
        currentSessionKey: createdMainSession.gatewaySessionKey,
        currentAgentId: normalizedAgentId,
        currentViewMode: 'session',
        selectedCronRun: null,
        messages: [],
        ...createEmptyToolRuntimeState(),
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        pendingToolHiddenCount: 0,
      }));
      await get().loadHistory(true);
    } catch (createError) {
      console.warn(`Failed to create main session for agent ${normalizedAgentId}:`, createError);
    }
  },

  // ── Switch session ──

  switchSession: (desktopSessionId: string) => {
    const target = get().desktopSessions.find((session) => session.id === desktopSessionId);
    if (!target) return;
    set({
      isDraftSession: false,
      currentDesktopSessionId: target.id,
      currentSessionKey: target.gatewaySessionKey,
      currentAgentId: getAgentIdFromSessionKey(target.gatewaySessionKey),
      currentViewMode: 'session',
      selectedCronRun: null,
      messages: [],
      ...createEmptyToolRuntimeState(),
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      pendingToolHiddenCount: 0,
    });
    get().loadHistory();
  },

  openCronRun: async (run: CronAgentRunSummary) => {
    const nextSessionKey = buildCronRunSessionKey(run);
    set({
      isDraftSession: false,
      currentDesktopSessionId: '',
      currentSessionKey: nextSessionKey,
      currentAgentId: run.agentId || get().currentAgentId || 'main',
      currentViewMode: 'cron',
      selectedCronRun: run,
      messages: [],
      ...createEmptyToolRuntimeState(),
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      pendingToolHiddenCount: 0,
      thinkingLevel: null,
    });
    await get().loadHistory();
  },

  // ── Delete desktop session ──

  deleteSession: async (desktopSessionId: string) => {
    try {
      await deleteDesktopSessionRequest(desktopSessionId);
    } catch (err) {
      console.warn(`[deleteSession] Failed for ${desktopSessionId}:`, err);
    }

    const { currentAgentId, currentDesktopSessionId, desktopSessions } = get();
    let remaining = desktopSessions.filter((session) => session.id !== desktopSessionId);

    if (remaining.length === 0) {
      try {
        const fallbackAgentId = get().currentAgentId || useAgentsStore.getState().defaultAgentId || 'main';
        const fallbackMainKey = resolveMainSessionKeyForAgent(fallbackAgentId) || `agent:${fallbackAgentId}:main`;
        remaining = [await createDesktopSessionRequest('', fallbackMainKey)];
      } catch (error) {
        console.warn('Failed to create replacement desktop session:', error);
      }
    }

    const preferredAgentId = currentAgentId || useAgentsStore.getState().defaultAgentId || 'main';
    const preferredMainSessionKey = resolveMainSessionKeyForAgent(preferredAgentId) || `agent:${preferredAgentId}:main`;
    const sameAgentRemaining = remaining.filter(
      (session) => getAgentIdFromSessionKey(session.gatewaySessionKey) === preferredAgentId,
    );
    const next = remaining.find((session) => session.id === currentDesktopSessionId)
      ?? sameAgentRemaining.find((session) => session.gatewaySessionKey === preferredMainSessionKey)
      ?? sameAgentRemaining[0]
      ?? remaining[0];

    set({
      desktopSessions: remaining,
      isDraftSession: !next,
      currentDesktopSessionId: next?.id ?? '',
      currentSessionKey: next?.gatewaySessionKey ?? '',
      currentAgentId: next?.gatewaySessionKey ? getAgentIdFromSessionKey(next.gatewaySessionKey) : 'main',
      currentViewMode: 'session',
      selectedCronRun: null,
      messages: currentDesktopSessionId === desktopSessionId ? [] : get().messages,
      ...createEmptyToolRuntimeState(),
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      pendingToolHiddenCount: 0,
    });

    if (currentDesktopSessionId === desktopSessionId && next?.gatewaySessionKey) {
      await get().loadHistory();
    }
  },

  // ── New session ──

  newSession: async () => {
    await get().newTemporarySession(get().currentAgentId || 'main');
  },

  // ── New temporary session ──

  newTemporarySession: async (agentId?: string) => {
    set({
      isDraftSession: true,
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: agentId || get().currentAgentId || 'main',
      currentViewMode: 'session',
      selectedCronRun: null,
      messages: [],
      ...createEmptyToolRuntimeState(),
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      pendingToolHiddenCount: 0,
    });
  },

  // ── Cleanup empty session on navigate away ──

  cleanupEmptySession: async () => {
    const { currentDesktopSessionId, messages } = get();
    if (!currentDesktopSessionId || messages.length > 0) return;
    if (get().desktopSessions.length <= 1) return;
    await get().deleteSession(currentDesktopSessionId);
  },

  // ── Load chat history ──

  loadHistory: async (quiet = false) => {
    const { currentSessionKey, currentDesktopSessionId, currentViewMode, selectedCronRun } = get();
    if (!currentSessionKey) {
      if (!quiet) set({ loading: false });
      return;
    }
    if (!quiet) set({ loading: true, error: null });

    if (currentViewMode === 'cron' && selectedCronRun) {
      try {
        let rawMessages: RawMessage[] = [];

        if (selectedCronRun.sessionKey) {
          try {
            const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
              'chat.history',
              { sessionKey: selectedCronRun.sessionKey, limit: 200 },
            );
            rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
          } catch (gatewayError) {
            console.warn('Failed to load cron run history from gateway, falling back:', gatewayError);
          }
        }

        if (rawMessages.length === 0) {
          const data = await hostApiFetch<CronRunMessagesResponse>(
            `/api/cron/jobs/${encodeURIComponent(selectedCronRun.jobId)}/messages?runId=${encodeURIComponent(selectedCronRun.id)}&limit=200`,
          );
          rawMessages = Array.isArray(data.messages) ? data.messages : [];
        }

        const displayMessages = await hydrateHistoryMessagesForDisplay(rawMessages);
        set({
          messages: displayMessages,
          thinkingLevel: null,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.warn('Failed to load cron run history:', err);
        set({ messages: [], loading: false, error: String(err) });
      }
      return;
    }

    try {
      const [data, tokenInfoResult] = await Promise.all([
        useGatewayStore.getState().rpc<Record<string, unknown>>(
          'chat.history',
          { sessionKey: currentSessionKey, limit: 200 },
        ),
        fetchSessionTokenInfoByKey()
          .then((sessionTokenInfoByKey) => ({ success: true as const, sessionTokenInfoByKey }))
          .catch((error) => ({ success: false as const, error })),
      ]);
      if (data) {
        const rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];

        // Before filtering: attach images/files from tool_result messages to the next assistant message
          const filteredMessages = prepareHistoryMessagesForDisplay(rawMessages);
          const enrichedMessages = filteredMessages;
        const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
        const nextSessionTokenInfoByKey = tokenInfoResult.success
          ? tokenInfoResult.sessionTokenInfoByKey
          : get().sessionTokenInfoByKey;
        if (!tokenInfoResult.success) {
          console.warn('Failed to refresh gateway session token info during history load:', tokenInfoResult.error);
        }

        // Preserve the optimistic user message during an active send.
        // The Gateway may not include the user's message in chat.history
        // until the run completes, causing it to flash out of the UI.
        let finalMessages = enrichedMessages;
        const userMsgAt = get().lastUserMessageAt;
        if (get().sending && userMsgAt) {
          const userMsMs = toMs(userMsgAt);
          const hasRecentUser = enrichedMessages.some(
            (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
          );
          if (!hasRecentUser) {
            const currentMsgs = get().messages;
            const optimistic = [...currentMsgs].reverse().find(
              (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
            );
            if (optimistic) {
              finalMessages = [...enrichedMessages, optimistic];
            }
          }
        }

        const previewsLoaded = await loadMissingPreviews(finalMessages);
        const displayMessages = previewsLoaded
          ? finalMessages.map(msg =>
              msg._attachedFiles
                ? { ...msg, _attachedFiles: msg._attachedFiles.map(f => ({ ...f })) }
                : msg
            )
          : finalMessages;

        set({ messages: displayMessages, thinkingLevel, loading: false, sessionTokenInfoByKey: nextSessionTokenInfoByKey });

        const currentDesktopSession = get().desktopSessions.find((session) => session.id === currentDesktopSessionId);
        let nextTitle = currentDesktopSession?.title ?? '';
        const nextLastMessagePreview = getLatestMessagePreview(displayMessages);
        const firstUserMsg = displayMessages.find((m) => m.role === 'user');
        if (firstUserMsg && !nextTitle.trim()) {
          const labelText = renderSkillMarkersAsPlainText(cleanUserMessageText(getMessageText(firstUserMsg.content)));
          if (labelText) {
            nextTitle = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
          }
        }

        const lastMsg = displayMessages[displayMessages.length - 1];
        const lastAt = lastMsg?.timestamp ? toMs(lastMsg.timestamp) : undefined;
        if (currentDesktopSessionId && currentDesktopSession) {
          const needsTitleUpdate = nextTitle !== currentDesktopSession.title;
          const needsPreviewUpdate = nextLastMessagePreview !== currentDesktopSession.lastMessagePreview;
          const needsUpdatedAt = typeof lastAt === 'number' && lastAt !== currentDesktopSession.updatedAt;
          if (needsTitleUpdate || needsPreviewUpdate || needsUpdatedAt) {
            set((s) => ({
              desktopSessions: s.desktopSessions.map((session) => (
                session.id === currentDesktopSessionId
                  ? {
                      ...session,
                      title: nextTitle,
                      lastMessagePreview: nextLastMessagePreview,
                      updatedAt: typeof lastAt === 'number' ? lastAt : session.updatedAt,
                    }
                  : session
              )),
            }));

            void updateDesktopSessionRequest(currentDesktopSessionId, {
              ...(needsTitleUpdate ? { title: nextTitle } : {}),
              ...(needsPreviewUpdate ? { lastMessagePreview: nextLastMessagePreview } : {}),
              ...(needsUpdatedAt && typeof lastAt === 'number' ? { updatedAt: lastAt } : {}),
            }).catch((error) => {
              console.warn(`Failed to sync desktop session ${currentDesktopSessionId}:`, error);
            });
          }
        }

        const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();

        // If we're sending but haven't received streaming events, check
        // whether the loaded history reveals intermediate tool-call activity.
        // This surfaces progress via the pendingFinal → ActivityIndicator path.
        const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
        const isAfterUserMsg = (msg: RawMessage): boolean => {
          if (!userMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= userMsTs;
        };

        if (isSendingNow && !pendingFinal) {
          const hasRecentAssistantActivity = [...filteredMessages].reverse().some((msg) => {
            if (msg.role !== 'assistant') return false;
            return isAfterUserMsg(msg);
          });
          if (hasRecentAssistantActivity) {
            set({ pendingFinal: true });
          }
        }

        // If pendingFinal, check whether the AI produced a final text response.
        if (pendingFinal || get().pendingFinal) {
          const recentAssistant = [...filteredMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (!hasNonToolAssistantContent(msg)) return false;
            return isAfterUserMsg(msg);
          });
          if (recentAssistant) {
            clearHistoryPoll();
            set({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              ...createEmptyToolRuntimeState(),
            });
          }
        }
      } else {
        set({ messages: [], loading: false });
      }
    } catch (err) {
      console.warn('Failed to load chat history:', err);
      set({ messages: [], loading: false });
    }
  },

  // ── Send message ──

  sendMessage: async (
    text: string,
    attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
    targetAgentId?: string | null,
  ) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    let {
      currentSessionKey,
      currentDesktopSessionId,
      isDraftSession,
      desktopSessions: existingDesktopSessions,
      currentViewMode,
    } = get();

    const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId);
    if (targetSessionKey && targetSessionKey !== currentSessionKey) {
      const existingTargetSession = existingDesktopSessions.find((session) => session.gatewaySessionKey === targetSessionKey);

      if (existingTargetSession) {
        set({
          isDraftSession: false,
          currentDesktopSessionId: existingTargetSession.id,
          currentSessionKey: existingTargetSession.gatewaySessionKey,
          currentAgentId: getAgentIdFromSessionKey(existingTargetSession.gatewaySessionKey),
          currentViewMode: 'session',
          selectedCronRun: null,
          messages: [],
          ...createEmptyToolRuntimeState(),
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          pendingToolHiddenCount: 0,
        });
        currentSessionKey = existingTargetSession.gatewaySessionKey;
        currentDesktopSessionId = existingTargetSession.id;
        isDraftSession = false;
        await get().loadHistory(true);
      } else {
        const targetAgent = useAgentsStore.getState().agents.find((agent) => agent.id === targetAgentId);
        const createdTargetSession = await createDesktopSessionRequest(
          targetAgent ? `@${targetAgent.name}` : '',
          targetSessionKey,
        );
        set((state) => ({
          desktopSessions: [createdTargetSession, ...state.desktopSessions],
          isDraftSession: false,
          currentDesktopSessionId: createdTargetSession.id,
          currentSessionKey: createdTargetSession.gatewaySessionKey,
          currentAgentId: getAgentIdFromSessionKey(createdTargetSession.gatewaySessionKey),
          currentViewMode: 'session',
          selectedCronRun: null,
          messages: [],
          ...createEmptyToolRuntimeState(),
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          pendingToolHiddenCount: 0,
        }));
        currentSessionKey = createdTargetSession.gatewaySessionKey;
        currentDesktopSessionId = createdTargetSession.id;
        isDraftSession = false;
      }
    }

    if (!currentSessionKey || (!currentDesktopSessionId && currentViewMode !== 'cron')) {
      const draftAgentId = get().currentAgentId || 'main';
      const createdSession = await createDesktopSessionRequest(
        '',
        buildTemporarySessionKey(draftAgentId),
      );
      set((s) => ({
        desktopSessions: [createdSession, ...s.desktopSessions],
        isDraftSession: false,
        currentDesktopSessionId: createdSession.id,
        currentSessionKey: createdSession.gatewaySessionKey,
        currentAgentId: getAgentIdFromSessionKey(createdSession.gatewaySessionKey),
      }));
      currentSessionKey = createdSession.gatewaySessionKey;
      currentDesktopSessionId = createdSession.id;
      isDraftSession = false;
    }

    // Add user message optimistically (with local file metadata for UI display)
    const nowMs = Date.now();
    const optimisticAttachments = attachments?.map(a => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      preview: a.preview,
      filePath: a.stagedPath,
    })) || [];
    const limitedOptimisticAttachments = limitAttachedFilesForMessage(optimisticAttachments);
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || (attachments?.length ? '(file attached)' : ''),
      timestamp: nowMs / 1000,
      id: crypto.randomUUID(),
      _attachedFiles: limitedOptimisticAttachments.files,
      _hiddenAttachmentCount: limitedOptimisticAttachments.hiddenCount || undefined,
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      isDraftSession,
      sending: true,
      error: null,
      ...createEmptyToolRuntimeState(),
      streamingTextStartedAt: nowMs / 1000,
      pendingFinal: false,
      lastUserMessageAt: nowMs,
    }));

    // Update desktop session metadata as soon as the first user message is sent.
    const { desktopSessions, messages } = get();
    const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
    const currentDesktopSession = desktopSessions.find((session) => session.id === currentDesktopSessionId);
    const titleText = renderSkillMarkersAsPlainText(trimmed);
    const previewText = toSessionPreview(trimmed || (attachments?.length ? '(file attached)' : ''));
    const nextTitle = isFirstMessage && titleText
      ? (titleText.length > 50 ? `${titleText.slice(0, 50)}…` : titleText)
      : (currentDesktopSession?.title ?? '');
    if (currentDesktopSessionId) {
      set((s) => ({
        desktopSessions: s.desktopSessions.map((session) => (
          session.id === currentDesktopSessionId
            ? {
                ...session,
                title: nextTitle,
                lastMessagePreview: previewText || session.lastMessagePreview,
                updatedAt: nowMs,
              }
            : session
        )),
      }));
      void updateDesktopSessionRequest(currentDesktopSessionId, {
        title: nextTitle,
        ...(previewText ? { lastMessagePreview: previewText } : {}),
        updatedAt: nowMs,
      }).catch((error) => {
        console.warn(`Failed to update desktop session ${currentDesktopSessionId}:`, error);
      });
    }

    // Start the history poll and safety timeout IMMEDIATELY (before the
    // RPC await) because the gateway's chat.send RPC may block until the
    // entire agentic conversation finishes — the poll must run in parallel.
    _lastChatEventAt = Date.now();
    clearHistoryPoll();
    clearErrorRecoveryTimer();

    const POLL_START_DELAY = 3_000;
    const POLL_INTERVAL = 4_000;
    const pollHistory = () => {
      const state = get();
      if (!state.sending) { clearHistoryPoll(); return; }
      if (state.streamingText.trim() || state.toolMessages.length > 0 || state.streamSegments.length > 0) {
        _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
        return;
      }
      state.loadHistory(true);
      _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
    };
    _historyPollTimer = setTimeout(pollHistory, POLL_START_DELAY);

    const SAFETY_TIMEOUT_MS = 90_000;
    const checkStuck = () => {
      const state = get();
      if (!state.sending) return;
      if (state.streamingText.trim() || state.toolMessages.length > 0 || state.streamSegments.length > 0) return;
      if (state.pendingFinal) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      if (Date.now() - _lastChatEventAt < SAFETY_TIMEOUT_MS) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      clearHistoryPoll();
      set({
        error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
        sending: false,
        activeRunId: null,
        lastUserMessageAt: null,
      });
    };
    setTimeout(checkStuck, 30_000);

    try {
      const idempotencyKey = crypto.randomUUID();
      const hasMedia = attachments && attachments.length > 0;
      if (hasMedia) {
        console.log('[sendMessage] Media paths:', attachments!.map(a => a.stagedPath));
      }

      // Cache image attachments BEFORE the IPC call to avoid race condition:
      // history may reload (via Gateway event) before the RPC returns.
      // Keyed by staged file path which appears in [media attached: <path> ...].
      if (hasMedia && attachments) {
        for (const a of attachments) {
          _imageCache.set(a.stagedPath, {
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            preview: a.preview,
          });
        }
        saveImageCache(_imageCache);
      }

      let result: { success: boolean; result?: { runId?: string }; error?: string };

      // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
      const CHAT_SEND_TIMEOUT_MS = 120_000;

      if (hasMedia) {
        result = await hostApiFetch<{ success: boolean; result?: { runId?: string }; error?: string }>(
          '/api/chat/send-with-media',
          {
            method: 'POST',
            body: JSON.stringify({
              sessionKey: currentSessionKey,
              message: trimmed || 'Process the attached file(s).',
              deliver: false,
              idempotencyKey,
              media: attachments.map((a) => ({
                filePath: a.stagedPath,
                mimeType: a.mimeType,
                fileName: a.fileName,
              })),
            }),
          },
        );
      } else {
        const rpcResult = await useGatewayStore.getState().rpc<{ runId?: string }>(
          'chat.send',
          {
            sessionKey: currentSessionKey,
            message: trimmed,
            deliver: false,
            idempotencyKey,
          },
          CHAT_SEND_TIMEOUT_MS,
        );
        result = { success: true, result: rpcResult };
      }

      console.log(`[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`);

      if (!result.success) {
        clearHistoryPoll();
        set({ error: result.error || 'Failed to send message', sending: false, ...createEmptyToolRuntimeState() });
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId });
      }
    } catch (err) {
      clearHistoryPoll();
      set({ error: String(err), sending: false, ...createEmptyToolRuntimeState() });
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    const { currentSessionKey } = get();
    set({
      sending: false,
      ...createEmptyToolRuntimeState(),
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      pendingToolHiddenCount: 0,
    });

    try {
      await useGatewayStore.getState().rpc(
        'chat.abort',
        { sessionKey: currentSessionKey },
      );
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Handle incoming chat events from Gateway ──

  handleChatEvent: (event: Record<string, unknown>) => {
    const runId = String(event.runId || '');
    const eventState = String(event.state || '');
    const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
    const { activeRunId, currentSessionKey } = get();

    // Only process events for the current session (when sessionKey is present)
    if (eventSessionKey != null && eventSessionKey !== currentSessionKey) {
      return;
    }

    // Only process events for the active run (or if no active run set)
    if (activeRunId && runId && runId !== activeRunId) {
      return;
    }

    _lastChatEventAt = Date.now();

    // Defensive: if state is missing but we have a message, try to infer state.
    let resolvedState = eventState;
    if (!resolvedState && event.message && typeof event.message === 'object') {
      const msg = event.message as Record<string, unknown>;
      const stopReason = msg.stopReason ?? msg.stop_reason;
      if (stopReason) {
        resolvedState = 'final';
      } else if (msg.role || msg.content) {
        resolvedState = 'delta';
      }
    }

    // Only pause the history poll when we receive actual streaming data.
    // The gateway sends "agent" events with { phase, startedAt } that carry
    // no message — these must NOT kill the poll, since the poll is our only
    // way to track progress when the gateway doesn't stream intermediate turns.
    const hasUsefulData = resolvedState === 'delta' || resolvedState === 'final'
      || resolvedState === 'error' || resolvedState === 'aborted';
    if (hasUsefulData) {
      clearHistoryPoll();
      // Adopt run started from another client (e.g. console at 127.0.0.1:28788):
      // show loading/streaming in the app when this session has an active run.
      const { sending } = get();
      if (!sending && runId) {
        set({ sending: true, activeRunId: runId, error: null });
      }
    }

    switch (resolvedState) {
      case 'started': {
        // Run just started (e.g. from console); show loading immediately.
        const { sending: currentSending } = get();
        if (!currentSending && runId) {
          set({ sending: true, activeRunId: runId, error: null });
        }
        break;
      }
      case 'delta': {
        if (_errorRecoveryTimer) {
          clearErrorRecoveryTimer();
          set({ error: null });
        }
        const nextText = extractTextFromRuntimeMessage(event.message);
        const shouldResumeSending = !get().sending
          && !!event.message
          && typeof event.message === 'object'
          && !isToolResultRole((event.message as RawMessage).role);
        set((s) => ({
          ...(shouldResumeSending
            ? {
                sending: true,
                activeRunId: runId || s.activeRunId,
                pendingFinal: false,
              }
            : {}),
          streamingText: nextText.trim()
            ? (() => {
                const visibleText = stripRenderedPrefixFromStreamingText(nextText, s.streamSegments);
                return !s.streamingText || visibleText.length >= s.streamingText.length
                  ? visibleText
                  : s.streamingText;
              })()
            : s.streamingText,
          streamingTextStartedAt: nextText.trim()
            ? (
                s.streamingTextStartedAt
                ?? (typeof (event.message as RawMessage | undefined)?.timestamp === 'number'
                  ? (event.message as RawMessage).timestamp!
                  : Date.now() / 1000)
              )
            : s.streamingTextStartedAt,
        }));
        break;
      }
      case 'final': {
        clearErrorRecoveryTimer();
        if (get().error) set({ error: null });
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg) {
          if (isToolResultRole(finalMsg.role)) {
            const toolFiles: AttachedFileMeta[] = [
              ...extractImagesAsAttachedFiles(finalMsg.content),
            ];
            const text = getMessageText(finalMsg.content);
            if (text && !isErroredToolResult(finalMsg)) {
              const mediaRefs = extractMediaRefs(text);
              const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
              for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
              const currentToolMessage = [...get().toolMessages]
                .reverse()
                .find((message) => (
                  (finalMsg.toolCallId && message.toolCallId === finalMsg.toolCallId)
                  || (!finalMsg.toolCallId && finalMsg.toolName && message.toolName === finalMsg.toolName)
                ));
              const toolInput = getToolCallInput(currentToolMessage, finalMsg.toolCallId, finalMsg.toolName);
              if (shouldExtractRawFilePathsForTool(finalMsg.toolName, toolInput)) {
                for (const ref of extractRawFilePaths(text)) {
                  if (!mediaRefPaths.has(ref.filePath)) toolFiles.push(makeAttachedFile(ref));
                }
              }
            }
            set((s) => {
              const limitedPendingToolFiles = limitAttachedFilesForMessage(
                [...s.pendingToolImages, ...toolFiles],
                s.pendingToolHiddenCount,
              );
              const nextToolStreamById = new Map(s.toolStreamById);
              const nextToolStreamOrder = [...s.toolStreamOrder];
              const toolCallId = finalMsg.toolCallId || finalMsg.toolName || `tool-${Date.now()}`;
              let nextStreamSegments = s.streamSegments;
              let nextStreamingText = s.streamingText;
              let nextStreamingTextStartedAt = s.streamingTextStartedAt;
              let entry = nextToolStreamById.get(toolCallId);
              if (!entry && s.streamingText.trim()) {
                nextStreamSegments = [
                  ...s.streamSegments,
                  { text: s.streamingText, ts: s.streamingTextStartedAt ?? finalMsg.timestamp ?? Date.now() / 1000 },
                ];
                nextStreamingText = '';
                nextStreamingTextStartedAt = null;
              }
              entry = {
                toolCallId,
                runId: runId || s.activeRunId || '',
                sessionKey: eventSessionKey ?? undefined,
                name: finalMsg.toolName || entry?.name || toolCallId,
                args: entry?.args,
                output: text.trim() || entry?.output,
                status: isErroredToolResult(finalMsg) ? 'error' : 'completed',
                durationMs: entry?.durationMs,
                startedAt: entry?.startedAt ?? finalMsg.timestamp ?? Date.now() / 1000,
                updatedAt: Date.now(),
                message: {} as RawMessage,
              };
              entry.message = buildToolStreamMessage(entry);
              nextToolStreamById.set(toolCallId, entry);
              if (!nextToolStreamOrder.includes(toolCallId)) {
                nextToolStreamOrder.push(toolCallId);
              }
              return {
                streamingText: nextStreamingText,
                streamingTextStartedAt: nextStreamingTextStartedAt,
                streamSegments: nextStreamSegments,
                toolStreamById: nextToolStreamById,
                toolStreamOrder: nextToolStreamOrder,
                toolMessages: syncToolMessages(nextToolStreamOrder, nextToolStreamById),
                pendingFinal: true,
                pendingToolImages: limitedPendingToolFiles.files,
                pendingToolHiddenCount: limitedPendingToolFiles.hiddenCount,
              };
            });
            break;
          }

          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          const hadToolEvents = get().toolStreamOrder.length > 0;
          const msgId = finalMsg.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          set((s) => {
            const pendingImgs = s.pendingToolImages;
            const limitedMessageAttachments = limitAttachedFilesForMessage(
              [...(finalMsg._attachedFiles || []), ...pendingImgs],
              (finalMsg._hiddenAttachmentCount || 0) + s.pendingToolHiddenCount,
            );
            const msgWithImages: RawMessage = {
              ...finalMsg,
              role: (finalMsg.role || 'assistant') as RawMessage['role'],
              id: msgId,
              ...(limitedMessageAttachments.files.length > 0
                ? { _attachedFiles: limitedMessageAttachments.files }
                : {}),
              _hiddenAttachmentCount: limitedMessageAttachments.hiddenCount || undefined,
            };
            const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[], pendingToolHiddenCount: 0 };
            const alreadyExists = hasEquivalentFinalAssistantMessage(s.messages, msgWithImages, msgId);
            if (alreadyExists) {
              return {
                ...(hasOutput ? createEmptyToolRuntimeState() : {}),
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                ...clearPendingImages,
              };
            }
            return {
              messages: [...s.messages, msgWithImages],
              ...(hasOutput ? createEmptyToolRuntimeState() : {}),
              sending: hasOutput ? false : s.sending,
              activeRunId: hasOutput ? null : s.activeRunId,
              pendingFinal: hasOutput ? false : true,
              ...clearPendingImages,
            };
          });
          if (hasOutput && hadToolEvents && !toolOnly) {
            clearHistoryPoll();
            void get().loadHistory(true);
          }
        } else {
          set({
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            ...createEmptyToolRuntimeState(),
          });
          get().loadHistory();
        }
        break;
      }
      case 'error': {
        const errorMsg = String(event.errorMessage || 'An error occurred');
        const wasSending = get().sending;
        const { streamingText, streamingTextStartedAt } = get();

        if (streamingText.trim()) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                role: 'assistant',
                id: `error-snap-${Date.now()}`,
                content: streamingText,
                timestamp: streamingTextStartedAt ?? Date.now() / 1000,
              },
            ],
          }));
        }

        set({
          error: errorMsg,
          ...createEmptyToolRuntimeState(),
          pendingFinal: false,
          pendingToolImages: [],
          pendingToolHiddenCount: 0,
        });

        // Don't immediately give up: the Gateway often retries internally
        // after transient API failures (e.g. "terminated"). Keep `sending`
        // true for a grace period so that recovery events are processed and
        // the agent-phase-completion handler can still trigger loadHistory.
        if (wasSending) {
          clearErrorRecoveryTimer();
          const ERROR_RECOVERY_GRACE_MS = 15_000;
          _errorRecoveryTimer = setTimeout(() => {
            _errorRecoveryTimer = null;
            const state = get();
            if (state.sending && !state.streamingText.trim() && state.toolMessages.length === 0) {
              clearHistoryPoll();
              set({
                sending: false,
                activeRunId: null,
                lastUserMessageAt: null,
              });
              state.loadHistory(true);
            }
          }, ERROR_RECOVERY_GRACE_MS);
        } else {
          clearHistoryPoll();
          set({ sending: false, activeRunId: null, lastUserMessageAt: null });
        }
        break;
      }
      case 'aborted': {
        clearHistoryPoll();
        clearErrorRecoveryTimer();
        set({
          sending: false,
          activeRunId: null,
          ...createEmptyToolRuntimeState(),
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          pendingToolHiddenCount: 0,
        });
        break;
      }
      default: {
        const { sending } = get();
        if (sending && event.message && typeof event.message === 'object') {
          console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
          const nextText = extractTextFromRuntimeMessage(event.message);
          set((s) => ({
            streamingText: nextText.trim()
              ? (() => {
                  const visibleText = stripRenderedPrefixFromStreamingText(nextText, s.streamSegments);
                  return !s.streamingText || visibleText.length >= s.streamingText.length
                    ? visibleText
                    : s.streamingText;
                })()
              : s.streamingText,
            streamingTextStartedAt: nextText.trim()
              ? (
                  s.streamingTextStartedAt
                  ?? (typeof (event.message as RawMessage | undefined)?.timestamp === 'number'
                    ? (event.message as RawMessage).timestamp!
                    : Date.now() / 1000)
                )
              : s.streamingTextStartedAt,
          }));
        }
        break;
      }
    }
  },

  handleAgentEvent: (event: Record<string, unknown>) => {
    const stream = String(event.stream || '');
    if (stream !== 'tool') return;

    const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
    if (eventSessionKey && eventSessionKey !== get().currentSessionKey) {
      return;
    }

    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : event;
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    if (!toolCallId) return;

    const name = typeof data.name === 'string' ? data.name : 'tool';
    const phase = typeof data.phase === 'string' ? data.phase : '';
    const rawOutput = phase === 'update'
      ? data.partialResult
      : phase === 'result'
        ? data.result
        : undefined;
    const output = extractToolOutputText(rawOutput) ?? undefined;
    const meta = data.meta && typeof data.meta === 'object' ? data.meta as Record<string, unknown> : undefined;
    const rawDuration = meta?.durationMs ?? meta?.duration ?? data.durationMs;
    const durationMs = parseDurationMs(rawDuration);
    const outputLooksErrored = output ? looksLikeToolErrorText(output) : false;
    const status: ToolStatus['status'] = phase === 'result'
      ? ((data.isError === true || outputLooksErrored) ? 'error' : 'completed')
      : 'running';
    const startedAt = typeof event.ts === 'number' ? event.ts : Date.now() / 1000;

    _lastChatEventAt = Date.now();
    clearHistoryPoll();

    if (_errorRecoveryTimer) {
      clearErrorRecoveryTimer();
      set({ error: null });
    }

    set((s) => {
      const nextToolStreamById = new Map(s.toolStreamById);
      const nextToolStreamOrder = [...s.toolStreamOrder];
      let nextStreamSegments = s.streamSegments;
      let nextStreamingText = s.streamingText;
      let nextStreamingTextStartedAt = s.streamingTextStartedAt;

      let entry = nextToolStreamById.get(toolCallId);
      if (!entry) {
        if (s.streamingText.trim()) {
          nextStreamSegments = [
            ...s.streamSegments,
            { text: s.streamingText, ts: s.streamingTextStartedAt ?? startedAt },
          ];
          nextStreamingText = '';
          nextStreamingTextStartedAt = null;
        }
        entry = {
          toolCallId,
          runId: String(event.runId || s.activeRunId || ''),
          sessionKey: eventSessionKey ?? undefined,
          name,
          args: phase === 'start' ? data.args : undefined,
          output,
          status,
          durationMs,
          startedAt,
          updatedAt: Date.now(),
          message: {} as RawMessage,
        };
        nextToolStreamOrder.push(toolCallId);
      } else {
        entry = {
          ...entry,
          name,
          args: phase === 'start' ? data.args : entry.args,
          output: output ?? entry.output,
          status: mergeToolStatus(entry.status, status),
          durationMs: durationMs ?? entry.durationMs,
          updatedAt: Date.now(),
        };
      }

      entry.message = buildToolStreamMessage(entry);
      nextToolStreamById.set(toolCallId, entry);

      return {
        sending: true,
        // Tool stream runIds can differ from chat stream runIds; keep the
        // active chat run id stable so later text deltas are not filtered out.
        activeRunId: s.activeRunId,
        error: null,
        pendingFinal: phase === 'result' ? true : s.pendingFinal,
        streamingText: nextStreamingText,
        streamingTextStartedAt: nextStreamingTextStartedAt,
        streamSegments: nextStreamSegments,
        toolStreamById: nextToolStreamById,
        toolStreamOrder: nextToolStreamOrder,
        toolMessages: syncToolMessages(nextToolStreamOrder, nextToolStreamById),
      };
    });
  },

  // ── Toggle thinking visibility ──

  toggleThinking: () => set((s) => ({ showThinking: !s.showThinking })),

  // ── Toggle tool call visibility ──

  toggleToolCalls: () => set((s) => ({ showToolCalls: !s.showToolCalls })),

  // ── Refresh: reload history + sessions ──

  refresh: async () => {
    const { loadHistory, loadSessions, currentViewMode } = get();
    if (currentViewMode === 'session') {
      await loadSessions();
    }
    if (get().currentSessionKey) {
      await loadHistory(true);
    }
  },

  clearError: () => set({ error: null }),

  queueComposerSeed: (text: string) => set({
    pendingComposerSeed: {
      text,
      nonce: Date.now(),
    },
  }),

  consumePendingComposerSeed: () => set({ pendingComposerSeed: null }),
}));
