import { hostApiFetch } from '@/lib/host-api';
import {
  sanitizeMessageForDisplay,
} from '@/lib/chat-message-text';
import {
  extractAssistantVisibleText,
  isEmptyAssistantTurn,
} from '@/pages/Chat/assistant-display';
import { splitMediaFromOutput } from '@/lib/media-output';
import type { AttachedFileMeta, ContentBlock, RawMessage } from './model';
import {
  findToolCallInputBeforeIndex,
  getMessageText,
  isInternalMessage,
  shouldExtractRawFilePathsForTool,
} from './utils';
import {
  collectToolUpdates,
  findPreviousAssistantToolMessageIndex,
  isErroredToolResult,
  isToolOnlyMessage,
  isToolResultRole,
  upsertToolStatuses,
} from './tool-status';

const IMAGE_CACHE_KEY = 'geeclaw:image-cache';
const IMAGE_CACHE_MAX = 100;
const MAX_MESSAGE_ATTACHMENTS = 20;
const DEFAULT_ARTIFACT_MESSAGE_LIMIT = 100;
const FILE_EXTENSION_PATTERN = 'htm?l|png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
const FILE_EXTENSION_REGEX = new RegExp(`\\.(?:${FILE_EXTENSION_PATTERN})(?:[?#].*)?$`, 'i');
const TOOL_INPUT_ARTIFACT_PATH_TOOL_NAMES = new Set([
  'write',
  'write_file',
  'create_file',
  'edit',
  'edit_file',
  'replace',
  'str_replace',
  'str_replace_editor',
]);

export interface FileArtifactExtractionOptions {
  artifactBaseDir?: string | null;
  artifactMessageLimit?: number | null;
}

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch {
    // ignore parse errors
  }
  return new Map();
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    const entries = Array.from(cache.entries());
    const trimmed = entries.length > IMAGE_CACHE_MAX
      ? entries.slice(entries.length - IMAGE_CACHE_MAX)
      : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore quota errors
  }
}

const imageCache = loadImageCache();

export function limitAttachedFilesForMessage(
  files: AttachedFileMeta[],
  hiddenCount = 0,
): { files: AttachedFileMeta[]; hiddenCount: number } {
  if (files.length <= MAX_MESSAGE_ATTACHMENTS) {
    return {
      files,
      hiddenCount,
    };
  }

  return {
    files: files.slice(0, MAX_MESSAGE_ATTACHMENTS),
    hiddenCount: hiddenCount + (files.length - MAX_MESSAGE_ATTACHMENTS),
  };
}

export function upsertImageCacheEntry(filePath: string, file: Omit<AttachedFileMeta, 'filePath'>): void {
  imageCache.set(filePath, { ...file, filePath });
  saveImageCache(imageCache);
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
export function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/** Map common file extensions to MIME types */
function mimeFromExtension(filePath: string): string {
  const normalizedPath = (() => {
    if (/^https?:\/\//i.test(filePath)) {
      try {
        return new URL(filePath).pathname || filePath;
      } catch {
        return filePath;
      }
    }
    return filePath;
  })().split(/[?#]/)[0];
  const ext = normalizedPath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
    'svg': 'image/svg+xml',
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
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'm4v': 'video/mp4',
    'htm': 'text/html',
    'html': 'text/html',
  };
  return map[ext] || 'application/octet-stream';
}

function getMediaSourceFileName(source: string): string {
  if (/^https?:\/\//i.test(source)) {
    try {
      const pathname = decodeURIComponent(new URL(source).pathname || '');
      const fileName = pathname.split('/').filter(Boolean).pop();
      return fileName || 'file';
    } catch {
      return 'file';
    }
  }

  return source.split(/[\\/]/).pop() || 'file';
}

function isRemoteMediaSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function getAttachmentIdentity(file: Pick<AttachedFileMeta, 'filePath' | 'url' | 'preview'>): string | undefined {
  return file.filePath || file.url || file.preview || undefined;
}

function getArtifactExtractionStartIndex(messages: RawMessage[], opts?: FileArtifactExtractionOptions): number {
  const limit = opts?.artifactMessageLimit ?? DEFAULT_ARTIFACT_MESSAGE_LIMIT;
  if (limit == null || !Number.isFinite(limit)) return 0;
  if (limit <= 0) return messages.length;
  return Math.max(0, messages.length - Math.floor(limit));
}

function stripAssistantArtifactsOutsideWindow(
  message: RawMessage,
  index: number,
  artifactStartIndex: number,
): RawMessage {
  if (index >= artifactStartIndex || message.role !== 'assistant' || !message._attachedFiles) {
    return message;
  }

  const { _attachedFiles: _discardedAttachedFiles, _hiddenAttachmentCount: _discardedHiddenCount, ...rest } = message;
  return rest as RawMessage;
}

export function extractMediaDirectiveSources(text: string): string[] {
  return splitMediaFromOutput(text).mediaUrls || [];
}

export function makeAttachedFileFromMediaSource(source: string): AttachedFileMeta {
  if (!isRemoteMediaSource(source)) {
    return makeAttachedFile({ filePath: source, mimeType: mimeFromExtension(source) });
  }

  const mimeType = mimeFromExtension(source);
  return {
    fileName: getMediaSourceFileName(source),
    mimeType,
    fileSize: 0,
    preview: mimeType.startsWith('image/') ? source : null,
    url: source,
  };
}

function normalizePathSegments(pathValue: string, separator: '/' | '\\'): string {
  const parts = pathValue.split(/[\\/]+/);
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else {
        stack.push(part);
      }
      continue;
    }
    stack.push(part);
  }

  return stack.join(separator);
}

function resolveRelativeArtifactPath(relativePath: string, baseDir?: string | null): string | null {
  const trimmedBase = baseDir?.trim().replace(/[\\/]+$/, '');
  if (!trimmedBase) return null;

  const separator: '/' | '\\' = trimmedBase.includes('\\') && !trimmedBase.includes('/') ? '\\' : '/';
  const normalizedRelative = normalizePathSegments(relativePath, separator);

  if (/^[A-Za-z]:[\\/]/.test(trimmedBase)) {
    const drive = trimmedBase.slice(0, 2);
    const baseRest = normalizePathSegments(trimmedBase.slice(2), separator);
    const joinedRest = normalizePathSegments(`${baseRest}${separator}${normalizedRelative}`, separator);
    return `${drive}${separator}${joinedRest}`;
  }

  if (trimmedBase.startsWith('~/')) {
    const joined = normalizePathSegments(`${trimmedBase.slice(2)}${separator}${normalizedRelative}`, separator);
    return `~/${joined}`;
  }

  if (trimmedBase.startsWith('~\\')) {
    const joined = normalizePathSegments(`${trimmedBase.slice(2)}${separator}${normalizedRelative}`, separator);
    return `~\\${joined}`;
  }

  const isAbsoluteBase = trimmedBase.startsWith('/') || trimmedBase.startsWith('\\');
  const joined = normalizePathSegments(`${trimmedBase}${separator}${normalizedRelative}`, separator);
  return isAbsoluteBase ? `${separator}${joined}` : joined;
}

function normalizeToolNameForArtifactInput(toolName: string | undefined): string {
  return (toolName || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function parseToolInputRecord(toolInput: unknown): Record<string, unknown> | null {
  if (!toolInput) return null;
  if (typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    return toolInput as Record<string, unknown>;
  }
  if (typeof toolInput !== 'string') return null;

  const trimmed = toolInput.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveToolInputArtifactPath(pathValue: string, opts?: FileArtifactExtractionOptions): string | null {
  const trimmed = pathValue.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;

  if (
    trimmed.startsWith('/')
    || trimmed.startsWith('\\')
    || trimmed.startsWith('~/')
    || trimmed.startsWith('~\\')
    || /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return trimmed;
  }

  return resolveRelativeArtifactPath(trimmed, opts?.artifactBaseDir);
}

function decodeFileLinkTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function normalizeMarkdownLocalFileTarget(target: string, opts?: FileArtifactExtractionOptions): string | null {
  const trimmed = target.trim().replace(/^<|>$/g, '');
  if (!trimmed || trimmed.startsWith('#')) return null;

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const pathname = decodeFileLinkTarget(url.pathname);
      return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return null;
    }
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(trimmed)) return null;

  const decodedTarget = decodeFileLinkTarget(trimmed);
  if (!FILE_EXTENSION_REGEX.test(decodedTarget)) return null;

  return resolveToolInputArtifactPath(decodedTarget, opts);
}

export function extractMarkdownLocalFileRefs(
  text: string,
  opts?: FileArtifactExtractionOptions,
): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const markdownLinkRegex = /(?<!!)\[[^\]\n]+\]\(\s*(<[^>\n]+>|[^\s)\n]+)(?:\s+["'][^"'\n]*["'])?\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkRegex.exec(text)) !== null) {
    const target = match[1];
    const filePath = target ? normalizeMarkdownLocalFileTarget(target, opts) : null;
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    refs.push({ filePath, mimeType: mimeFromExtension(filePath) });
  }

  return refs;
}

export function extractAssistantInlineArtifactFiles(
  text: string,
  opts?: FileArtifactExtractionOptions,
): AttachedFileMeta[] {
  const files: AttachedFileMeta[] = [];
  const seen = new Set<string>();
  const pushFile = (file: AttachedFileMeta) => {
    const identity = getAttachmentIdentity(file) || file.fileName;
    if (identity && seen.has(identity)) return;
    if (identity) seen.add(identity);
    files.push(file);
  };

  extractMediaDirectiveSources(text)
    .map(makeAttachedFileFromMediaSource)
    .forEach(pushFile);
  extractMarkdownLocalFileRefs(text, opts)
    .map(makeAttachedFile)
    .forEach(pushFile);

  return files;
}

export function extractToolInputArtifactRefs(
  toolName: string | undefined,
  toolInput: unknown,
  opts?: FileArtifactExtractionOptions,
): Array<{ filePath: string; mimeType: string }> {
  const normalizedToolName = normalizeToolNameForArtifactInput(toolName);
  if (!TOOL_INPUT_ARTIFACT_PATH_TOOL_NAMES.has(normalizedToolName)) return [];

  const inputRecord = parseToolInputRecord(toolInput);
  if (!inputRecord) return [];

  const pathValue = inputRecord.path ?? inputRecord.file_path;
  if (typeof pathValue !== 'string') return [];

  const filePath = resolveToolInputArtifactPath(pathValue, opts);
  return filePath ? [{ filePath, mimeType: mimeFromExtension(filePath) }] : [];
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, including browser-style `MEDIA:/abs/path.ext`
 * refs from tool outputs, consistent with channel push message behavior.
 *
 * Relative paths are only extracted when an artifact base directory is supplied,
 * so prose like package/file references is not treated as a local artifact.
 */
export function extractRawFilePaths(
  text: string,
  opts?: FileArtifactExtractionOptions,
): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const unixRegex = new RegExp(`(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${FILE_EXTENSION_PATTERN}))`, 'gi');
  const winRegex = new RegExp(`(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${FILE_EXTENSION_PATTERN}))`, 'gi');
  const mediaUnixRegex = new RegExp(`(?<![\\w./])MEDIA:\\s*((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${FILE_EXTENSION_PATTERN}))`, 'gi');
  const mediaWinRegex = new RegExp(`(?<![\\w./])MEDIA:\\s*([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${FILE_EXTENSION_PATTERN}))`, 'gi');
  const relativeRegex = new RegExp(`(?<![\\w./:])((?:\\.{1,2}[\\\\/])[^\\s\\n"'()\\[\\],<>]*?\\.(?:${FILE_EXTENSION_PATTERN}))`, 'gi');

  for (const regex of [unixRegex, winRegex, mediaUnixRegex, mediaWinRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const filePath = match[1];
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        refs.push({ filePath, mimeType: mimeFromExtension(filePath) });
      }
    }
  }

  if (opts?.artifactBaseDir) {
    let match: RegExpExecArray | null;
    while ((match = relativeRegex.exec(text)) !== null) {
      const relativePath = match[1];
      const filePath = relativePath ? resolveRelativeArtifactPath(relativePath, opts.artifactBaseDir) : null;
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        refs.push({ filePath, mimeType: mimeFromExtension(filePath) });
      }
    }
  }

  return refs;
}

/**
 * Extract images from a content array (including nested tool_result content).
 * Converts them to AttachedFileMeta entries with preview set to data URL or remote URL.
 */
export function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  if (!Array.isArray(content)) return [];
  const files: AttachedFileMeta[] = [];

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
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
      } else if (block.data) {
        const mimeType = block.mimeType || 'image/jpeg';
        files.push({
          fileName: 'image',
          mimeType,
          fileSize: 0,
          preview: `data:${mimeType};base64,${block.data}`,
        });
      }
    }

    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      files.push(...extractImagesAsAttachedFiles(block.content));
    }
  }

  return files;
}

/** Build an AttachedFileMeta entry for a file ref, using cache if available. */
export function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const cached = imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath, exists: cached.exists ?? true };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
}

export function enrichWithToolResultFiles(
  messages: RawMessage[],
  opts?: FileArtifactExtractionOptions,
): RawMessage[] {
  const artifactStartIndex = getArtifactExtractionStartIndex(messages, opts);
  const next = messages.map((message, index) => stripAssistantArtifactsOutsideWindow(message, index, artifactStartIndex));
  const pending: AttachedFileMeta[] = [];
  const pendingAttachmentIds = new Set<string>();
  const pushPendingFile = (file: AttachedFileMeta) => {
    const identity = getAttachmentIdentity(file);
    if (identity && pendingAttachmentIds.has(identity)) return;
    if (identity) pendingAttachmentIds.add(identity);
    pending.push(file);
  };

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
      const toolName = typeof msg.toolName === 'string' ? msg.toolName : undefined;
      const toolInput = findToolCallInputBeforeIndex(next, index, msg.toolCallId, toolName);
      const shouldExtractToolArtifacts = index >= artifactStartIndex
        && shouldExtractRawFilePathsForTool(toolName, toolInput);
      const text = getMessageText(msg.content);
      if (shouldExtractToolArtifacts) {
        const imageFiles = extractImagesAsAttachedFiles(msg.content);
        imageFiles.forEach(pushPendingFile);
      }

      if (shouldExtractToolArtifacts && !isErroredToolResult(msg)) {
        for (const ref of extractToolInputArtifactRefs(toolName, toolInput, opts)) {
          pushPendingFile(makeAttachedFile(ref));
        }
      }

      if (shouldExtractToolArtifacts && text && !isErroredToolResult(msg)) {
        const mediaDirectiveSources = extractMediaDirectiveSources(text);
        const mediaDirectivePathSet = new Set(
          mediaDirectiveSources.filter((source) => !isRemoteMediaSource(source)),
        );
        for (const source of mediaDirectiveSources) {
          pushPendingFile(makeAttachedFileFromMediaSource(source));
        }

        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));
        for (const ref of mediaRefs) {
          pushPendingFile(makeAttachedFile(ref));
        }

        for (const ref of extractRawFilePaths(text, opts)) {
          if (!mediaRefPaths.has(ref.filePath) && !mediaDirectivePathSet.has(ref.filePath)) {
            pushPendingFile(makeAttachedFile(ref));
          }
        }
      }

      const updates = collectToolUpdates(msg, 'final');
      let matchedAnyUpdate = false;
      let matchedAllMatchableUpdates = true;
      for (const update of updates) {
        if (!update.toolCallId) {
          continue;
        }
        const targetIndex = findPreviousAssistantToolMessageIndex(next, index, update);
        if (targetIndex === -1) {
          matchedAllMatchableUpdates = false;
          continue;
        }
        const target = next[targetIndex];
        matchedAnyUpdate = true;
        next[targetIndex] = {
          ...target,
          _toolStatuses: upsertToolStatuses(target._toolStatuses || [], [update]),
        };
      }

      if (matchedAnyUpdate && matchedAllMatchableUpdates) {
        next[index] = {
          ...msg,
          _toolResultMatched: true,
        };
      }

      continue;
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      const toAttach = pending.splice(0);
      pendingAttachmentIds.clear();
      const existingAttachmentIds = new Set(
        (msg._attachedFiles || []).map(getAttachmentIdentity).filter(Boolean),
      );
      const newFiles = toAttach.filter((file) => {
        const identity = getAttachmentIdentity(file);
        return !identity || !existingAttachmentIds.has(identity);
      });
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
    }
  }

  return next;
}

function hasRenderableAssistantHistoryContent(message: RawMessage, isStrictlyEmptyAssistantTurn = isEmptyAssistantTurn(message)): boolean {
  if (extractAssistantVisibleText(message)) {
    return true;
  }

  if ((message._attachedFiles?.length ?? 0) > 0) {
    return true;
  }

  if (isStrictlyEmptyAssistantTurn) {
    return true;
  }

  if (Array.isArray(message.content)) {
    return (message.content as ContentBlock[]).some((block) => (
      block.type === 'thinking'
      || block.type === 'image'
      || block.type === 'tool_use'
      || block.type === 'toolCall'
      || block.type === 'tool_result'
      || block.type === 'toolResult'
    ));
  }

  return false;
}

export function enrichWithCachedImages(
  messages: RawMessage[],
  opts?: FileArtifactExtractionOptions,
): RawMessage[] {
  const artifactStartIndex = getArtifactExtractionStartIndex(messages, opts);
  return messages.map((msg, index) => {
    const shouldExtractAssistantArtifacts = msg.role === 'assistant' && index >= artifactStartIndex && !isToolOnlyMessage(msg);
    const shouldExtractMessageArtifacts = msg.role === 'user' || shouldExtractAssistantArtifacts;
    msg = stripAssistantArtifactsOutsideWindow(msg, index, artifactStartIndex);
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    const inlineArtifactFiles = shouldExtractAssistantArtifacts
      ? extractAssistantInlineArtifactFiles(text, opts)
      : [];
    const mediaDirectiveFiles = msg.role === 'user'
      ? extractMediaDirectiveSources(text).map(makeAttachedFileFromMediaSource)
      : inlineArtifactFiles;
    const attachmentIds = new Set(mediaDirectiveFiles.map(getAttachmentIdentity).filter(Boolean));
    const mediaRefs = shouldExtractMessageArtifacts ? extractMediaRefs(text) : [];
    const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));
    const inlineArtifactPaths = new Set(inlineArtifactFiles.map((file) => file.filePath).filter(Boolean));

    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (shouldExtractAssistantArtifacts) {
      rawRefs = extractRawFilePaths(text, opts).filter((ref) => (
        !mediaRefPaths.has(ref.filePath) && !inlineArtifactPaths.has(ref.filePath)
      ));
    }

    const files: AttachedFileMeta[] = [...mediaDirectiveFiles];
    for (const ref of [...mediaRefs, ...rawRefs]) {
      const cached = imageCache.get(ref.filePath);
      const file = cached
        ? { ...cached, filePath: ref.filePath, exists: cached.exists ?? true }
        : {
            fileName: ref.filePath.split(/[\\/]/).pop() || 'file',
            mimeType: ref.mimeType,
            fileSize: 0,
            preview: null,
            filePath: ref.filePath,
          };
      const identity = getAttachmentIdentity(file);
      if (identity && attachmentIds.has(identity)) {
        continue;
      }
      if (identity) {
        attachmentIds.add(identity);
      }
      files.push(file);
    }
    if (files.length === 0) return msg;

    const limited = limitAttachedFilesForMessage(files, msg._hiddenAttachmentCount || 0);
    return {
      ...msg,
      _attachedFiles: limited.files,
      _hiddenAttachmentCount: limited.hiddenCount || undefined,
    };
  });
}

export function prepareHistoryMessagesForDisplay(
  rawMessages: RawMessage[],
  opts?: FileArtifactExtractionOptions,
): RawMessage[] {
  const sanitizedEntries = rawMessages.map((rawMessage) => ({
    rawMessage,
    sanitizedMessage: sanitizeMessageForDisplay(rawMessage),
  }));
  const visibleEntries = sanitizedEntries.filter(({ sanitizedMessage }) => !isInternalMessage(sanitizedMessage));
  const messagesWithToolImages = enrichWithToolResultFiles(visibleEntries.map(({ sanitizedMessage }) => sanitizedMessage), opts);
  const filteredMessages = messagesWithToolImages.filter((msg, index) => {
    if (isToolResultRole(msg.role)) {
      return !msg._toolResultMatched;
    }
    if (msg.role === 'assistant') {
      const rawMessage = visibleEntries[index]?.rawMessage;
      const emptyAssistantTurn = rawMessage
        ? isEmptyAssistantTurn({
            ...rawMessage,
            _attachedFiles: msg._attachedFiles,
          } as RawMessage)
        : isEmptyAssistantTurn(msg);
      return hasRenderableAssistantHistoryContent(msg, emptyAssistantTurn);
    }
    return true;
  });
  return enrichWithCachedImages(filteredMessages, opts);
}

export async function hydrateHistoryMessagesForDisplay(
  rawMessages: RawMessage[],
  opts?: FileArtifactExtractionOptions,
): Promise<RawMessage[]> {
  const messages = prepareHistoryMessagesForDisplay(rawMessages, opts);
  const updated = await loadMissingPreviews(messages);
  if (!updated) return messages;

  return messages.map((msg) =>
    msg._attachedFiles
      ? { ...msg, _attachedFiles: msg._attachedFiles.map((file) => ({ ...file })) }
      : msg,
  );
}

export async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  const needPreview: Array<{ filePath: string; mimeType: string; preview?: boolean }> = [];
  const seenPaths = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    for (const file of msg._attachedFiles) {
      const filePath = file.filePath;
      if (!filePath || seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);
      needPreview.push({
        filePath,
        mimeType: file.mimeType,
        preview: file.mimeType.startsWith('image/') && file.preview ? false : undefined,
      });
    }

    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i += 1) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || seenPaths.has(ref.filePath)) continue;
        seenPaths.add(ref.filePath);
        needPreview.push({
          ...ref,
          preview: ref.mimeType.startsWith('image/') && file.preview ? false : undefined,
        });
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

      for (const file of msg._attachedFiles) {
        const filePath = file.filePath;
        if (!filePath) continue;
        const thumb = thumbnails[filePath];
        if (!thumb) continue;

        file.exists = thumb.exists;
        if (thumb.exists) {
          if (thumb.preview) file.preview = thumb.preview;
          file.fileSize = thumb.fileSize;
          imageCache.set(filePath, { ...file, exists: true });
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

      if (msg.role === 'user') {
        const text = getMessageText(msg.content);
        const refs = extractMediaRefs(text);
        for (let i = 0; i < refs.length; i += 1) {
          const file = msg._attachedFiles[i];
          const ref = refs[i];
          if (!file || !ref || file.filePath) continue;
          const thumb = thumbnails[ref.filePath];
          if (!thumb) continue;
          file.exists = thumb.exists;
          if (thumb.exists) {
            if (thumb.preview) file.preview = thumb.preview;
            file.fileSize = thumb.fileSize;
            imageCache.set(ref.filePath, { ...file, exists: true });
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
    if (updated) saveImageCache(imageCache);
    return updated;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return false;
  }
}
