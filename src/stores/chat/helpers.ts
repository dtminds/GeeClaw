import { invokeIpc } from '@/lib/api-client';
import type { AttachedFileMeta, ChatSession, ContentBlock, RawMessage, ToolStatus } from './types';

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where streamingMessage is temporarily cleared
// between tool-result finals and the next delta.
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
const MAX_MESSAGE_ATTACHMENTS = 9;

function upsertImageCacheEntry(filePath: string, file: Omit<AttachedFileMeta, 'filePath'>): void {
  _imageCache.set(filePath, { ...file, filePath });
  saveImageCache(_imageCache);
}

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
    if (!candidate) {
      continue;
    }
    if (fullText.startsWith(candidate) && candidate.length > matchedPrefix.length) {
      matchedPrefix = candidate;
    }
  }

  return matchedPrefix ? fullText.slice(matchedPrefix.length) : fullText;
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
const READ_LIKE_TOOL_NAMES = new Set(['read', 'read_file', 'view']);
const HIDDEN_ATTACHMENT_FILE_NAMES = new Set(['skill.md', 'agent.md', 'memory.md', 'soul.md']);

function normalizeToolName(name: string | undefined): string {
  return (name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveToolLikeName(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const msg = message as Record<string, unknown>;
  const directName = typeof msg.toolName === 'string'
    ? msg.toolName
    : typeof msg.name === 'string'
      ? msg.name
      : '';
  if (directName.trim()) {
    return directName.trim();
  }

  const content = msg.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content as ContentBlock[]) {
    if ((block.type === 'tool_result' || block.type === 'toolResult' || block.type === 'tool_use' || block.type === 'toolCall') && typeof block.name === 'string' && block.name.trim()) {
      return block.name.trim();
    }
  }

  return undefined;
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

function shouldDisplayToolResultFileRef(filePath: string, toolName?: string): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (READ_LIKE_TOOL_NAMES.has(normalizedToolName)) {
    return false;
  }

  return !shouldHideAttachmentFilePath(filePath);
}

function shouldHideAttachmentFilePath(filePath: string): boolean {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) return false;
  const fileName = normalizedPath.split(/[\\/]/).pop()?.toLowerCase() || '';
  return HIDDEN_ATTACHMENT_FILE_NAMES.has(fileName);
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
  const pending: AttachedFileMeta[] = [];

  return messages.map((msg, index) => {
    if (isToolResultRole(msg.role)) {
      const toolName = resolveToolLikeName(msg);
      // 1. Image/file content blocks in the structured content array
      const imageFiles = extractImagesAsAttachedFiles(msg.content);
      pending.push(...imageFiles);

      // 2. [media attached: ...] patterns in tool result text output
      const text = getMessageText(msg.content);
      if (text && !isErroredToolResult(msg)) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
        for (const ref of mediaRefs) {
          if (shouldDisplayToolResultFileRef(ref.filePath, toolName)) {
            pending.push(makeAttachedFile(ref));
          }
        }
        // 3. Raw file paths in tool result text (documents, audio, video, etc.)
        const toolInput = findToolCallInputBeforeIndex(messages, index, msg.toolCallId, toolName);
        if (shouldExtractRawFilePathsForTool(toolName, toolInput)) {
          for (const ref of extractRawFilePaths(text)) {
            const duplicateMediaRef = mediaRefPaths.has(ref.filePath);
            if (!duplicateMediaRef && shouldDisplayToolResultFileRef(ref.filePath, toolName)) {
              pending.push(makeAttachedFile(ref));
            }
          }
        }
      }

      return msg; // will be filtered later
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      const toAttach = pending.splice(0);
      // Deduplicate against files already on the assistant message
      const existingPaths = new Set(
        (msg._attachedFiles || []).map(f => f.filePath).filter(Boolean),
      );
      const newFiles = toAttach.filter(f => !f.filePath || !existingPaths.has(f.filePath));
      if (newFiles.length === 0) return msg;
      const limited = limitAttachedFilesForMessage(
        [...(msg._attachedFiles || []), ...newFiles],
        msg._hiddenAttachmentCount || 0,
      );
      return {
        ...msg,
        _attachedFiles: limited.files,
        _hiddenAttachmentCount: limited.hiddenCount || undefined,
      };
    }

    return msg;
  });
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
    const visibleMediaRefs = mediaRefs.filter((ref) => !shouldHideAttachmentFilePath(ref.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    // Tool-only messages (thinking + tool calls) should not show file previews — those
    // belong to the final answer message that comes after the tool results.
    // User messages never get raw-path previews so the image is not shown twice.
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter(r => {
        const duplicateMediaRef = mediaRefPaths.has(r.filePath);
        return !duplicateMediaRef && !shouldHideAttachmentFilePath(r.filePath);
      });

      // Nearest preceding user message text (look back up to 5 messages)
      const seenPaths = new Set(rawRefs.map(r => r.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = getMessageText(prev.content);
          for (const ref of extractRawFilePaths(prevText)) {
            const duplicateMediaRef = mediaRefPaths.has(ref.filePath);
            const alreadySeen = seenPaths.has(ref.filePath);
            if (!duplicateMediaRef && !alreadySeen && !shouldHideAttachmentFilePath(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break; // only use the nearest user message
        }
      }
    }

    const allRefs = [...visibleMediaRefs, ...rawRefs];
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
    const thumbnails = await invokeIpc(
      'media:getThumbnails',
      needPreview,
    ) as Record<string, { exists: boolean; preview: string | null; fileSize: number }>;

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

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
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

function summarizeToolOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const summaryLines = lines.slice(0, 2);
  let summary = summaryLines.join(' / ');
  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }
  return summary;
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed'): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
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
    const summary = summarizeToolOutput(outputText);
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      status: normalizeToolStatus(undefined, eventState === 'delta' ? 'running' : 'completed'),
      summary,
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
  const summary = summarizeToolOutput(outputText) ?? summarizeToolOutput(String(details?.error ?? msg.error ?? ''));

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status,
    durationMs,
    summary,
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
      summary: update.summary ?? existing.summary,
      updatedAt: update.updatedAt || existing.updatedAt,
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

function setHistoryPollTimer(timer: ReturnType<typeof setTimeout> | null): void {
  _historyPollTimer = timer;
}

function hasErrorRecoveryTimer(): boolean {
  return _errorRecoveryTimer != null;
}

function setErrorRecoveryTimer(timer: ReturnType<typeof setTimeout> | null): void {
  _errorRecoveryTimer = timer;
}

function setLastChatEventAt(value: number): void {
  _lastChatEventAt = value;
}

function getLastChatEventAt(): number {
  return _lastChatEventAt;
}

export {
  MAX_MESSAGE_ATTACHMENTS,
  toMs,
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  extractImagesAsAttachedFiles,
  getMessageText,
  stripRenderedPrefixFromStreamingText,
  hasEquivalentFinalAssistantMessage,
  extractMediaRefs,
  extractRawFilePaths,
  getToolCallInput,
  makeAttachedFile,
  enrichWithToolResultFiles,
  isToolResultRole,
  isErroredToolResult,
  enrichWithCachedImages,
  loadMissingPreviews,
  upsertImageCacheEntry,
  limitAttachedFilesForMessage,
  getCanonicalPrefixFromSessions,
  collectToolUpdates,
  upsertToolStatuses,
  hasNonToolAssistantContent,
  isToolOnlyMessage,
  shouldExtractRawFilePathsForTool,
  shouldDisplayToolResultFileRef,
  resolveToolLikeName,
  setHistoryPollTimer,
  hasErrorRecoveryTimer,
  setErrorRecoveryTimer,
  setLastChatEventAt,
  getLastChatEventAt,
};
