/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, memo, type MouseEvent } from 'react';
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
  buildAssistantDisplayModel,
  formatToolResultText,
  getLiveAssistantRuntimePayload,
  isEmptyAssistantTurn,
  shouldRenderStandaloneToolResult,
  type AssistantDisplayToolGroupPart,
} from './assistant-display';
import { formatToolDisplaySummary } from './tool-display';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { isInternalMessage, useChatStore } from '@/stores/chat';
import { extractText, extractImages, extractUserDisplayDecision, formatTimestamp } from './message-utils';
import { EvolutionProposalCard } from './EvolutionProposalCard';
import { extractEvolutionProposalCardData } from './evolution-proposal';
import {
  File01Icon, FileVideoIcon, FolderLibraryIcon, ImageNotFound01Icon, MusicNote04Icon, Pdf02Icon,
  DatabaseIcon, FileSearchIcon, FileEditIcon, Delete01Icon, AiGenerativeIcon,
  ComputerTerminal01Icon,
  FileViewIcon,
  HtmlFile01Icon,
  DocumentCodeIcon,
  Doc01Icon,
  Ppt01Icon,
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

const EMPTY_ATTACHMENTS: AttachedFileMeta[] = [];
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

function getToolDisplayName(name: string, preferZh: boolean): string {
  const normalized = normalizeToolName(name);
  return preferZh ? (COMMON_TOOL_NAME_MAP_ZH[normalized] || name) : name;
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
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const shouldHideInternalMessage = useMemo(() => isInternalMessage(message), [message]);
  const userDisplayDecision = useMemo(() => (isUser ? extractUserDisplayDecision(message) : null), [isUser, message]);
  const isUserSystemNotice = userDisplayDecision?.action === 'show_system_notice';
  const assistantDisplay = useMemo(
    () => {
      if (isUser) {
        return null;
      }

      const liveRuntimePayload = getLiveAssistantRuntimePayload(message);
      return buildAssistantDisplayModel(message, {
        showThinking,
        showToolCalls,
        isStreaming,
        liveToolMessages: liveRuntimePayload.liveToolMessages,
        liveStreamSegments: liveRuntimePayload.liveStreamSegments,
        liveToolStatuses: message._toolStatuses,
      });
    },
    [isStreaming, isUser, message, showThinking, showToolCalls],
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
  const assistantRenderableParts = assistantDisplay?.parts || [];
  const assistantText = isUser ? '' : (assistantDisplay?.visibleText || '');
  const hasUserSystemNotice = isUserSystemNotice && Boolean(userDisplayDecision?.text);
  // const hasAssistantText = assistantText.length > 0;

  const attachedFiles = message._attachedFiles || EMPTY_ATTACHMENTS;
  const hiddenAttachmentCount = message._hiddenAttachmentCount || 0;
  const shouldShowEmptyAssistantFallback = !isStreaming
    && isEmptyAssistantTurn(message)
    && !isToolResult
    && assistantRenderableParts.length === 0
    && images.length === 0;
  const emptyAssistantFallbackText = shouldShowEmptyAssistantFallback
    ? t('assistant.emptyResponse', '模型服务并未返回有效内容')
    : '';
  const text = isUser ? userText : (assistantText || emptyAssistantFallbackText);
  const hasText = text.length > 0;
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  if (isToolResult && !shouldRenderStandaloneToolResult(message, { showToolCalls })) return null;
  if (shouldHideInternalMessage) return null;

  if (!hasText && !hasUserSystemNotice && assistantRenderableParts.length === 0 && images.length === 0 && attachedFiles.length === 0) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser && !isUserSystemNotice ? 'flex-row-reverse mt-2' : 'flex-row',
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

        {!isUser && assistantRenderableParts.length === 0 && hasText && (
          <MessageBubble
            text={text}
            isUser={false}
            isStreaming={isStreaming}
          />
        )}

        {!isUser && assistantRenderableParts.map((part, index) => {
          if (part.type === 'thinking') {
            return <ThinkingBlock key={`thinking-${index}`} content={part.text} isStreaming={isStreaming} />;
          }
          if (part.type === 'tool_item') {
            return (
              <ToolCard
                key={`tool-item-${index}`}
                name={part.item.name}
                input={part.item.input}
                status={part.item.status}
                durationMs={part.item.durationMs}
                result={part.item.result}
                timestamp={part.item.timestamp ?? message.timestamp}
              />
            );
          }
          if (part.type === 'tool_group') {
            return (
              <ToolGroupCard
                key={`tool-group-${index}`}
                part={part}
                timestamp={message.timestamp}
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

        {/* File artifacts — assistant messages (behind a compact popover) */}
        {!isUser && attachedFiles.length > 0 && (
          <ArtifactFilesPopover files={attachedFiles} hiddenCount={hiddenAttachmentCount} />
        )}

        {isUser && hiddenAttachmentCount > 0 && attachedFiles.length > 0 && (
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
        {/* {!isUser && hasAssistantText && (
          <AssistantHoverBar text={text} timestamp={message.timestamp} message={message} />
        )} */}
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

// function AssistantHoverBar({ text, timestamp }: { text: string; timestamp?: number; message?: RawMessage }) {
//   const [copied, setCopied] = useState(false);

//   const copyContent = useCallback(() => {
//     navigator.clipboard.writeText(text);
//     setCopied(true);
//     setTimeout(() => setCopied(false), 2000);
//   }, [text]);

//   return (
//     <div className="flex w-full flex-wrap items-center justify-start gap-x-4 gap-y-1.5 opacity-0 transition-opacity duration-200 select-none group-hover:opacity-100">
//       <span className="text-xs text-muted-foreground">
//         {timestamp ? formatTimestamp(timestamp) : ''}
//       </span>
//       <Button
//         variant="ghost"
//         size="icon"
//         className="h-6 w-6"
//         onClick={copyContent}
//       >
//         {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
//       </Button>
//     </div>
//   );
// }

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

async function openContainingFolder(filePath: string): Promise<void> {
  try {
    await invokeIpc('shell:showItemInFolder', filePath);
  } catch (error) {
    console.error('Failed to reveal file:', error);
    toast.error('无法打开所在目录');
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
        <div className="whitespace-pre-wrap break-words break-all text-[15px] leading-6">
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
        <div className="chat-markdown prose dark:prose-invert max-w-none text-[15px] leading-6 [&_pre]:my-2 [&_code]:text-xs [&_p]:m-0 [&_p+p]:mt-2 [&_ul]:my-1 [&_ol]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:list-outside [&_ol]:list-outside [&_ul]:ps-6 [&_ol]:ps-7 [&_ul>li]:ps-0 [&_ol>li]:ps-0 [&_li]:my-0">
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

type FileIconKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'spreadsheet'
  | 'html'
  | 'markdown'
  | 'word'
  | 'presentation'
  | 'text'
  | 'archive'
  | 'pdf'
  | 'file';

function getFileExtension(fileName?: string): string {
  const baseName = (fileName || '').split(/[\\/]/).pop() || '';
  const dotIndex = baseName.lastIndexOf('.');
  return dotIndex > 0 ? baseName.slice(dotIndex + 1).toLowerCase() : '';
}

function getFileIconKind(mimeType: string, fileName?: string): FileIconKind {
  const normalizedMimeType = mimeType.toLowerCase().split(';')[0].trim();
  const extension = getFileExtension(fileName);

  if (normalizedMimeType.startsWith('image/')) return 'image';
  if (normalizedMimeType.startsWith('video/')) return 'video';
  if (normalizedMimeType.startsWith('audio/')) return 'audio';
  if (normalizedMimeType === 'text/html' || normalizedMimeType === 'application/xhtml+xml' || ['html', 'htm', 'xhtml'].includes(extension)) return 'html';
  if (['text/markdown', 'text/x-markdown', 'text/md', 'text/mdx', 'application/markdown'].includes(normalizedMimeType) || ['md', 'markdown', 'mdx'].includes(extension)) return 'markdown';
  if (normalizedMimeType === 'application/msword' || normalizedMimeType.includes('wordprocessingml') || ['doc', 'docx'].includes(extension)) return 'word';
  if (normalizedMimeType === 'application/vnd.ms-powerpoint' || normalizedMimeType.includes('presentationml') || ['ppt', 'pptx', 'pps', 'ppsx'].includes(extension)) return 'presentation';
  if (normalizedMimeType.includes('spreadsheet') || normalizedMimeType.includes('excel') || normalizedMimeType === 'text/csv' || ['csv', 'xls', 'xlsx'].includes(extension)) return 'spreadsheet';
  if (normalizedMimeType.startsWith('text/') || normalizedMimeType === 'application/json' || normalizedMimeType === 'application/xml') return 'text';
  if (normalizedMimeType.includes('zip') || normalizedMimeType.includes('compressed') || normalizedMimeType.includes('archive') || normalizedMimeType.includes('tar') || normalizedMimeType.includes('rar') || normalizedMimeType.includes('7z')) return 'archive';
  if (normalizedMimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  return 'file';
}

function getFileIconToneClass(kind: FileIconKind): string {
  if (kind === 'pdf') return 'bg-red-500/10 text-red-600 ring-1 ring-red-500/15 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20';
  if (kind === 'word') return 'bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/15 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/20';
  if (kind === 'presentation') return 'bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/15 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/20';
  if (kind === 'spreadsheet') return 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/15 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20';
  if (kind === 'html') return 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/15 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20';
  if (kind === 'markdown') return 'bg-slate-500/10 text-slate-700 ring-1 ring-slate-500/15 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/20';
  if (kind === 'image') return 'bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/15 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20';
  if (kind === 'video') return 'bg-fuchsia-500/10 text-fuchsia-600 ring-1 ring-fuchsia-500/15 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 dark:ring-fuchsia-400/20';
  if (kind === 'audio') return 'bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/15 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/20';
  if (kind === 'archive') return 'bg-yellow-500/10 text-yellow-700 ring-1 ring-yellow-500/15 dark:bg-yellow-400/10 dark:text-yellow-300 dark:ring-yellow-400/20';
  return 'bg-primary/8 text-primary ring-1 ring-primary/10';
}

function FileIcon({ mimeType, fileName, className }: { mimeType: string; fileName?: string; className?: string }) {
  const kind = getFileIconKind(mimeType, fileName);
  if (kind === 'image') return <HugeiconsIcon icon={File01Icon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'video') return <HugeiconsIcon icon={FileVideoIcon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'audio') return <HugeiconsIcon icon={MusicNote04Icon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'spreadsheet') return <HugeiconsIcon icon={DatabaseIcon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'html') return <HugeiconsIcon icon={HtmlFile01Icon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'markdown') return <HugeiconsIcon icon={DocumentCodeIcon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'word') return <HugeiconsIcon icon={Doc01Icon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'presentation') return <HugeiconsIcon icon={Ppt01Icon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'archive') return <HugeiconsIcon icon={FolderLibraryIcon} className={className} data-file-icon-kind={kind} />;
  if (kind === 'pdf') return <HugeiconsIcon icon={Pdf02Icon} className={className} data-file-icon-kind={kind} />;
  return <HugeiconsIcon icon={File01Icon} className={className} data-file-icon-kind={kind} />;
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
      <FileIcon mimeType={file.mimeType} fileName={file.fileName} className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 overflow-hidden text-primary">
        <p className="text-xs truncate">{file.fileName}</p>
      </div>
    </div>
  );
}

function ArtifactFilesPopover({
  files,
  hiddenCount,
}: {
  files: AttachedFileMeta[];
  hiddenCount: number;
}) {
  const visibleFiles = useMemo(
    () => files.filter((file) => file.exists !== false && Boolean(file.filePath || file.url)),
    [files],
  );
  const totalCount = visibleFiles.length + hiddenCount;

  if (visibleFiles.length === 0) return null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 my-2 text-xs cursor-pointer font-medium text-muted-foreground surface-hover transition-colors"
          aria-label={`查看 ${totalCount} 个文件产物`}
        >
          <HugeiconsIcon icon={FolderLibraryIcon} className="h-3.5 w-3.5" />
          <span>{`查看 ${totalCount} 个文件产物`}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-[min(520px,calc(100vw-2rem))] rounded-2xl border bg-popover p-2 text-popover-foreground shadow-xl outline-none"
        >
          <div className="max-h-80 overflow-y-auto pr-1">
            <div className="space-y-1">
              {visibleFiles.map((file, index) => (
                <ArtifactFileListItem
                  key={`${file.filePath || file.url || file.fileName}-${index}`}
                  file={file}
                  index={index}
                />
              ))}
            </div>
          </div>
          {hiddenCount > 0 && (
            <div className="border-t px-2 pt-2 mt-2 text-xs text-muted-foreground">
              {`仅显示前 ${visibleFiles.length} 个，另有 ${hiddenCount} 个未显示`}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ArtifactFileListItem({ file, index }: { file: AttachedFileMeta; index: number }) {
  const iconKind = getFileIconKind(file.mimeType, file.fileName);
  const handleOpenFile = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (file.url) {
      await invokeIpc('shell:openExternal', file.url);
      return;
    }
    if (file.filePath) {
      await openLocalPath(file.filePath, file.fileName);
    }
  }, [file.fileName, file.filePath, file.url]);

  const handleOpenFolder = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (file.filePath) {
      await openContainingFolder(file.filePath);
    }
  }, [file.filePath]);

  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-muted/65',
        index % 2 === 1 && 'bg-muted/35',
      )}
      data-artifact-file-row=""
      data-row-tone={index % 2 === 1 ? 'alternate' : 'base'}
    >
      <div
        className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', getFileIconToneClass(iconKind))}
        data-file-icon-tone={iconKind}
      >
        <FileIcon mimeType={file.mimeType} fileName={file.fileName} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{file.fileName}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground surface-hover"
          onClick={handleOpenFile}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          打开文件
        </button>
        {file.filePath && (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground surface-hover"
            onClick={handleOpenFolder}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            打开目录
          </button>
        )}
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
    <div className="chat-markdown prose max-h-[22rem] max-w-none overflow-y-auto pr-2 text-[14px] leading-6 text-[#5f5753] [scrollbar-gutter:stable] [&_code]:rounded-[4px] [&_code]:bg-[#f3eeea] [&_code]:px-1 [&_h1]:my-0 [&_h1]:text-[1rem] [&_h1]:font-semibold [&_h1]:leading-6 [&_h1+*]:mt-2.5 [&_h2]:my-0 [&_h2]:text-[0.95rem] [&_h2]:font-semibold [&_h2]:leading-6 [&_h2+*]:mt-2 [&_h3]:my-0 [&_h3]:text-[0.9rem] [&_h3]:font-semibold [&_h3]:leading-6 [&_h3+*]:mt-2 [&_h4]:my-0 [&_h4]:text-[0.85rem] [&_h4]:font-semibold [&_h4]:leading-5 [&_h4+*]:mt-1.5 [&_h5]:my-0 [&_h5]:text-[0.8rem] [&_h5]:font-semibold [&_h5]:leading-5 [&_h5+*]:mt-1.5 [&_h6]:my-0 [&_h6]:text-[0.75rem] [&_h6]:font-semibold [&_h6]:leading-5 [&_h6+*]:mt-1.5 [&_ol]:my-2 [&_ol]:ps-5 [&_ol>li]:ps-1 [&_p]:m-0 [&_p+p]:mt-2.5 [&_pre]:rounded-[12px] [&_pre]:border [&_pre]:border-[#ebe2dc] [&_pre]:bg-[#f8f4f1] [&_pre]:px-3.5 [&_pre]:py-3 [&_ul]:my-2 [&_ul]:ps-4 [&_ul>li]:ps-1">
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

const EVOLUTION_PROPOSAL_AUTO_REJECT_MS = 60 * 60 * 1000;
const TOOL_GROUP_COLLAPSE_START_DELAY_MS = 16;
const TOOL_GROUP_COLLAPSE_ANIMATION_MS = 220;

type ToolGroupTransitionMode = 'idle' | 'manual-expanding' | 'manual-collapsing' | 'auto-collapsing';

function normalizeTimestampToMs(timestamp?: number): number | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return undefined;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatToolGroupSummaryLabel(
  part: AssistantDisplayToolGroupPart,
  preferZh: boolean,
): string {
  const labels = part.summaryParts.slice(0, 3).map((summaryPart, index) => {
    if (preferZh) {
      const prefix = index === 0 ? '已' : '';
      switch (summaryPart.category) {
        case 'edit_files':
          return `${prefix}编辑 ${summaryPart.count} 个文件`;
        case 'execute_commands':
          return `${prefix}运行 ${summaryPart.count} 条命令`;
        case 'read_files':
          return `${prefix}读取 ${summaryPart.count} 个文件`;
        case 'web_access':
          return `${prefix}发起 ${summaryPart.count} 次网络请求`;
        case 'generic_tools':
          return `${prefix}调用 ${summaryPart.count} 个工具`;
        default:
          return `${prefix}${summaryPart.label}`;
      }
    }

    switch (summaryPart.category) {
      case 'edit_files':
        return `Edited ${summaryPart.count} ${summaryPart.count === 1 ? 'file' : 'files'}`;
      case 'execute_commands':
        return `Ran ${summaryPart.count} ${summaryPart.count === 1 ? 'command' : 'commands'}`;
      case 'read_files':
        return `Read ${summaryPart.count} ${summaryPart.count === 1 ? 'file' : 'files'}`;
      case 'web_access':
        return `Made ${summaryPart.count} ${summaryPart.count === 1 ? 'web request' : 'web requests'}`;
      case 'generic_tools':
        return `Used ${summaryPart.count} ${summaryPart.count === 1 ? 'tool' : 'tools'}`;
      default:
        return summaryPart.label;
    }
  });

  if (labels.length > 0) {
    return labels.join(preferZh ? '，' : ', ');
  }

  return part.summary;
}

function ToolGroupCard({
  part,
  timestamp,
}: {
  part: AssistantDisplayToolGroupPart;
  timestamp?: number;
}) {
  const { i18n } = useTranslation('chat');
  const preferZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const isSingleItem = part.items.length === 1;
  const displaySummary = useMemo(
    () => formatToolGroupSummaryLabel(part, preferZh),
    [part, preferZh],
  );
  const previousCollapsedRef = useRef(part.collapsed);
  const groupStateKey = useMemo(
    () => JSON.stringify({
      collapsed: part.collapsed,
      items: part.items.map((item) => ({ id: item.id, status: item.status })),
    }),
    [part.collapsed, part.items],
  );
  const previousGroupStateKeyRef = useRef(groupStateKey);
  const transitionSyncTimerRef = useRef<number | null>(null);
  const transitionStartTimerRef = useRef<number | null>(null);
  const transitionFinishTimerRef = useRef<number | null>(null);
  const [childrenMounted, setChildrenMounted] = useState(() => !part.collapsed);
  const [childrenExpanded, setChildrenExpanded] = useState(() => !part.collapsed);
  const [transitionMode, setTransitionMode] = useState<ToolGroupTransitionMode>('idle');

  const clearTransitionTimers = useCallback(() => {
    if (transitionSyncTimerRef.current !== null) {
      window.clearTimeout(transitionSyncTimerRef.current);
      transitionSyncTimerRef.current = null;
    }
    if (transitionStartTimerRef.current !== null) {
      window.clearTimeout(transitionStartTimerRef.current);
      transitionStartTimerRef.current = null;
    }
    if (transitionFinishTimerRef.current !== null) {
      window.clearTimeout(transitionFinishTimerRef.current);
      transitionFinishTimerRef.current = null;
    }
  }, []);

  const syncExpandedTransitionState = useCallback(() => {
    setTransitionMode('idle');
    setChildrenMounted(true);
    setChildrenExpanded(true);
  }, []);

  const syncCollapsedTransitionState = useCallback(() => {
    setTransitionMode('idle');
    setChildrenMounted(false);
    setChildrenExpanded(false);
  }, []);

  const startCollapseTransition = useCallback((mode: 'manual-collapsing' | 'auto-collapsing') => {
    clearTransitionTimers();
    setTransitionMode(mode);
    setChildrenMounted(true);
    setChildrenExpanded(true);

    transitionStartTimerRef.current = window.setTimeout(() => {
      setChildrenExpanded(false);
    }, TOOL_GROUP_COLLAPSE_START_DELAY_MS);
    transitionFinishTimerRef.current = window.setTimeout(() => {
      setChildrenMounted(false);
      setTransitionMode('idle');
    }, TOOL_GROUP_COLLAPSE_START_DELAY_MS + TOOL_GROUP_COLLAPSE_ANIMATION_MS);
  }, [clearTransitionTimers]);

  const startExpandTransition = useCallback(() => {
    clearTransitionTimers();
    setTransitionMode('manual-expanding');
    setChildrenMounted(true);
    setChildrenExpanded(false);

    transitionStartTimerRef.current = window.setTimeout(() => {
      setChildrenExpanded(true);
    }, TOOL_GROUP_COLLAPSE_START_DELAY_MS);
    transitionFinishTimerRef.current = window.setTimeout(() => {
      setTransitionMode('idle');
    }, TOOL_GROUP_COLLAPSE_START_DELAY_MS + TOOL_GROUP_COLLAPSE_ANIMATION_MS);
  }, [clearTransitionTimers]);

  useEffect(() => {
    const wasCollapsed = previousCollapsedRef.current;
    const previousGroupStateKey = previousGroupStateKeyRef.current;
    previousCollapsedRef.current = part.collapsed;
    previousGroupStateKeyRef.current = groupStateKey;

    if (!part.collapsed) {
      clearTransitionTimers();
      transitionSyncTimerRef.current = window.setTimeout(() => {
        syncExpandedTransitionState();
      }, 0);
      return;
    }

    if (!wasCollapsed) {
      transitionSyncTimerRef.current = window.setTimeout(() => {
        startCollapseTransition('auto-collapsing');
      }, 0);
      return;
    }

    if (previousGroupStateKey !== groupStateKey) {
      clearTransitionTimers();
      transitionSyncTimerRef.current = window.setTimeout(() => {
        syncCollapsedTransitionState();
      }, 0);
    }
  }, [
    clearTransitionTimers,
    groupStateKey,
    part.collapsed,
    startCollapseTransition,
    syncCollapsedTransitionState,
    syncExpandedTransitionState,
  ]);

  useEffect(() => clearTransitionTimers, [clearTransitionTimers]);

  const renderToolItems = useCallback(() => (
    <>
      {part.items.map((item) => (
        <ToolCard
          key={item.id}
          name={item.name}
          input={item.input}
          status={item.status}
          durationMs={item.durationMs}
          result={item.result}
          timestamp={item.timestamp ?? timestamp}
        />
      ))}
    </>
  ), [part.items, timestamp]);

  if (isSingleItem && !part.collapsed && transitionMode === 'idle') {
    const [item] = part.items;
    return (
      <ToolCard
        name={item.name}
        input={item.input}
        status={item.status}
        durationMs={item.durationMs}
        result={item.result}
        timestamp={item.timestamp ?? timestamp}
      />
    );
  }

  if (!part.collapsed && transitionMode === 'idle') {
    return (
      <div className="flex w-full max-w-[30rem] flex-col">
        {renderToolItems()}
      </div>
    );
  }

  const isAutoCollapsing = transitionMode === 'auto-collapsing';
  const isExpanding = transitionMode === 'manual-expanding';
  const isCollapsing = transitionMode === 'manual-collapsing' || isAutoCollapsing;
  const isExpanded = childrenMounted && childrenExpanded;
  const showChildren = childrenMounted;
  const showSummary = part.collapsed || isCollapsing;
  const summaryVisible = !isAutoCollapsing || !childrenExpanded;
  const groupVisualState = isExpanding
    ? 'expanding'
    : isCollapsing
      ? 'collapsing'
      : isExpanded
        ? 'expanded'
        : 'collapsed';
  const SummaryRoot = 'button';

  return (
    <div
      className="flex w-full max-w-[30rem] flex-col gap-1"
      data-tool-group-state={groupVisualState}
    >
      {showSummary && (
        <SummaryRoot
          type="button"
          onClick={() => {
            if (transitionMode !== 'idle') {
              return;
            }
            if (childrenMounted && childrenExpanded) {
              startCollapseTransition('manual-collapsing');
              return;
            }
            startExpandTransition();
          }}
          aria-expanded={isExpanded}
          className={cn(
            'group/tool-group inline-flex max-w-full items-center gap-1 rounded-lg py-1.5 text-left text-xs text-muted-foreground/50',
            'cursor-pointer focus:outline-none transition-[opacity,transform] duration-200 ease-out',
            summaryVisible ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0 pointer-events-none',
          )}
          aria-label={displaySummary}
        >
          <span className="truncate" title={displaySummary}>
            {displaySummary}
          </span>
          <span
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-opacity',
              isExpanded ? 'opacity-100' : 'opacity-0 group-hover/tool-group:opacity-100',
            )}
            aria-hidden="true"
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        </SummaryRoot>
      )}

      {showChildren && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
            childrenExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            {renderToolItems()}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCard({
  name,
  status,
  durationMs,
  result,
  input,
  timestamp,
}: {
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  result?: string;
  input?: unknown;
  timestamp?: number;
}) {
  const { i18n } = useTranslation('chat');
  const preferZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const [open, setOpen] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const currentDesktopSessionId = useChatStore((state) => state.currentDesktopSessionId);
  const desktopSessions = useChatStore((state) => state.desktopSessions);
  const setEvolutionProposalDecision = useChatStore((state) => state.setEvolutionProposalDecision);
  const duration = formatDuration(durationMs);
  const isRunning = status === 'running';
  const isError = status === 'error';
  const evolutionProposalCard = useMemo(
    () => extractEvolutionProposalCardData(name, input, result),
    [input, name, result],
  );
  const proposalTimestampMs = useMemo(() => normalizeTimestampToMs(timestamp), [timestamp]);
  const currentDesktopSession = useMemo(
    () => desktopSessions.find((session) => session.id === currentDesktopSessionId),
    [currentDesktopSessionId, desktopSessions],
  );
  const persistedProposalDecision = useMemo(() => {
    if (!evolutionProposalCard?.proposalId) {
      return undefined;
    }
    const persistedEntry = currentDesktopSession?.proposalStateEntries?.find(
      (entry) => entry.proposalId === evolutionProposalCard.proposalId,
    );
    if (persistedEntry) {
      return persistedEntry.decision;
    }
    if (typeof proposalTimestampMs === 'number' && (renderedAt - proposalTimestampMs) >= EVOLUTION_PROPOSAL_AUTO_REJECT_MS) {
      return 'rejected';
    }
    return undefined;
  }, [currentDesktopSession?.proposalStateEntries, evolutionProposalCard?.proposalId, proposalTimestampMs, renderedAt]);
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
        persistedDecision={persistedProposalDecision === 'approved' ? 'approve' : persistedProposalDecision === 'rejected' ? 'reject' : undefined}
        onPersistDecision={(proposalId, decision) => setEvolutionProposalDecision(proposalId, decision === 'approve' ? 'approved' : 'rejected')}
        expiresAtMs={typeof proposalTimestampMs === 'number' ? proposalTimestampMs + EVOLUTION_PROPOSAL_AUTO_REJECT_MS : undefined}
      />
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'group/tool relative flex min-w-0 max-w-[30rem] flex-col overflow-hidden rounded-lg text-sm transition-colors mb-1',
          !isRunning && !isError && 'text-muted-foreground/80',
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
              {!isRunning && !isError && <HugeiconsIcon icon={toolIcon} className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
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
