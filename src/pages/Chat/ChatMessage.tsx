/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, memo } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink, X, FolderOpen, FolderSymlink, ZoomIn } from 'lucide-react';
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins, type LinkSafetyModalProps } from 'streamdown';
import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import { math } from '@streamdown/math';
import { cjk } from '@streamdown/cjk';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import spinners from 'unicode-animations';
import 'katex/dist/katex.min.css';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { parseSkillMarkerSegments } from '@/lib/chat-message-text';
import {
  extractAssistantDisplaySegments,
  formatToolResultText,
  shouldRenderStandaloneToolResult,
} from './assistant-display';
import { formatToolDisplaySummary } from './tool-display';
import type { RawMessage, AttachedFileMeta, ContentBlock } from '@/stores/chat';
import { isInternalMessage } from '@/stores/chat';
import { extractText, extractImages, extractToolUse, extractUserDisplayDecision, formatTimestamp, shouldHideToolTrace } from './message-utils';
import { EvolutionProposalCard } from './EvolutionProposalCard';
import { extractEvolutionProposalCardData, isEvolutionProposalToolName } from './evolution-proposal';
import { 
  File01Icon, FileVideoIcon, FolderLibraryIcon, ImageNotFound01Icon, MusicNote04Icon, Pdf02Icon,
  DatabaseIcon, FileSearchIcon, FileEditIcon, Delete01Icon, AiGenerativeIcon,
  ComputerTerminal01Icon,
  FileViewIcon,
  LeftToRightListStarIcon,
  Globe02Icon,
  ChromeIcon,
  AiBrain01Icon,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import * as Popover from '@radix-ui/react-popover';
import type { Pluggable } from 'unified';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  showToolCalls: boolean;
  isStreaming?: boolean;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

type ToolDisplayStatus = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
};

// const STREAMDOWN_ANIMATION = {
//   animation: 'fadeIn' as const,
//   duration: 50,
//   easing: 'ease-out' as const,
// };

const STREAMDOWN_PLUGINS = {
  code,
  mermaid,
  math,
  cjk,
} as const;

const STREAMDOWN_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks];
const STREAMDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: Array.from(new Set([...(defaultSchema.protocols?.href ?? []), 'tel', 'file'])),
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [...(Array.isArray(defaultSchema.attributes?.code) ? defaultSchema.attributes.code : []), 'metastring'],
  },
};
const STREAMDOWN_REHYPE_SANITIZE_PLUGIN: Pluggable = [rehypeSanitize, STREAMDOWN_SANITIZE_SCHEMA];
const STREAMDOWN_REHYPE_PLUGINS: Pluggable[] = [
  defaultRehypePlugins.raw,
  STREAMDOWN_REHYPE_SANITIZE_PLUGIN,
];
const FILE_NOT_FOUND_ERROR_REGEX = /path not found|no such file|does not exist/i;

type SpinnerName = keyof typeof spinners;

type SpinnerStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string;
  getServerSnapshot: () => string;
};

const spinnerStores = new Map<SpinnerName, SpinnerStore>();

function createSpinnerStore(loaderName: SpinnerName): SpinnerStore {
  const loader = spinners[loaderName];
  let frameIndex = 0;
  let intervalId: number | null = null;
  const listeners = new Set<() => void>();

  const getServerSnapshot = () => loader.frames[0] ?? '';
  const getSnapshot = () => loader.frames[frameIndex] ?? getServerSnapshot();

  const emitChange = () => {
    listeners.forEach((listener) => listener());
  };

  const stop = () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
      frameIndex = 0;
    }
  };

  const start = () => {
    if (typeof window === 'undefined' || intervalId !== null) {
      return;
    }

    intervalId = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % loader.frames.length;
      emitChange();
    }, loader.interval);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        start();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
        }
      };
    },
    getSnapshot,
    getServerSnapshot,
  };
}

function getSpinnerStore(loaderName: SpinnerName): SpinnerStore {
  let store = spinnerStores.get(loaderName);
  if (!store) {
    store = createSpinnerStore(loaderName);
    spinnerStores.set(loaderName, store);
  }
  return store;
}

const UnicodeSpinner = memo(function UnicodeSpinner({
  className,
  loaderName = 'braille',
}: {
  className?: string;
  loaderName?: SpinnerName;
}) {
  const store = getSpinnerStore(loaderName);
  const frame = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center font-mono leading-none', className)}
    >
      {frame}
    </span>
  );
});

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

type AssistantContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: unknown;
      status: 'running' | 'completed' | 'error';
      durationMs?: number;
      result?: string;
    };

function extractPlainTextFromUnknown(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

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

function shouldRenderAssistantPart(part: AssistantContentPart, showToolCalls: boolean): boolean {
  if (part.type !== 'tool') {
    return true;
  }

  return showToolCalls || extractEvolutionProposalCardData(part.name, part.input, part.result) !== null;
}

function mergeToolDisplayState(
  current: AssistantContentPart & { type: 'tool' },
  update: Partial<Pick<AssistantContentPart & { type: 'tool' }, 'status' | 'durationMs' | 'result'>>,
): AssistantContentPart & { type: 'tool' } {
  const statusOrder = { running: 0, completed: 1, error: 2 } as const;
  const nextStatus = update.status
    ? (statusOrder[update.status] >= statusOrder[current.status] ? update.status : current.status)
    : current.status;

  return {
    ...current,
    status: nextStatus,
    durationMs: update.durationMs ?? current.durationMs,
    result: update.result ?? current.result,
  };
}

function looksLikeToolErrorText(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(error|failed?|exception|traceback|invalid|denied|unauthorized|forbidden|not found|错误|失败|异常|未找到|无权限|拒绝访问)\b/i.test(trimmed);
}

const EMPTY_ATTACHMENTS: AttachedFileMeta[] = [];
const EMPTY_ASSISTANT_CONTENT_PARTS: AssistantContentPart[] = [];
const EMPTY_TOOL_DISPLAY_STATUSES: ToolDisplayStatus[] = [];
const EMPTY_MARKDOWN_IMAGES: ExtractedImage[] = [];

const COMMON_TOOL_NAME_MAP_ZH: Record<string, string> = {
  read: '读取文件',
  read_file: '读取文件',
  cat: '写入文件',
  view: '查看内容',
  list_dir: '查看目录',
  ls: '查看目录',
  tree: '查看目录',
  glob: '查找文件',
  find: '查找文件',
  fd: '查找文件',
  grep: '搜索内容',
  search: '搜索内容',
  write: '写入文件',
  write_file: '写入文件',
  create_file: '创建文件',
  edit: '编辑文件',
  edit_file: '编辑文件',
  replace: '替换内容',
  rename: '重命名文件',
  move_file: '移动文件',
  delete_file: '删除文件',
  rm: '删除文件',
  rmdir: '删除目录',
  mkdir: '创建目录',
  fetch: '浏览网页',
  web_fetch: '浏览网页',
  web_search: '联网搜索',
  curl: '浏览网页',
  wget: '浏览网页',
  browser: '使用浏览器',
  browser_open: '打开网页',
  bash: '执行本地命令',
  shell: '执行本地命令',
  exec: '执行本地命令',
  run_command: '执行本地命令',
  command: '执行本地命令',
  sql: '执行数据库查询',
  query: '执行查询',
  sessions_spawn: '启动子任务',
  sessions_yield: '等待子任务结果',
};

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getBaseCommand(command: string): string {
  const match = command.match(/^\s*([^\s]+)/);
  return match ? match[1].toLowerCase() : '';
}

function extractExecCommand(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed) {
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

function getToolDisplayIcon(name: string, input?: unknown) {
  const normalized = normalizeToolName(name);

  if (normalized === 'exec' || normalized === 'bash' || normalized === 'shell' || normalized === 'run_command' || normalized === 'command') {
    if (input) {
      const commandStr = extractExecCommand(input);
      if (commandStr) {
        const base = getBaseCommand(commandStr);
        if (base === 'ls' || base === 'tree' || base === 'find' || base === 'fd') return LeftToRightListStarIcon;
        if (base === 'cat' || base === 'less' || base === 'more' || base === 'tail' || base === 'head' || base === 'bat') return FileViewIcon;
        if (base === 'grep' || base === 'awk' || base === 'sed' || base === 'rg' || base === 'ag') return FileSearchIcon;
        if (base === 'vi' || base === 'vim' || base === 'nano' || base === 'emacs') return FileEditIcon;
        if (base === 'rm' || base === 'rmdir') return Delete01Icon;
        if (base === 'curl' || base === 'wget') return Globe02Icon;
      }
    }
    return ComputerTerminal01Icon;
  }

  if (normalized === 'read' || normalized === 'read_file' || normalized === 'cat' || normalized === 'view') return FileViewIcon;
  if (normalized === 'list_dir' || normalized === 'ls') return LeftToRightListStarIcon;
  if (normalized === 'glob' || normalized === 'grep' || normalized === 'search') return FileSearchIcon;
  if (normalized === 'write' || normalized === 'write_file' || normalized === 'create_file' || normalized === 'edit' || normalized === 'edit_file' || normalized === 'replace') return FileEditIcon;
  if (normalized === 'rename' || normalized === 'move_file') return FileEditIcon;
  if (normalized === 'delete_file') return Delete01Icon;
  if (normalized === 'fetch' || normalized === 'web_fetch' || normalized === 'web_search') return Globe02Icon;
  if (normalized === 'browser' || normalized === 'browser_open') return ChromeIcon;
  if (normalized === 'sql' || normalized === 'query') return DatabaseIcon;
  return AiGenerativeIcon;
}

function shouldIncludeToolPart(name: string, showToolCalls: boolean): boolean {
  return showToolCalls || isEvolutionProposalToolName(name);
}

function getToolDisplayName(name: string, preferZh: boolean): string {
  const normalized = normalizeToolName(name);
  return preferZh ? (COMMON_TOOL_NAME_MAP_ZH[normalized] || name) : name;
}

function getInlineToolResultStatus(block: ContentBlock, resultText: string): 'running' | 'completed' | 'error' {
  if (block.isError || block.is_error) return 'error';
  if (typeof block.error === 'string' && block.error.trim()) return 'error';
  const status = typeof block.status === 'string' ? block.status.toLowerCase() : '';
  if (status === 'running' || status === 'in_progress') return 'running';
  if (status === 'error' || status === 'failed') return 'error';
  if (looksLikeToolErrorText(resultText)) return 'error';
  return 'completed';
}

type ToolStatusLookup = {
  byId: Map<string, ToolDisplayStatus>;
  byName: Map<string, ToolDisplayStatus>;
};

function buildToolStatusLookup(toolStatuses: ToolDisplayStatus[]): ToolStatusLookup {
  const byId = new Map<string, ToolDisplayStatus>();
  const byName = new Map<string, ToolDisplayStatus>();

  for (const tool of toolStatuses) {
    if (!tool) continue;
    if (tool.id) byId.set(tool.id, tool);
    if (tool.toolCallId) byId.set(tool.toolCallId, tool);
    if (tool.name) byName.set(tool.name, tool);
  }

  return { byId, byName };
}

function findMatchingToolStatus(toolStatusLookup: ToolStatusLookup, id?: string, name?: string): ToolDisplayStatus | undefined {
  if (id) {
    const statusById = toolStatusLookup.byId.get(id);
    if (statusById) {
      return statusById;
    }
  }

  return name ? toolStatusLookup.byName.get(name) : undefined;
}

function buildAssistantContentParts(
  message: RawMessage,
  showToolCalls: boolean,
  toolStatuses: ToolDisplayStatus[] = [],
  assistantTextParts: Array<{ type: 'text' | 'thinking'; text: string; blockIndex: number }> = [],
): AssistantContentPart[] {
  const toolStatusLookup = buildToolStatusLookup(toolStatuses);
  const content = Array.isArray(message.content) ? message.content as ContentBlock[] : null;

  // OpenAI-compatible streams may expose text/tool_calls separately rather than
  // as an ordered block list. Prefer text before tools in that fallback path.
  if (!content) {
    const parts: AssistantContentPart[] = assistantTextParts.map((part) => (
      part.type === 'thinking'
        ? { type: 'thinking', content: part.text }
        : { type: 'text', text: part.text }
    ));
    const tools = extractToolUse(message);
    for (const tool of tools) {
      if (shouldHideToolTrace(tool.name)) {
        continue;
      }
      if (!shouldIncludeToolPart(tool.name, showToolCalls)) {
        continue;
      }
      const toolStatus = findMatchingToolStatus(toolStatusLookup, tool.id, tool.name);
      parts.push({
        type: 'tool',
        id: tool.id || tool.name,
        name: tool.name,
        input: tool.input,
        status: toolStatus?.status || 'running',
        durationMs: toolStatus?.durationMs,
        result: toolStatus?.result,
      });
    }
    return parts;
  }

  const parts: AssistantContentPart[] = [];
  const textPartsByBlock = assistantTextParts.reduce<Map<number, Array<{ type: 'text' | 'thinking'; text: string }>>>((map, part) => {
    const group = map.get(part.blockIndex) || [];
    group.push({ type: part.type, text: part.text });
    map.set(part.blockIndex, group);
    return map;
  }, new Map());

  const pushTextPartsForBlock = (blockIndex: number) => {
    const blockParts = textPartsByBlock.get(blockIndex);
    if (!blockParts || blockParts.length === 0) {
      return;
    }
    for (const part of blockParts) {
      if (part.type === 'thinking') {
        parts.push({ type: 'thinking', content: part.text });
      } else {
        parts.push({ type: 'text', text: part.text });
      }
    }
  };

  for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
    const block = content[blockIndex];
    pushTextPartsForBlock(blockIndex);

    if (block.type === 'text' || block.type === 'thinking') {
      continue;
    }

    if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
      if (shouldHideToolTrace(block.name)) {
        continue;
      }
      if (!shouldIncludeToolPart(block.name, showToolCalls)) {
        continue;
      }
      const toolStatus = findMatchingToolStatus(toolStatusLookup, block.id, block.name);
      parts.push({
        type: 'tool',
        id: block.id || block.name,
        name: block.name,
        input: block.input ?? block.arguments,
        status: toolStatus?.status || 'running',
        durationMs: toolStatus?.durationMs,
        result: toolStatus?.result,
      });
      continue;
    }

    if (block.type === 'tool_result' || block.type === 'toolResult') {
      const resultText = extractPlainTextFromUnknown(block.content ?? block.text ?? '');
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part.type !== 'tool') continue;
        const isMatch = (block.id && (part.id === block.id)) || (block.name && part.name === block.name) || !block.id;
        if (!isMatch) continue;
        parts[index] = mergeToolDisplayState(part, {
          status: getInlineToolResultStatus(block, resultText || block.error?.trim() || ''),
          result: resultText || block.error?.trim() || undefined,
        });
        break;
      }
    }
  }

  // Some streaming providers send text blocks in `content[]` while exposing
  // tool calls only via top-level `tool_calls`. Keep content order first, then
  // append missing tools so "text -> tool" turns render correctly in real time.
  const parsedTools = extractToolUse(message);
  for (const tool of parsedTools) {
    if (shouldHideToolTrace(tool.name)) {
      continue;
    }
    if (!shouldIncludeToolPart(tool.name, showToolCalls)) {
      continue;
    }
    const alreadyRendered = parts.some((part) => {
      if (part.type !== 'tool') return false;
      if (tool.id && part.id === tool.id) return true;
      return part.name === tool.name;
    });
    if (alreadyRendered) continue;
    const toolStatus = findMatchingToolStatus(toolStatusLookup, tool.id, tool.name);
    parts.push({
      type: 'tool',
      id: tool.id || tool.name,
      name: tool.name,
      input: tool.input,
      status: toolStatus?.status || 'running',
      durationMs: toolStatus?.durationMs,
      result: toolStatus?.result,
    });
  }

  return parts;
}

function getAssistantDisplayText(parts: AssistantContentPart[]): string {
  if (parts.length === 0) {
    return '';
  }

  const textParts: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text.trim()) {
      textParts.push(part.text);
    }
  }

  return textParts.join('\n\n').trim();
}

function areMessagesEquivalent(prevMessage: RawMessage, nextMessage: RawMessage): boolean {
  return prevMessage === nextMessage || (
    prevMessage.role === nextMessage.role
    && prevMessage.id === nextMessage.id
    && prevMessage.timestamp === nextMessage.timestamp
    && prevMessage.content === nextMessage.content
    && prevMessage.senderLabel === nextMessage.senderLabel
    && prevMessage.toolCallId === nextMessage.toolCallId
    && prevMessage.toolName === nextMessage.toolName
    && prevMessage.details === nextMessage.details
    && prevMessage.isError === nextMessage.isError
    && prevMessage._attachedFiles === nextMessage._attachedFiles
    && prevMessage._hiddenAttachmentCount === nextMessage._hiddenAttachmentCount
    && prevMessage._toolStatuses === nextMessage._toolStatuses
  );
}

function areChatMessagePropsEqual(prevProps: ChatMessageProps, nextProps: ChatMessageProps): boolean {
  return prevProps.showThinking === nextProps.showThinking
    && prevProps.showToolCalls === nextProps.showToolCalls
    && prevProps.isStreaming === nextProps.isStreaming
    && areMessagesEquivalent(prevProps.message, nextProps.message);
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  showToolCalls,
  isStreaming = false,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const shouldHideInternalMessage = useMemo(() => isInternalMessage(message), [message]);
  const userDisplayDecision = useMemo(() => (isUser ? extractUserDisplayDecision(message) : null), [isUser, message]);
  const isUserSystemNotice = userDisplayDecision?.action === 'show_system_notice';
  const assistantDisplay = useMemo(
    () => (!isUser ? extractAssistantDisplaySegments(message, { showThinking }) : null),
    [isUser, message, showThinking],
  );
  const markdownImages = useMemo<Array<ExtractedImage>>(
    () => assistantDisplay?.markdownImages.map((image) => ({
      mimeType: image.mimeType,
      data: image.data,
    })) || EMPTY_MARKDOWN_IMAGES,
    [assistantDisplay],
  );
  const images = useMemo(
    () => [...extractImages(message), ...markdownImages],
    [markdownImages, message],
  );
  const userText = useMemo(() => (isUser ? extractText(message) : ''), [isUser, message]);
  const effectiveToolStatuses = !isUser ? (message._toolStatuses || EMPTY_TOOL_DISPLAY_STATUSES) : EMPTY_TOOL_DISPLAY_STATUSES;
  const assistantContentParts = useMemo(
    () => (isUser
      ? EMPTY_ASSISTANT_CONTENT_PARTS
      : buildAssistantContentParts(message, showToolCalls, effectiveToolStatuses, assistantDisplay?.parts || [])),
    [assistantDisplay?.parts, effectiveToolStatuses, isUser, message, showToolCalls],
  );
  const assistantRenderableParts = useMemo(
    () => assistantContentParts.filter((part) => shouldRenderAssistantPart(part, showToolCalls)),
    [assistantContentParts, showToolCalls],
  );
  const assistantText = useMemo(
    () => (isUser ? '' : getAssistantDisplayText(assistantContentParts)),
    [assistantContentParts, isUser],
  );
  const text = isUser ? userText : assistantText;
  const hasText = text.length > 0;
  const hasUserSystemNotice = isUserSystemNotice && Boolean(userDisplayDecision?.text);
  const hasAssistantText = assistantText.length > 0;

  const attachedFiles = message._attachedFiles || EMPTY_ATTACHMENTS;
  const hiddenAttachmentCount = message._hiddenAttachmentCount || 0;
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  if (isToolResult && !shouldRenderStandaloneToolResult(message, { showToolCalls })) return null;
  if (shouldHideInternalMessage) return null;

  if (!hasText && !hasUserSystemNotice && assistantRenderableParts.length === 0 && images.length === 0 && attachedFiles.length === 0) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser && !isUserSystemNotice ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 space-y-2',
          isUser && !isUserSystemNotice ? 'items-end max-w-[80%]' : 'max-w-[100%] items-start',
        )}
      >
        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              if (file.exists === false) return null;
              const isImage = file.mimeType.startsWith('image/');
              const isInlinePreviewableImage = isImage && file.mimeType !== 'image/svg+xml';
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              if (isInlinePreviewableImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                ) : (
                  <div
                    key={`local-${i}`}
                    className="w-36 h-36 rounded-xl border overflow-hidden bg-muted flex items-center justify-center text-muted-foreground"
                  >
                    <HugeiconsIcon icon={ImageNotFound01Icon} className="h-8 w-8"/>
                  </div>
                );
              }
              // Non-image files and non-previewable images → file card
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {isUser && hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
          />
        )}

        {hasUserSystemNotice && userDisplayDecision?.action === 'show_system_notice' && (
          <SystemNotice text={userDisplayDecision.text} />
        )}

        {!isUser && assistantRenderableParts.map((part, index) => {
          if (part.type === 'thinking') {
            return <ThinkingBlock key={`thinking-${index}`} content={part.content} isStreaming={isStreaming} />;
          }
          if (part.type === 'tool') {
            return (
              <ToolCard
                key={part.id || `tool-${index}`}
                name={part.name}
                input={part.input}
                status={part.status}
                durationMs={part.durationMs}
                result={part.result}
              />
            );
          }
          return (
            <MessageBubble
              key={`text-${index}`}
              text={part.text}
              isUser={false}
              isStreaming={isStreaming}
            />
          );
        })}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              if (file.exists === false) return null;
              const isImage = file.mimeType.startsWith('image/');
              const isInlinePreviewableImage = isImage && file.mimeType !== 'image/svg+xml';
              if (isImage && images.length > 0) return null;
              if (isInlinePreviewableImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                );
              }
              if (isInlinePreviewableImage && !file.preview) {
                return (
                  <div key={`local-${i}`} className="w-36 h-36 rounded-xl border overflow-hidden bg-muted flex items-center justify-center text-muted-foreground">
                    <HugeiconsIcon icon={ImageNotFound01Icon} className="h-8 w-8"/>
                  </div>
                );
              }
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {hiddenAttachmentCount > 0 && attachedFiles.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {`仅显示前 ${attachedFiles.length} 个文件产物，另有 ${hiddenAttachmentCount} 个未显示`}
          </div>
        )}

        {/* Hover row for user messages — timestamp only */}
        {isUser && message.timestamp && (
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
            {formatTimestamp(message.timestamp)}
          </span>
        )}

        {/* Hover row for assistant messages — only when there is real text content */}
        {!isUser && hasAssistantText && (
          <AssistantHoverBar text={text} timestamp={message.timestamp} message={message} />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
}, areChatMessagePropsEqual);

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

// ── Assistant hover bar (timestamp + copy, shown on group hover) ─

function AssistantHoverBar({ text, timestamp }: { text: string; timestamp?: number; message?: RawMessage }) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex w-full flex-wrap items-center justify-start gap-x-4 gap-y-1.5 opacity-0 transition-opacity duration-200 select-none group-hover:opacity-100">
      <span className="text-xs text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyContent}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────

function getPathDisplayName(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function fileHrefToPath(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'file:') {
      return null;
    }

    const pathname = decodeURIComponent(url.pathname);
    if (url.host) {
      return `//${url.host}${pathname}`;
    }
    if (/^\/[A-Za-z]:/.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname || null;
  } catch {
    return null;
  }
}

async function openLocalPath(filePath: string, displayName = getPathDisplayName(filePath)): Promise<void> {
  try {
    const errorMessage = await invokeIpc<string>('shell:openPath', filePath);
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      await invokeIpc('shell:showItemInFolder', filePath);
      if (FILE_NOT_FOUND_ERROR_REGEX.test(errorMessage)) {
        toast.error(`${displayName} 不存在`);
        return;
      }
      toast.error(`无法直接打开 ${displayName}，已在文件夹中定位`);
    }
  } catch (error) {
    console.error('Failed to open local path', error);
    toast.error(`打开 ${displayName} 失败`);
  }
}

function ExternalLinkSafetyModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const { i18n } = useTranslation('chat');
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  const title = isZh ? '打开外部链接？' : 'Open external link?';
  const description = isZh ? '你即将访问一个外部网站。' : "You're about to visit an external website.";
  const destinationLabel = isZh ? '目标地址' : 'Destination';
  const closeLabel = isZh ? '关闭' : 'Close';
  const copyLabel = copied ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制链接' : 'Copy link');
  const openLabel = isZh ? '打开链接' : 'Open link';

  const handleClose = useCallback(() => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopied(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose, isOpen]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy external link', error);
      toast.error(isZh ? '复制链接失败' : 'Failed to copy link');
    }
  }, [isZh, url]);

  const handleOpen = useCallback(() => {
    onConfirm();
    handleClose();
  }, [handleClose, onConfirm]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center overflow-y-auto bg-[rgba(9,14,20,0.54)] p-4 backdrop-blur-sm md:p-5"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="external-link-dialog-title"
    >
      <div
        className="modal-card-surface relative flex w-[min(32rem,calc(100vw-2rem))] max-w-[32rem] flex-col gap-5 rounded-3xl border p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon"
          className="modal-close-button absolute right-4 top-4 -mr-2 -mt-2"
          onClick={handleClose}
          title={closeLabel}
          aria-label={closeLabel}
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="flex items-start gap-3 pr-10">
          <div className="modal-field-surface flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-primary">
            <ExternalLink className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 id="external-link-dialog-title" className="modal-title text-[1.25rem]">
              {title}
            </h2>
            <p className="modal-description">
              {description}
            </p>
          </div>
        </div>

        <div className="modal-section-surface rounded-2xl border p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
            {destinationLabel}
          </div>
          <div className="mt-2 break-all text-sm font-medium text-foreground" title={url}>
            {url}
          </div>
        </div>

        <div className="modal-footer pt-0">
          <button
            type="button"
            className="modal-secondary-button inline-flex min-w-0 flex-1 items-center justify-center gap-2"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span>{copyLabel}</span>
          </button>
          <button
            ref={openButtonRef}
            type="button"
            className="modal-primary-button inline-flex min-w-0 flex-1 items-center justify-center gap-2"
            onClick={handleOpen}
          >
            <ExternalLink className="h-4 w-4" />
            <span>{openLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MarkdownLink({
  children,
  className,
  href,
}: {
  children?: React.ReactNode;
  className?: string;
  href?: string;
}) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const filePath = useMemo(() => (href ? fileHrefToPath(href) : null), [href]);
  const isIncomplete = href === 'streamdown:incomplete-link';
  const linkClassName = cn('wrap-anywhere font-medium text-primary underline', className);
  const buttonClassName = cn('wrap-anywhere appearance-none text-left font-medium text-primary underline', className);

  const handleOpenFile = useCallback(async () => {
    if (!filePath) {
      return;
    }
    await openLocalPath(filePath);
  }, [filePath]);

  const handleOpenExternal = useCallback(() => {
    if (href) {
      window.open(href, '_blank', 'noreferrer');
    }
  }, [href]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isIncomplete || !href) {
      return;
    }
    if (filePath) {
      void handleOpenFile();
      return;
    }
    setIsConfirmOpen(true);
  }, [filePath, handleOpenFile, href, isIncomplete]);

  if (isIncomplete || !href) {
    return <span className={linkClassName}>{children}</span>;
  }

  return (
    <>
      <button
        type="button"
        className={cn(buttonClassName, filePath && 'inline-flex items-center gap-1')}
        data-streamdown="link"
        onClick={handleClick}
      >
        <span>{children}</span>
        {filePath ? <FolderSymlink data-testid="markdown-file-link-icon" className="h-3 w-3 shrink-0" /> : null}
      </button>
      {!filePath ? (
        <ExternalLinkSafetyModal
          isOpen={isConfirmOpen}
          onClose={() => setIsConfirmOpen(false)}
          onConfirm={handleOpenExternal}
          url={href}
        />
      ) : null}
    </>
  );
}

const STREAMDOWN_COMPONENTS = {
  a: MarkdownLink,
} as const;

function MessageBubble({
  text,
  isUser,
  isStreaming,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
}) {
  const skillSegments = useMemo(() => (isUser ? parseSkillMarkerSegments(text) : []), [isUser, text]);

  return (
    <div
      className={cn(
        'relative rounded-2xl',
        !isUser && 'w-full',
        isUser && 'px-4 py-3 bg-primary text-primary-foreground'
      )}
    >
      {isUser ? (
        <div className="whitespace-pre-wrap break-words break-all text-base">
          {skillSegments.length > 0 ? (
            skillSegments.map((segment, index) => {
              if (segment.type === 'text') {
                return (
                  <span key={`text-${index}`} className="whitespace-pre-wrap break-words">
                    {segment.text}
                  </span>
                );
              }

              return (
                <span key={`skill-${segment.slug}-${index}`} className="whitespace-pre-wrap break-words break-all">
                  {`/${segment.slug}`}
                </span>
              );
            })
          ) : (
            <span className="break-words break-all">{text}</span>
          )}
        </div>
      ) : (
        <div className="chat-markdown prose dark:prose-invert max-w-none [&_pre]:my-2 [&_code]:text-xs [&_p]:m-0 [&_p+p]:mt-2 [&_ul]:my-1 [&_ol]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:list-outside [&_ol]:list-outside [&_ul]:ps-6 [&_ol]:ps-7 [&_ul>li]:ps-0 [&_ol>li]:ps-0 [&_li]:my-0">
          <Streamdown
            mode={isStreaming ? undefined : 'static'}
            // animated={isStreaming ? STREAMDOWN_ANIMATION : undefined}
            // isAnimating={isStreaming}
            plugins={STREAMDOWN_PLUGINS}
            components={STREAMDOWN_COMPONENTS}
            rehypePlugins={STREAMDOWN_REHYPE_PLUGINS}
            remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
          >
            {text}
          </Streamdown>
        </div>
      )}

    </div>
  );
}

function SystemNotice({ text }: { text: string }) {
  return (
    <div
      data-testid="chat-system-notice"
      className="w-full rounded-2xl border border-border/60 bg-muted/35 px-4 py-3 text-sm text-muted-foreground"
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        <HugeiconsIcon icon={AlertCircleIcon} className="h-3.5 w-3.5" />
        <span>System Notice</span>
      </div>
      <div className="whitespace-pre-wrap break-words break-all">{text}</div>
    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full text-sm">
      <button
        className="flex items-center gap-2 w-full py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className='flex h-4 w-4 shrink-0 items-center justify-center rounded-full' aria-hidden="true">
          {isStreaming ? <UnicodeSpinner className="w-4 text-[13px]" /> : <HugeiconsIcon icon={AiBrain01Icon} className="h-3.5 w-3.5" />}
        </span>
        <span
          className={cn(
            'text-xs',
            isStreaming && 'animate-shimmer bg-[linear-gradient(110deg,color-mix(in_oklab,var(--color-foreground)_25%,transparent)_35%,var(--color-foreground)_48%,var(--color-foreground)_52%,color-mix(in_oklab,var(--color-foreground)_25%,transparent)_65%)] bg-[length:200%_100%] bg-clip-text text-transparent',
          )}
        >
          {isStreaming ? 'Thinking' : 'Think Completed'}
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="px-6 pb-3 text-muted-foreground">
          <div className={cn('chat-markdown max-w-none opacity-75', isStreaming && 'transition-opacity')}>
            <Streamdown
              mode={isStreaming ? undefined : 'static'}
              // animated={isStreaming ? STREAMDOWN_ANIMATION : undefined}
              // isAnimating={isStreaming}
              components={STREAMDOWN_COMPONENTS}
              rehypePlugins={STREAMDOWN_REHYPE_PLUGINS}
              remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
            >
              {content}
            </Streamdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <HugeiconsIcon icon={FileVideoIcon} className={className} />;
  if (mimeType.startsWith('audio/')) return <HugeiconsIcon icon={MusicNote04Icon} className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <HugeiconsIcon icon={File01Icon} className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <HugeiconsIcon icon={FolderLibraryIcon} className={className} />;
  if (mimeType === 'application/pdf') return <HugeiconsIcon icon={Pdf02Icon} className={className} />;
  return <HugeiconsIcon icon={File01Icon} className={className} />;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  const handleOpen = useCallback(async () => {
    if (file.url) {
      await invokeIpc('shell:openExternal', file.url);
      return;
    }
    if (!file.filePath) return;
    await openLocalPath(file.filePath, file.fileName);
  }, [file.fileName, file.filePath, file.url]);

  return (
    <div 
      className={cn(
        "flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-2 min-w-[180px] max-w-[250px]",
        (file.filePath || file.url) && "surface-hover cursor-pointer transition-colors"
      )}
      onClick={handleOpen}
      title={file.filePath || file.url ? "Open file" : undefined}
    >
      <FileIcon mimeType={file.mimeType} className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 overflow-hidden text-primary">
        <p className="text-xs truncate">{file.fileName}</p>
      </div>
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="relative w-36 h-36 rounded-xl border overflow-hidden bg-muted group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" loading="lazy" decoding="async" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="relative flex h-[8rem] w-[8rem] items-center justify-center rounded-lg border overflow-hidden bg-muted/20 p-1 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block h-full w-full rounded-md object-contain" loading="lazy" decoding="async" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void src; void base64; void mimeType; void fileName;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      invokeIpc('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title="在文件夹中显示"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function EvolutionProposalMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown prose max-w-none text-[15px] leading-7 text-[#5f5753] [&_code]:rounded-[4px] [&_code]:bg-[#f3eeea] [&_code]:px-1 [&_ol]:my-2 [&_ol]:ps-7 [&_p]:m-0 [&_p+p]:mt-2.5 [&_pre]:rounded-[12px] [&_pre]:border [&_pre]:border-[#ebe2dc] [&_pre]:bg-[#f8f4f1] [&_pre]:px-3.5 [&_pre]:py-3 [&_ul]:my-2 [&_ul]:ps-6">
      <Streamdown
        mode="static"
        plugins={STREAMDOWN_PLUGINS}
        components={STREAMDOWN_COMPONENTS}
        rehypePlugins={STREAMDOWN_REHYPE_PLUGINS}
        remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
      >
        {content}
      </Streamdown>
    </div>
  );
}

function ToolCard({
  name,
  status,
  durationMs,
  result,
  input,
}: {
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
  input?: unknown;
}) {
  const { i18n } = useTranslation('chat');
  const preferZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const [open, setOpen] = useState(false);
  const duration = formatDuration(durationMs);
  const isRunning = status === 'running';
  const isError = status === 'error';
  const evolutionProposalCard = useMemo(
    () => extractEvolutionProposalCardData(name, input, result),
    [input, name, result],
  );
  const summary = useMemo(() => formatToolDisplaySummary(name, input, undefined, preferZh), [input, name, preferZh]);
  const displayName = useMemo(() => getToolDisplayName(name, preferZh), [name, preferZh]);
  const toolIcon = useMemo(() => getToolDisplayIcon(name, input), [input, name]);
  const displaySummary = useMemo(
    () => {
      if (!summary.detailLine) {
        return displayName;
      }

      const normalizedDisplayName = displayName.trim();
      const normalizedVerb = (summary.verb || '').trim();
      if (normalizedDisplayName && normalizedVerb && normalizedDisplayName === normalizedVerb) {
        return summary.detail && summary.detail !== normalizedVerb
          ? `${displayName} ${summary.detail}`
          : displayName;
      }

      return `${displayName} ${summary.detailLine}`;
    },
    [displayName, summary.detail, summary.detailLine, summary.verb],
  );
  const formattedInput = useMemo(() => {
    if (!open || input == null) {
      return null;
    }

    return typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  }, [input, open]);
  const formattedResult = useMemo(() => formatToolResultText(result, name), [name, result]);
  const visibleResult = formattedResult || null;

  if (evolutionProposalCard) {
    return (
      <EvolutionProposalCard
        proposal={evolutionProposalCard}
        status={status}
        preferZh={preferZh}
        renderMarkdown={(content) => <EvolutionProposalMarkdown content={content} />}
        onOpenDraftPath={openLocalPath}
      />
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'group/tool relative flex min-w-0 max-w-[30rem] flex-col overflow-hidden rounded-lg text-sm transition-colors mb-1',
          !isRunning && !isError && 'text-muted-foreground',
          isError && 'text-destructive',
        )}
      >
        <Popover.Trigger asChild>
          <button
            className="flex min-w-0 items-center gap-2 py-1.5 focus:outline-none cursor-pointer"
            aria-label={displaySummary}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                isRunning && 'text-primary',
                !isRunning && !isError && 'text-primary/80',
                isError && 'text-destructive',
              )}
            >
              {isRunning && <UnicodeSpinner className="w-4 text-[13px]" />}
              {!isRunning && !isError && <HugeiconsIcon icon={toolIcon} className="h-4 w-4 shrink-0" />}
              {isError && <HugeiconsIcon icon={AlertCircleIcon} className="h-4 w-4 shrink-0" />}
            </span>
            <span 
              className={cn(
                "min-w-0 flex-1 truncate text-xs text-left",
                isRunning && "animate-shimmer bg-[linear-gradient(110deg,color-mix(in_oklab,var(--color-foreground)_25%,transparent)_35%,var(--color-foreground)_48%,var(--color-foreground)_52%,color-mix(in_oklab,var(--color-foreground)_25%,transparent)_65%)] bg-[length:200%_100%] bg-clip-text text-transparent"
              )} 
              title={summary.summaryLine}
            >
              {displaySummary}
            </span>
            {duration && <span className="text-[11px] opacity-60">{duration}</span>}
          </button>
        </Popover.Trigger>
        
        {open && (
          <Popover.Portal>
            <Popover.Content 
              align="start" 
              side="bottom" 
              sideOffset={4}
              className="z-50 max-w-[600px] max-h-64 space-y-2 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-[0_10px_20px_0_rgba(28,28,32,0.1)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 px-3 py-2 text-xs overscroll-contain"
            >
              {formattedInput && (
                <div className="space-y-1">
                  <div className="font-medium uppercase tracking-wide opacity-70">Input</div>
                  <pre className="surface-muted w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md px-2 py-2 font-mono">
                    {formattedInput}
                  </pre>
                </div>
              )}
              {visibleResult && (
                <div className="space-y-1">
                  <div className="font-medium uppercase tracking-wide opacity-70">Result</div>
                  <pre className="surface-muted w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md px-2 py-2 font-mono">
                    {visibleResult}
                  </pre>
                </div>
              )}
              {result && (!formattedResult || result !== formattedResult) && (
                <div className="space-y-1">
                  <div className="font-medium uppercase tracking-wide opacity-70">Raw Result</div>
                  <pre className="surface-muted w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md px-2 py-2 font-mono">
                    {result}
                  </pre>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        )}
      </div>
    </Popover.Root>
  );
}
