import { hostApiFetch } from '@/lib/host-api';
import {
  renderSkillMarkersAsPlainText,
  sanitizeMessagesForDisplay,
} from '@/lib/chat-message-text';
import {
  extractAssistantVisibleText,
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
const MAX_MESSAGE_ATTACHMENTS = 9;
const HIDDEN_ATTACHMENT_FILE_NAMES = new Set(['skill.md', 'agent.md', 'memory.md', 'soul.md']);

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

function normalizeAttachmentFileName(value: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) return '';
  return normalizedValue.split(/[\\/]/).pop()?.toLowerCase() || '';
}

function shouldHideAttachmentFile(file: Pick<AttachedFileMeta, 'fileName' | 'filePath'>): boolean {
  const filePathName = normalizeAttachmentFileName(file.filePath || '');
  if (filePathName && HIDDEN_ATTACHMENT_FILE_NAMES.has(filePathName)) {
    return true;
  }

  const fileName = normalizeAttachmentFileName(file.fileName || '');
  return !!fileName && HIDDEN_ATTACHMENT_FILE_NAMES.has(fileName);
}

export function limitAttachedFilesForMessage(
  files: AttachedFileMeta[],
  hiddenCount = 0,
): { files: AttachedFileMeta[]; hiddenCount: number } {
  const visibleFiles = files.filter((file) => !shouldHideAttachmentFile(file));
  const hiddenByReservedNameCount = files.length - visibleFiles.length;

  if (visibleFiles.length <= MAX_MESSAGE_ATTACHMENTS) {
    return {
      files: visibleFiles,
      hiddenCount: hiddenCount + hiddenByReservedNameCount,
    };
  }

  return {
    files: visibleFiles.slice(0, MAX_MESSAGE_ATTACHMENTS),
    hiddenCount: hiddenCount + hiddenByReservedNameCount + (visibleFiles.length - MAX_MESSAGE_ATTACHMENTS),
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

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, including browser-style `MEDIA:/abs/path.ext`
 * refs from tool outputs, consistent with channel push message behavior.
 */
export function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts = 'htm?l|png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  const unixRegex = new RegExp(`(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  const winRegex = new RegExp(`(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  const mediaUnixRegex = new RegExp(`(?<![\\w./])MEDIA:\\s*((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  const mediaWinRegex = new RegExp(`(?<![\\w./])MEDIA:\\s*([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'gi');

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

export function enrichWithToolResultFiles(messages: RawMessage[]): RawMessage[] {
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
      const imageFiles = extractImagesAsAttachedFiles(msg.content);
      pending.push(...imageFiles);

      const text = getMessageText(msg.content);
      if (text && !isErroredToolResult(msg)) {
        const mediaDirectiveSources = extractMediaDirectiveSources(text);
        const mediaDirectivePathSet = new Set(
          mediaDirectiveSources.filter((source) => !isRemoteMediaSource(source)),
        );
        for (const source of mediaDirectiveSources) {
          pending.push(makeAttachedFileFromMediaSource(source));
        }

        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));
        for (const ref of mediaRefs) {
          pending.push(makeAttachedFile(ref));
        }

        const toolName = typeof msg.toolName === 'string' ? msg.toolName : undefined;
        const toolInput = findToolCallInputBeforeIndex(next, index, msg.toolCallId, toolName);
        if (shouldExtractRawFilePathsForTool(toolName, toolInput)) {
          for (const ref of extractRawFilePaths(text)) {
            if (!mediaRefPaths.has(ref.filePath) && !mediaDirectivePathSet.has(ref.filePath)) {
              pending.push(makeAttachedFile(ref));
            }
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

function hasRenderableAssistantHistoryContent(message: RawMessage): boolean {
  if (extractAssistantVisibleText(message)) {
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

export function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg, idx) => {
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    const mediaDirectiveFiles = extractMediaDirectiveSources(text).map(makeAttachedFileFromMediaSource);
    const attachmentIds = new Set(mediaDirectiveFiles.map(getAttachmentIdentity).filter(Boolean));
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));

    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      rawRefs = extractRawFilePaths(text).filter((ref) => !mediaRefPaths.has(ref.filePath));

      const seenPaths = new Set(rawRefs.map((ref) => ref.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i -= 1) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = renderSkillMarkersAsPlainText(getMessageText(prev.content));
          for (const ref of extractRawFilePaths(prevText)) {
            if (!mediaRefPaths.has(ref.filePath) && !seenPaths.has(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break;
        }
      }
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

export function prepareHistoryMessagesForDisplay(rawMessages: RawMessage[]): RawMessage[] {
  const sanitizedMessages = sanitizeMessagesForDisplay(rawMessages);
  const visibleMessages = sanitizedMessages.filter((msg) => !isInternalMessage(msg));
  const messagesWithToolImages = enrichWithToolResultFiles(visibleMessages);
  const filteredMessages = messagesWithToolImages.filter((msg) => {
    if (isToolResultRole(msg.role)) {
      return !msg._toolResultMatched;
    }
    if (msg.role === 'assistant') {
      return hasRenderableAssistantHistoryContent(msg);
    }
    return true;
  });
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

export async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  const seenPaths = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    for (const file of msg._attachedFiles) {
      const filePath = file.filePath;
      if (!filePath || seenPaths.has(filePath)) continue;
      const needsLoad = file.exists !== true
        || (file.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0);
      if (needsLoad) {
        seenPaths.add(filePath);
        needPreview.push({ filePath, mimeType: file.mimeType });
      }
    }

    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i += 1) {
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
