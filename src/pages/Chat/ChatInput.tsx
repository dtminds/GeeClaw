/**
 * Chat Input Component
 * Rich text composer with inline skill tokens, file upload, and agent routing.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { EditorContent, Node as TiptapNode, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Square, X, FileText, Film, Music, FileArchive, File, Loader2, ArrowUp, Plus, Package2, Search, ChevronDown, Check, Shield, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc, toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { buildProviderListItems, hasConfiguredCredentials } from '@/lib/provider-accounts';
import { getConfiguredProviderModels, getProviderIconUrl, shouldInvertInDark } from '@/lib/providers';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/providers';
import { useSkillsStore } from '@/stores/skills';
import {
  buildProviderModelRef,
  getModelDisplayLabel,
  isModelMenuItemSelected,
  pendingModelSelectionMatchesSession,
} from './model-selection';
import type { SecurityPolicy } from '@/stores/settings';
import type { AgentSummary } from '@/types/agent';
import type { Skill } from '@/types/skill';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { findRecentAssistantMessageWithReliableUsage, formatTokenCount, getContextOccupancyInfo } from './message-usage';
import { findSkillKeywordRecommendation } from './skill-recommendations';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  disabled?: boolean;
  disabledPlaceholder?: string;
  sending?: boolean;
  isEmpty?: boolean;
}

interface SlashSkillQuery {
  query: string;
  from: number;
  to: number;
  allowCommands: boolean;
}

interface SerializedNode {
  type?: string;
  text?: string;
  attrs?: {
    slug?: string | null;
    id?: string | null;
    label?: string | null;
    skillPath?: string | null;
  };
  content?: SerializedNode[];
}

interface ParsedSkillReference {
  slug: string;
  skillPath: string | null;
  explicitMarker: boolean;
}

interface SlashQueryState {
  selection: {
    empty: boolean;
    from: number;
    $from: {
      parentOffset: number;
      parent: {
        textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
      };
    };
  };
}

interface ProviderModelMenuGroup {
  runtimeProviderId: string;
  providerName: string;
  icon: string;
  iconUrl?: string;
  shouldInvertIcon: boolean;
  models: string[];
  isDefault: boolean;
}

interface SafetyComposerSettings {
  workspaceOnly: boolean;
  securityPolicy: SecurityPolicy;
}

interface SlashCommandOption {
  id: string;
  value: string;
  nameKey: string;
  descriptionKey: string;
  type: 'command';
}

type SlashPickerItem = Skill | SlashCommandOption;

const SLASH_COMMANDS: SlashCommandOption[] = [
  {
    id: 'new',
    value: '/new',
    nameKey: 'composer.slashCommands.commands.new.name',
    descriptionKey: 'composer.slashCommands.commands.new.description',
    type: 'command',
  },
  {
    id: 'compact',
    value: '/compact',
    nameKey: 'composer.slashCommands.commands.compact.name',
    descriptionKey: 'composer.slashCommands.commands.compact.description',
    type: 'command',
  },
  {
    id: 'status',
    value: '/status',
    nameKey: 'composer.slashCommands.commands.session_status.name',
    descriptionKey: 'composer.slashCommands.commands.session_status.description',
    type: 'command',
  },
  {
    id: 'stop',
    value: '/stop',
    nameKey: 'composer.slashCommands.commands.stop.name',
    descriptionKey: 'composer.slashCommands.commands.stop.description',
    type: 'command',
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function normalizeAgentMention(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/^@+/, '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^\w-]/g, '');
}

function normalizeSkillSearch(value: string): string {
  return value
    .normalize('NFKD')
    .trim()
    .toLowerCase();
}

function resolveLeadingAgentMention(
  text: string,
  agents: AgentSummary[],
  currentAgentId: string,
): { targetAgentId: string | null; text: string } {
  const match = text.match(/^\s*@([^\s]+)\s*(.*)$/s);
  if (!match) {
    return { targetAgentId: null, text };
  }

  const mention = normalizeAgentMention(match[1]);
  const target = agents.find((agent) => {
    if (agent.id === currentAgentId) return false;
    return normalizeAgentMention(agent.id) === mention || normalizeAgentMention(agent.name) === mention;
  });

  if (!target) {
    return { targetAgentId: null, text };
  }

  return {
    targetAgentId: target.id,
    text: match[2] ?? '',
  };
}

function extractLeadingAgentMentionQuery(text: string): string | null {
  const match = text.match(/^\s*@([^\s]*)$/);
  if (!match) {
    return null;
  }

  return normalizeAgentMention(match[1] ?? '');
}

function resolveSkillMarkerPath(skill: Pick<Skill, 'filePath' | 'baseDir'>): string | null {
  const filePath = skill.filePath?.trim();
  if (filePath) {
    return filePath;
  }

  const baseDir = skill.baseDir?.trim();
  if (!baseDir) {
    return null;
  }

  return baseDir.endsWith('/SKILL.md') || baseDir.endsWith('\\SKILL.md')
    ? baseDir
    : `${baseDir.replace(/[\\/]+$/, '')}/SKILL.md`;
}

function insertSkillTokenIntoEditor(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  skill: Skill,
  position: 'cursor' | 'start' = 'cursor',
) {
  const chain = editor.chain();

  if (position === 'start') {
    chain.focus('start');
  } else {
    chain.focus();
  }

  chain
    .insertContent([
      {
        type: 'skillToken',
        attrs: {
          id: skill.id,
          label: skill.name,
          slug: skill.slug || skill.id,
          skillPath: resolveSkillMarkerPath(skill),
        },
      },
      { type: 'text', text: ' ' },
    ])
    .run();
}

function serializeComposerNode(node: SerializedNode | null | undefined): string {
  if (!node) return '';

  if (node.type === 'text') {
    return node.text ?? '';
  }

  if (node.type === 'hardBreak') {
    return '\n';
  }

  if (node.type === 'skillToken') {
    const slug = node.attrs?.slug || node.attrs?.id || node.attrs?.label || '';
    const skillPath = node.attrs?.skillPath?.trim();
    if (!slug) {
      return '';
    }
    return skillPath ? `[[use skill: ${slug} (${skillPath})]]` : `[[use skill: ${slug}]]`;
  }

  const children = Array.isArray(node.content)
    ? node.content.map((child) => serializeComposerNode(child)).join('')
    : '';

  if (node.type === 'doc') {
    return Array.isArray(node.content)
      ? node.content.map((child) => serializeComposerNode(child)).join('\n')
      : '';
  }

  return children;
}

const INLINE_SKILL_REFERENCE_RE = /\[\[use skill:\s*([^(]+?)(?:\s*\(([^)]+)\))?\]\]|(^|[\s([{"'“‘])\/([a-z0-9][a-z0-9._-]*)(?=$|[\s)\]},"'.!?;:，。！？；：、”’])/giu;

function normalizeSkillReference(value: string): string {
  return normalizeSkillSearch(value).replace(/^\/+/, '');
}

function findSkillByReference(reference: string, skills: Skill[]): Skill | null {
  const normalizedReference = normalizeSkillReference(reference);
  if (!normalizedReference) {
    return null;
  }

  return skills.find((skill) => (
    [skill.slug, skill.id, skill.name]
      .map((value) => normalizeSkillReference(value ?? ''))
      .some((candidate) => candidate === normalizedReference)
  )) ?? null;
}

function createSkillTokenNodeFromReference(
  reference: ParsedSkillReference,
  skills: Skill[],
): SerializedNode | null {
  const normalizedSlug = reference.slug.trim();
  if (!normalizedSlug) {
    return null;
  }

  const matchedSkill = findSkillByReference(normalizedSlug, skills);
  if (!matchedSkill && !reference.explicitMarker) {
    return null;
  }

  return {
    type: 'skillToken',
    attrs: {
      id: matchedSkill?.id ?? normalizedSlug,
      label: matchedSkill?.name ?? normalizedSlug,
      slug: matchedSkill?.slug || matchedSkill?.id || normalizedSlug,
      skillPath: reference.skillPath ?? (matchedSkill ? resolveSkillMarkerPath(matchedSkill) : null),
    },
  };
}

function parseLineIntoComposerNodes(line: string, skills: Skill[]): SerializedNode[] {
  if (!line) {
    return [];
  }

  const nodes: SerializedNode[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(INLINE_SKILL_REFERENCE_RE)) {
    const [fullMatch = '', markerSlug, markerPath, slashPrefix = '', slashSlug] = match;
    const matchIndex = match.index ?? 0;
    const matchedAsMarker = Boolean(markerSlug);

    if (matchIndex > lastIndex) {
      nodes.push({ type: 'text', text: line.slice(lastIndex, matchIndex) });
    }

    if (matchedAsMarker) {
      const tokenNode = createSkillTokenNodeFromReference({
        slug: markerSlug.trim(),
        skillPath: markerPath?.trim() || null,
        explicitMarker: true,
      }, skills);

      if (tokenNode) {
        nodes.push(tokenNode);
      } else {
        nodes.push({ type: 'text', text: fullMatch });
      }
    } else {
      if (slashPrefix) {
        nodes.push({ type: 'text', text: slashPrefix });
      }

      const tokenNode = createSkillTokenNodeFromReference({
        slug: slashSlug.trim(),
        skillPath: null,
        explicitMarker: false,
      }, skills);

      if (tokenNode) {
        nodes.push(tokenNode);
      } else {
        nodes.push({ type: 'text', text: `/${slashSlug}` });
      }
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < line.length) {
    nodes.push({ type: 'text', text: line.slice(lastIndex) });
  }

  return nodes;
}

function createComposerDocumentFromPlainText(text: string, skills: Skill[] = []): SerializedNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: parseLineIntoComposerNodes(line, skills),
    })),
  };
}

function getPastedSkillContent(text: string, skills: Skill[]): SerializedNode[] | null {
  if (!text || (!text.includes('[[use skill:') && !text.includes('/'))) {
    return null;
  }

  const parsedDocument = createComposerDocumentFromPlainText(text, skills);
  const parsedParagraphs = Array.isArray(parsedDocument.content) ? parsedDocument.content : [];
  const hasParsedSkillToken = parsedParagraphs.some((node) => (
    Array.isArray(node.content) && node.content.some((child) => child.type === 'skillToken')
  ));

  if (!hasParsedSkillToken) {
    return null;
  }

  if (parsedParagraphs.length === 1) {
    return parsedParagraphs[0]?.content ?? null;
  }

  return parsedParagraphs;
}

function extractSlashSkillQueryFromState(state: SlashQueryState): SlashSkillQuery | null {
  const { selection } = state;
  if (!selection.empty) {
    return null;
  }

  const { $from, from } = selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const match = textBefore.match(/(^|\s)\/([^\s/]*)$/);
  if (!match) {
    return null;
  }

  const query = match[2] ?? '';
  const slashIndex = textBefore.length - query.length - 1;
  const prefixBeforeSlash = textBefore.slice(0, Math.max(slashIndex, 0));
  return {
    query,
    from: from - query.length - 1,
    to: from,
    allowCommands: prefixBeforeSlash.trim().length === 0,
  };
}

function extractSlashSkillQueryFromEditor(editor: NonNullable<ReturnType<typeof useEditor>>): SlashSkillQuery | null {
  return extractSlashSkillQueryFromState(editor.state as SlashQueryState);
}

function isSlashCommandItem(item: SlashPickerItem): item is SlashCommandOption {
  return 'type' in item && item.type === 'command';
}

function getSlashCommandName(item: SlashCommandOption, tChat: TFunction<'chat'>): string {
  return tChat(item.nameKey);
}

function getSlashCommandDescription(item: SlashCommandOption, tChat: TFunction<'chat'>): string {
  return tChat(item.descriptionKey);
}

function getSlashPickerItemName(item: SlashPickerItem, tChat: TFunction<'chat'>): string {
  return isSlashCommandItem(item) ? getSlashCommandName(item, tChat) : item.name;
}

function getSlashPickerItemSearchValues(item: SlashPickerItem, tChat: TFunction<'chat'>): string[] {
  if (isSlashCommandItem(item)) {
    const commandValue = item.value.replace(/^\//, '');
    return [getSlashCommandName(item, tChat), item.value, commandValue, getSlashCommandDescription(item, tChat)];
  }

  return [item.name, item.slug || item.id, item.description || ''];
}

function rankSlashPickerItemsForQuery(items: SlashPickerItem[], query: string, tChat: TFunction<'chat'>): SlashPickerItem[] {
  const normalizedQuery = normalizeSkillSearch(query);

  if (!normalizedQuery) {
    return items;
  }

  return items
    .map((item) => {
      const [primary, secondary, tertiary, quaternary] = getSlashPickerItemSearchValues(item, tChat)
        .map((value) => normalizeSkillSearch(value));
      const normalizedName = primary || '';
      const normalizedSlug = secondary || '';
      const normalizedAlias = tertiary || '';
      const normalizedDescription = quaternary || '';
      const exact = normalizedName === normalizedQuery || normalizedSlug === normalizedQuery;
      const startsWith = normalizedName.startsWith(normalizedQuery) || normalizedSlug.startsWith(normalizedQuery) || normalizedAlias.startsWith(normalizedQuery);
      const includes = normalizedName.includes(normalizedQuery) || normalizedSlug.includes(normalizedQuery) || normalizedAlias.includes(normalizedQuery) || normalizedDescription.includes(normalizedQuery);

      if (!exact && !startsWith && !includes) {
        return null;
      }

      return {
        item,
        rank: exact ? 0 : startsWith ? 1 : 2,
      };
    })
    .filter((entry): entry is { item: SlashPickerItem; rank: number } => Boolean(entry))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return getSlashPickerItemName(a.item, tChat).localeCompare(getSlashPickerItemName(b.item, tChat));
    })
    .map((entry) => entry.item);
}

function getVisibleSlashItems(
  items: SlashPickerItem[],
  slashQuery: SlashSkillQuery | null,
  tChat: TFunction<'chat'>,
): SlashPickerItem[] {
  const scopedItems = slashQuery?.allowCommands
    ? items
    : items.filter((item) => !isSlashCommandItem(item));

  return rankSlashPickerItemsForQuery(scopedItems, slashQuery?.query ?? '', tChat);
}

function SkillTokenView(props: { node: { attrs: { label?: string | null; slug?: string | null; id?: string | null } } }) {
  const label = props.node.attrs.label || props.node.attrs.slug || props.node.attrs.id || 'Skill';

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-primary/10 px-1.5 py-px align-baseline text-[12px] font-medium text-primary dark:bg-primary/18 dark:text-primary"
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center text-primary/80">
        <Package2 className="h-2.5 w-2.5" />
      </span>
      <span>{label}</span>
    </NodeViewWrapper>
  );
}

const SkillToken = TiptapNode.create({
  name: 'skillToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
        renderHTML: (attributes: { id?: string | null }) => (attributes.id ? { 'data-id': attributes.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-label'),
        renderHTML: (attributes: { label?: string | null }) => (attributes.label ? { 'data-label': attributes.label } : {}),
      },
      slug: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-slug'),
        renderHTML: (attributes: { slug?: string | null }) => (attributes.slug ? { 'data-slug': attributes.slug } : {}),
      },
      skillPath: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-skill-path'),
        renderHTML: (attributes: { skillPath?: string | null }) => (
          attributes.skillPath ? { 'data-skill-path': attributes.skillPath } : {}
        ),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="skill-token"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes({ 'data-type': 'skill-token' }, HTMLAttributes),
      node.attrs.label || node.attrs.slug || node.attrs.id || 'Skill',
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillTokenView);
  },
});

// ── Component ────────────────────────────────────────────────────

export const ChatInput = memo(function ChatInput({
  onSend,
  onStop,
  disabled = false,
  disabledPlaceholder,
  sending = false,
  isEmpty = false,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const tRef = useRef(t);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [slashQuery, setSlashQuery] = useState<SlashSkillQuery | null>(null);
  const [skillPickerDismissed, setSkillPickerDismissed] = useState(false);
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0);
  const [dismissedSkillRecommendationKey, setDismissedSkillRecommendationKey] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [pendingModelSelection, setPendingModelSelection] = useState<string | null>(null);
  const [safetySettings, setSafetySettings] = useState<SafetyComposerSettings | null>(null);
  const [savingSafety, setSavingSafety] = useState(false);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const availableSlashItemsRef = useRef<SlashPickerItem[]>([]);
  const availableSkillsRef = useRef<Skill[]>([]);
  const targetAgentIdRef = useRef<string | null>(null);
  const editorTextRef = useRef('');
  const skillPickerDismissedRef = useRef(false);
  const highlightedSkillIndexRef = useRef(0);
  const handleSendRef = useRef<() => void>(() => {});
  const handleSlashItemSelectRef = useRef<(item: SlashPickerItem, queryOverride?: SlashSkillQuery | null) => void>(() => {});
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const skills = useSkillsStore((s) => s.skills);
  const skillsLoading = useSkillsStore((s) => s.loading);
  const fetchSkills = useSkillsStore((s) => s.fetchSkills);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerVendors = useProviderStore((s) => s.vendors);
  const defaultProviderAccountId = useProviderStore((s) => s.defaultAccountId);
  const providerSnapshotLoading = useProviderStore((s) => s.loading);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const pendingComposerSeed = useChatStore((s) => s.pendingComposerSeed);
  const consumePendingComposerSeed = useChatStore((s) => s.consumePendingComposerSeed);
  const currentSecurityPolicy = safetySettings?.securityPolicy ?? 'moderate';

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const setTargetAgentIdState = useCallback((value: string | null) => {
    targetAgentIdRef.current = value;
    setTargetAgentId(value);
  }, []);

  const setSkillPickerDismissedState = useCallback((value: boolean) => {
    skillPickerDismissedRef.current = value;
    setSkillPickerDismissed(value);
  }, []);

  const setHighlightedSkillIndexState = useCallback((value: number | ((prev: number) => number)) => {
    setHighlightedSkillIndex((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      highlightedSkillIndexRef.current = next;
      return next;
    });
  }, []);

  const syncEditorState = useCallback((editorInstance: NonNullable<ReturnType<typeof useEditor>>) => {
    const nextText = serializeComposerNode(editorInstance.getJSON() as SerializedNode);
    setEditorText(nextText);
    editorTextRef.current = nextText;
    setSlashQuery(extractSlashSkillQueryFromEditor(editorInstance));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
        strike: false,
      }),
      SkillToken,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'ProseMirror min-h-[48px] max-h-[180px] overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-2 py-2 text-[15px] leading-[24px] text-foreground outline-none',
      },
      handlePaste: (_view, event) => {
        const pastedText = event.clipboardData?.getData('text/plain') ?? '';
        const parsedContent = getPastedSkillContent(pastedText, availableSkillsRef.current);

        if (!parsedContent || parsedContent.length === 0) {
          return false;
        }

        event.preventDefault();
        editorRef.current?.chain().focus().insertContent(parsedContent).run();
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229) {
          return false;
        }

        if (event.key === 'Backspace' && !editorTextRef.current.trim() && targetAgentIdRef.current) {
          event.preventDefault();
          setTargetAgentIdState(null);
          return true;
        }

        const currentSlashQuery = extractSlashSkillQueryFromState(_view.state as SlashQueryState);
        const currentSkillPickerVisible = currentSlashQuery !== null && !skillPickerDismissedRef.current;
        const currentFilteredSlashItems = getVisibleSlashItems(availableSlashItemsRef.current, currentSlashQuery, tRef.current);
        const boundedIndex = currentFilteredSlashItems.length === 0
          ? 0
          : Math.min(highlightedSkillIndexRef.current, currentFilteredSlashItems.length - 1);
        const currentHighlightedSlashItem = currentFilteredSlashItems[boundedIndex] ?? currentFilteredSlashItems[0] ?? null;

        if (currentSkillPickerVisible) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlightedSkillIndexState((prev) => (
              currentFilteredSlashItems.length === 0 ? 0 : (prev + 1) % currentFilteredSlashItems.length
            ));
            return true;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedSkillIndexState((prev) => (
              currentFilteredSlashItems.length === 0 ? 0 : (prev - 1 + currentFilteredSlashItems.length) % currentFilteredSlashItems.length
            ));
            return true;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            setSkillPickerDismissedState(true);
            return true;
          }
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();

          if (currentSkillPickerVisible) {
            if (currentHighlightedSlashItem) {
              handleSlashItemSelectRef.current(currentHighlightedSlashItem, currentSlashQuery);
            }
            return true;
          }

          handleSendRef.current();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: editorInstance }) => {
      syncEditorState(editorInstance);
    },
    onSelectionUpdate: ({ editor: editorInstance }) => {
      setSlashQuery(extractSlashSkillQueryFromEditor(editorInstance));
    },
    onFocus: () => {
      setEditorFocused(true);
    },
    onBlur: () => {
      setEditorFocused(false);
    },
  }, []);

  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;
    editor.setEditable(!disabled);
    syncEditorState(editor);
    if (!disabled) {
      editor.commands.focus('end');
    }
  }, [disabled, editor, syncEditorState]);

  const mentionableAgents = useMemo(
    () => agents.filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );

  const resolvableSkills = useMemo(
    () => [...skills]
      .filter((skill) => skill.eligible !== false)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  );

  const availableSkills = useMemo(
    () => resolvableSkills.filter((skill) => skill.hidden !== true),
    [resolvableSkills],
  );

  const availableSlashItems = useMemo<SlashPickerItem[]>(
    () => [...SLASH_COMMANDS, ...availableSkills],
    [availableSkills],
  );

  useEffect(() => {
    availableSlashItemsRef.current = availableSlashItems;
  }, [availableSlashItems]);

  useEffect(() => {
    availableSkillsRef.current = resolvableSkills;
  }, [resolvableSkills]);

  const typedMentionQuery = useMemo(
    () => (targetAgentId ? null : extractLeadingAgentMentionQuery(editorText)),
    [editorText, targetAgentId],
  );

  const filteredMentionableAgents = useMemo(() => {
    if (!typedMentionQuery) {
      return mentionableAgents;
    }

    return mentionableAgents.filter((agent) => {
      const normalizedId = normalizeAgentMention(agent.id);
      const normalizedName = normalizeAgentMention(agent.name);
      return normalizedId.includes(typedMentionQuery) || normalizedName.includes(typedMentionQuery);
    });
  }, [mentionableAgents, typedMentionQuery]);

  const pickerVisible = typedMentionQuery !== null && filteredMentionableAgents.length > 0;

  const filteredSlashItems = useMemo(
    () => getVisibleSlashItems(availableSlashItems, slashQuery, t),
    [availableSlashItems, slashQuery, t],
  );

  const selectedTarget = useMemo(
    () => agents.find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const providerListItems = useMemo(
    () => buildProviderListItems(
      providerAccounts,
      providerStatuses,
      providerVendors,
      defaultProviderAccountId,
    ),
    [defaultProviderAccountId, providerAccounts, providerStatuses, providerVendors],
  );
  const providerModelGroups = useMemo<ProviderModelMenuGroup[]>(() => {
    const groups = new Map<string, ProviderModelMenuGroup>();

    for (const item of providerListItems) {
      if (!item.account.enabled || !hasConfiguredCredentials(item.account, item.status)) {
        continue;
      }

      const models = getConfiguredProviderModels(item.account);

      if (models.length === 0) {
        continue;
      }

      const runtimeProviderId = item.runtimeProviderId;
      const existing = groups.get(runtimeProviderId);
      if (existing) {
        existing.models = Array.from(new Set([...existing.models, ...models]));
        existing.isDefault = existing.isDefault || item.account.id === defaultProviderAccountId;
        continue;
      }

      const providerId = item.account.vendorId;
      const providerName = item.account.label || item.vendor?.name || providerId;

      groups.set(runtimeProviderId, {
        runtimeProviderId,
        providerName,
        icon: item.vendor?.icon || '🤖',
        iconUrl: getProviderIconUrl(providerId),
        shouldInvertIcon: shouldInvertInDark(providerId),
        models,
        isDefault: item.account.id === defaultProviderAccountId,
      });
    }

    return Array.from(groups.values()).sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }
      return left.providerName.localeCompare(right.providerName);
    });
  }, [defaultProviderAccountId, providerListItems]);
  const activeModelValue = pendingModelSelection ?? sessionModel;
  const activeModelLabel = getModelDisplayLabel(activeModelValue);

  const hasInlineSkillToken = editorText.includes('[[use skill:');
  const skillPickerVisible = editorFocused && slashQuery !== null && !skillPickerDismissed;
  const activeSkillRecommendation = useMemo(
    () => findSkillKeywordRecommendation({
      text: editorText,
      skills: availableSkills,
      editorFocused,
      hasInlineSkillToken,
      slashPickerActive: skillPickerVisible,
      agentPickerActive: pickerVisible,
    }),
    [
      availableSkills,
      editorFocused,
      editorText,
      hasInlineSkillToken,
      pickerVisible,
      skillPickerVisible,
    ],
  );
  const skillRecommendationVisible = Boolean(
    activeSkillRecommendation
    && activeSkillRecommendation.recommendationKey !== dismissedSkillRecommendationKey,
  );

  useEffect(() => {
    if (agents.length === 0) {
      void fetchAgents();
    }
  }, [agents.length, fetchAgents]);

  useEffect(() => {
    if (skills.length === 0 && !skillsLoading) {
      void fetchSkills();
    }
  }, [fetchSkills, skills.length, skillsLoading]);

  useEffect(() => {
    if (
      providerAccounts.length === 0
      && providerStatuses.length === 0
      && providerVendors.length === 0
      && !providerSnapshotLoading
    ) {
      void refreshProviderSnapshot();
    }
  }, [
    providerAccounts.length,
    providerSnapshotLoading,
    providerStatuses.length,
    providerVendors.length,
    refreshProviderSnapshot,
  ]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await hostApiFetch<SafetyComposerSettings & { configDir: string }>('/api/settings/safety');
        if (!cancelled) {
          setSafetySettings({
            workspaceOnly: result.workspaceOnly,
            securityPolicy: result.securityPolicy,
          });
        }
      } catch {
        // Keep chat usable even if the safety snapshot is temporarily unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPendingModelSelection(null);
  }, [currentSessionKey]);

  useEffect(() => {
    if (!currentSessionKey || sending) {
      return;
    }

    let cancelled = false;

    const loadCurrentSessionModel = async () => {
      try {
        const result = await invokeIpc(
          'gateway:rpc',
          'sessions.list',
          {},
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        if (!result.success || !result.result) {
          if (!cancelled) {
            setSessionModel(null);
          }
          return;
        }

        const rawSessions = Array.isArray(result.result.sessions) ? result.result.sessions : [];
        const matchedSession = rawSessions.find((session) => (
          typeof (session as Record<string, unknown>).key === 'string'
          && String((session as Record<string, unknown>).key) === currentSessionKey
        )) as Record<string, unknown> | undefined;
        const nextModel = typeof matchedSession?.model === 'string'
          ? matchedSession.model.trim()
          : '';

        if (!cancelled) {
          setSessionModel(nextModel || null);
          if (pendingModelSelectionMatchesSession(pendingModelSelection, nextModel)) {
            setPendingModelSelection(null);
          }
        }
      } catch {
        if (!cancelled) {
          setSessionModel(null);
        }
      }
    };

    void loadCurrentSessionModel();

    return () => {
      cancelled = true;
    };
  }, [currentSessionKey, pendingModelSelection, sending]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId || !agents.some((agent) => agent.id === targetAgentId)) {
      setTargetAgentIdState(null);
    }
  }, [agents, currentAgentId, setTargetAgentIdState, targetAgentId]);

  useEffect(() => {
    setSkillPickerDismissedState(false);
  }, [setSkillPickerDismissedState, slashQuery?.query]);

  useEffect(() => {
    if (!skillPickerVisible) return;
    setHighlightedSkillIndexState(0);
  }, [setHighlightedSkillIndexState, skillPickerVisible, slashQuery?.query]);

  useEffect(() => {
    if (highlightedSkillIndex < filteredSlashItems.length) return;
    setHighlightedSkillIndexState(Math.max(filteredSlashItems.length - 1, 0));
  }, [filteredSlashItems.length, highlightedSkillIndex, setHighlightedSkillIndexState]);

  useEffect(() => {
    if (activeSkillRecommendation) {
      return;
    }

    setDismissedSkillRecommendationKey(null);
  }, [activeSkillRecommendation]);

  const pickFiles = useCallback(async () => {
    try {
      const result = await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments((prev) => [...prev, {
          id: tempId,
          fileName,
          mimeType: '',
          fileSize: 0,
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        }]);
      }

      const staged = await hostApiFetch<Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>>('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: result.filePaths }),
      });

      setAttachments((prev) => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i += 1) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map((attachment) => (
              attachment.id === tempId
                ? { ...data, status: 'ready' as const }
                : attachment
            ));
          } else {
            updated = updated.map((attachment) => (
              attachment.id === tempId
                ? { ...attachment, status: 'error' as const, error: 'Staging failed' }
                : attachment
            ));
          }
        }
        return updated;
      });
    } catch (err) {
      setAttachments((prev) => prev.map((attachment) => (
        attachment.status === 'staging'
          ? { ...attachment, status: 'error' as const, error: String(err) }
          : attachment
      )));
    }
  }, []);

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments((prev) => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        const base64 = await readFileAsBase64(file);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
          }),
        });

        setAttachments((prev) => prev.map((attachment) => (
          attachment.id === tempId ? { ...staged, status: 'ready' as const } : attachment
        )));
      } catch (err) {
        setAttachments((prev) => prev.map((attachment) => (
          attachment.id === tempId
            ? { ...attachment, status: 'error' as const, error: String(err) }
            : attachment
        )));
      }
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every((attachment) => attachment.status === 'ready');
  const hasFailedAttachments = attachments.some((attachment) => attachment.status === 'error');
  const canSend = (editorText.trim() || attachments.length > 0) && allReady && !disabled && !sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    if (!canSend) return;

    const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready');
    const mentionTarget = targetAgentId
      ? { targetAgentId, text: editorText }
      : resolveLeadingAgentMention(editorText, agents, currentAgentId);
    const textToSend = mentionTarget.text.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    const resolvedTargetAgentId = mentionTarget.targetAgentId;

    if (!textToSend && !attachmentsToSend) return;

    setAttachments([]);
    setTargetAgentIdState(null);
    setSkillPickerDismissedState(false);
    setEditorText('');
    editorTextRef.current = '';
    setSlashQuery(null);
    editor?.commands.clearContent();
    onSend(textToSend, attachmentsToSend, resolvedTargetAgentId);
  }, [agents, attachments, canSend, currentAgentId, editor, editorText, onSend, setSkillPickerDismissedState, setTargetAgentIdState, targetAgentId]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleModelSelect = useCallback((runtimeProviderId: string, model: string) => {
    if (disabled || sending) return;
    const nextModel = buildProviderModelRef(runtimeProviderId, model);
    setPendingModelSelection(nextModel);
    onSend(`/model ${nextModel}`);
    editor?.commands.focus('end');
  }, [disabled, editor, onSend, sending]);

  const handleAgentSelect = useCallback((agent: AgentSummary) => {
    setTargetAgentIdState(agent.id);
    if (typedMentionQuery !== null) {
      editor?.commands.clearContent();
      setEditorText('');
      editorTextRef.current = '';
      setSlashQuery(null);
    }
    editor?.commands.focus('end');
  }, [editor, setTargetAgentIdState, typedMentionQuery]);

  const handleSlashItemSelect = useCallback((item: SlashPickerItem, queryOverride?: SlashSkillQuery | null) => {
    if (!editor) return;

    const activeSlashQuery = queryOverride ?? extractSlashSkillQueryFromEditor(editor) ?? slashQuery;
    if (!activeSlashQuery) return;

    if (isSlashCommandItem(item)) {
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: activeSlashQuery.from, to: activeSlashQuery.to },
          { type: 'text', text: `${item.value} ` },
        )
        .run();
    } else {
      editor
        .chain()
        .focus()
        .deleteRange({ from: activeSlashQuery.from, to: activeSlashQuery.to })
        .run();
      insertSkillTokenIntoEditor(editor, item);
    }

    setSkillPickerDismissedState(false);
    setHighlightedSkillIndexState(0);
  }, [editor, setHighlightedSkillIndexState, setSkillPickerDismissedState, slashQuery]);

  useEffect(() => {
    handleSlashItemSelectRef.current = handleSlashItemSelect;
  }, [handleSlashItemSelect]);

  const handleInsertRecommendedSkill = useCallback(() => {
    if (!editor || !activeSkillRecommendation) {
      return;
    }

    insertSkillTokenIntoEditor(editor, activeSkillRecommendation.skill, 'start');
    setDismissedSkillRecommendationKey(null);
    setSkillPickerDismissedState(false);
    setHighlightedSkillIndexState(0);
  }, [
    activeSkillRecommendation,
    editor,
    setHighlightedSkillIndexState,
    setSkillPickerDismissedState,
  ]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const pastedFiles: globalThis.File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }

    if (pastedFiles.length > 0) {
      event.preventDefault();
      void stageBufferFiles(pastedFiles);
    }
  }, [stageBufferFiles]);

  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (event.dataTransfer?.files?.length) {
      void stageBufferFiles(Array.from(event.dataTransfer.files));
    }
  }, [stageBufferFiles]);

  const editorIsEmpty = editorText.trim().length === 0;
  const policyLabelMap: Record<SecurityPolicy, string> = {
    moderate: t('composer.safety.policyOptions.moderate.label'),
    strict: t('composer.safety.policyOptions.strict.label'),
    fullAccess: t('composer.safety.policyOptions.fullAccess.label'),
  };

  const saveSafetySettings = useCallback(async (patch: Partial<SafetyComposerSettings>) => {
    setSavingSafety(true);
    try {
      const response = await hostApiFetch<{ settings: SafetyComposerSettings & { configDir: string } }>('/api/settings/safety', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      setSafetySettings({
        workspaceOnly: false,
        securityPolicy: response.settings.securityPolicy,
      });
    } catch (error) {
      toast.error(`${t('composer.safety.saveFailed')}: ${toUserMessage(error)}`);
      throw error;
    } finally {
      setSavingSafety(false);
    }
  }, [t]);

  const handleSecurityPolicyChange = useCallback(async (securityPolicy: SecurityPolicy) => {
    if (savingSafety || currentSecurityPolicy === securityPolicy) return;
    const previous = safetySettings;
    setSafetySettings((state) => ({
      workspaceOnly: state?.workspaceOnly ?? false,
      securityPolicy,
    }));
    try {
      await saveSafetySettings({ securityPolicy });
    } catch {
      setSafetySettings(previous);
    }
  }, [currentSecurityPolicy, safetySettings, saveSafetySettings, savingSafety]);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    if (!editor || !pendingComposerSeed?.text) {
      return;
    }

    editor.commands.setContent(createComposerDocumentFromPlainText(pendingComposerSeed.text, resolvableSkills));
    setAttachments([]);
    setTargetAgentIdState(null);
    setSkillPickerDismissedState(false);
    setHighlightedSkillIndexState(0);
    syncEditorState(editor);
    editor.commands.focus('end');
    consumePendingComposerSeed();
  }, [
    consumePendingComposerSeed,
    editor,
    resolvableSkills,
    pendingComposerSeed,
    setHighlightedSkillIndexState,
    setSkillPickerDismissedState,
    setTargetAgentIdState,
    syncEditorState,
  ]);

  return (
    <div
      className={cn(
        'w-full mb-2 mx-auto transition-all duration-300 px-2',
        isEmpty ? 'max-w-3xl' : 'max-w-4xl',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}

        <div className={`rounded-[20px] border border-border/60 bg-popover/98 px-1 py-1.5 transition-[border-color,box-shadow] shadow-[0_12px_30px_-12px_rgba(28,28,32,0.18)] ${dragOver ? 'border-primary/80' : 'focus-within:border-primary/25'}`}>
          <div className="relative">
            {skillPickerVisible && (
              <div className="absolute bottom-full left-0 right-0 z-20 mb-4 overflow-hidden rounded-[22px] border border-black/8 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-card">
                <div className="px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-2 text-muted-foreground/80">
                    <Search className="h-3.5 w-3.5 shrink-0" />
                    <span className={cn('truncate', slashQuery?.query ? 'text-foreground' : 'text-muted-foreground/70')}>
                      {slashQuery?.query || t('composer.skillSearchPlaceholder')}
                    </span>
                  </div>
                </div>
                <div className="mt-1 max-h-50 overflow-y-auto pr-2">
                  {filteredSlashItems.length > 0 ? (
                    filteredSlashItems.map((item, index) => (
                      <SkillPickerItem
                        key={isSlashCommandItem(item) ? `command-${item.id}` : item.id}
                        item={item}
                        selected={index === highlightedSkillIndex}
                        onSelect={() => handleSlashItemSelect(item)}
                      />
                    ))
                  ) : (
                    <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                      {skillsLoading ? t('composer.skillPickerLoading') : t('composer.skillPickerEmpty')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {skillRecommendationVisible && activeSkillRecommendation && (
              <div className="absolute bottom-full left-1/2 z-10 mb-2.5 w-[min(calc(100%-1.5rem),400px)] -translate-x-1/2 overflow-hidden rounded-[16px] border border-black/6 bg-white/92 pl-4 pr-2 py-1.5 shadow-[0_8px_22px_rgba(15,23,42,0.06)] backdrop-blur-sm dark:border-white/8 dark:bg-card/92">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {t('composer.skillRecommendation.title', { skill: activeSkillRecommendation.skill.name })}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleInsertRecommendedSkill}
                    className="h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium shadow-none"
                  >
                    {t('composer.skillRecommendation.action')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setDismissedSkillRecommendationKey(activeSkillRecommendation.recommendationKey)}
                    className="surface-hover-strong h-7 w-7 shrink-0 rounded-full p-0 text-muted-foreground shadow-none"
                    aria-label={t('composer.skillRecommendation.dismiss')}
                    title={t('composer.skillRecommendation.dismiss')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <div
              className="relative"
              onPaste={handlePaste}
            >
              {selectedTarget && (
                <div className="px-2 pb-0.5 pt-0">
                  <button
                    type="button"
                    onClick={() => setTargetAgentId(null)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/14"
                    title={t('composer.clearTarget')}
                  >
                    <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                    <X className="h-3.5 w-3.5 text-primary/70" />
                  </button>
                </div>
              )}

              {pickerVisible && (
                <div className="absolute bottom-full left-3 z-20 mb-3 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card">
                  <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
                    {t('composer.agentPickerTitle')}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {filteredMentionableAgents.map((agent) => (
                      <AgentPickerItem
                        key={agent.id}
                        agent={agent}
                        selected={agent.id === targetAgentId}
                        onSelect={() => handleAgentSelect(agent)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="relative min-h-[72px]">
                {editorIsEmpty && (
                  <div className="pointer-events-none absolute inset-x-2 top-2 text-sm leading-[24px] text-muted-foreground/40">
                    {disabled ? (disabledPlaceholder || t('composer.gatewayDisconnectedPlaceholder')) : t('composer.placeholder')}
                  </div>
                )}
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2.5 px-0.5">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="surface-hover-strong h-8 w-8 shrink-0 rounded-full text-muted-foreground transition-colors"
                onClick={pickFiles}
                disabled={disabled || sending}
                title={t('composer.attachFiles')}
              >
                <Plus className="h-4 w-4" />
              </Button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    className="surface-hover h-8 max-w-[220px] shrink-0 rounded-full px-3 text-xs text-muted-foreground/80 transition-colors"
                    disabled={disabled || sending || providerModelGroups.length === 0}
                    title={activeModelValue ? `${t('composer.modelMenuTitle')}: ${activeModelValue}` : t('composer.modelMenuTitle')}
                  >
                    <span className="truncate">{activeModelLabel || t('composer.modelMenuLabel')}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-20" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="top"
                    align="start"
                    sideOffset={8}
                    className="z-50 min-w-[210px] overflow-hidden rounded-xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none data-[side=top]:animate-in data-[side=top]:slide-in-from-bottom-2 dark:border-white/10 dark:bg-card"
                  >
                    {providerModelGroups.map((group, index) => (
                      <div key={group.runtimeProviderId}>
                        {index > 0 && (
                          <DropdownMenu.Separator className="mx-2 my-0.5 h-px bg-black/6 dark:bg-white/8" />
                        )}
                        <DropdownMenu.Label className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55">
                          <span className="truncate">{group.providerName}</span>
                        </DropdownMenu.Label>
                        {group.models.map((model) => (
                          <DropdownMenu.Item
                            key={`${group.runtimeProviderId}-${model}`}
                            onSelect={() => handleModelSelect(group.runtimeProviderId, model)}
                            className="mx-1 flex cursor-default items-center justify-between rounded-lg px-2 py-1.5 text-[13px] text-foreground outline-none transition-colors focus:bg-accent/60"
                          >
                            <span className="truncate">{model}</span>
                            {isModelMenuItemSelected(activeModelValue, group.runtimeProviderId, model) && (
                              <Check className="ml-3 h-3.5 w-3.5 shrink-0" />
                            )}
                          </DropdownMenu.Item>
                        ))}
                      </div>
                    ))}
                    {providerModelGroups.length === 0 && (
                      <DropdownMenu.Item
                        disabled
                        className="flex cursor-default items-center rounded-xl px-3 py-2 text-[13px] text-muted-foreground outline-none"
                      >
                        {t('composer.modelMenuEmpty')}
                      </DropdownMenu.Item>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>

            <Button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? !canStop : !canSend}
              size="icon"
              className={cn(
                'h-8 w-8 shrink-0 rounded-full transition-colors',
                sending || canSend
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'surface-muted text-muted-foreground/70 hover:bg-accent/50',
              )}
              variant="ghost"
              title={sending ? t('composer.stop') : t('composer.send')}
            >
              {sending ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
              )}
            </Button>
          </div>
        </div>

        <div className="mt-2.5 px-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-2 text-[11px] text-muted-foreground/60">
          <span>{t('composer.tip')}</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1.5">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    disabled={disabled || savingSafety}
                    className="inline-flex items-center gap-1.5 px-0.5 py-1 text-[11px] font-medium text-muted-foreground/75 transition-colors hover:text-foreground disabled:opacity-50"
                    aria-label={t('composer.safety.policy')}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>{t('composer.safety.policy')} · {policyLabelMap[currentSecurityPolicy]}</span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="top"
                    align="end"
                    sideOffset={8}
                    className="z-50 min-w-[168px] overflow-hidden rounded-xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none dark:border-white/10 dark:bg-card"
                  >
                    {(['moderate', 'strict', 'fullAccess'] as SecurityPolicy[]).map((policy) => (
                      <DropdownMenu.Item
                        key={policy}
                        onSelect={() => { void handleSecurityPolicyChange(policy); }}
                        className="mx-1 flex cursor-default items-start justify-between gap-3 rounded-lg px-2 py-2 text-[13px] text-foreground outline-none transition-colors focus:bg-accent/60"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{policyLabelMap[policy]}</div>
                          <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {t(`composer.safety.policyOptions.${policy}.description`)}
                          </div>
                        </div>
                        {currentSecurityPolicy === policy && (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        )}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            <ContextOccupancyIndicator />
            {hasFailedAttachments && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-[11px]"
                onClick={() => {
                  setAttachments((prev) => prev.filter((attachment) => attachment.status !== 'error'));
                  void pickFiles();
                }}
              >
                Retry failed attachments
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

ChatInput.displayName = 'ChatInput';

const ContextOccupancyIndicator = memo(function ContextOccupancyIndicator() {
  const { t } = useTranslation('chat');
  const messages = useChatStore((s) => s.messages);
  const currentSessionTokenInfo = useChatStore((s) => (
    s.currentSessionKey ? s.sessionTokenInfoByKey[s.currentSessionKey] ?? null : null
  ));

  const contextOccupancy = useMemo(() => {
    const latestReliableAssistantMessage = findRecentAssistantMessageWithReliableUsage(messages);
    return getContextOccupancyInfo(latestReliableAssistantMessage, currentSessionTokenInfo?.contextTokens);
  }, [currentSessionTokenInfo?.contextTokens, messages]);

  const occupancyPercentLabel = `${contextOccupancy.percent < 10 ? contextOccupancy.percent.toFixed(1) : Math.round(contextOccupancy.percent)}%`;
  const donutRadius = 10;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutOffset = donutCircumference * (1 - contextOccupancy.percent / 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center text-foreground/55 transition-transform duration-200 hover:scale-[1.06]"
          aria-label={t('composer.contextUsage.ariaLabel', { percent: occupancyPercentLabel })}
        >
          <svg viewBox="0 0 28 28" className="h-4.5 w-4.5 -rotate-90">
            <circle
              cx="14"
              cy="14"
              r={donutRadius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-black/10 dark:text-white/12"
            />
            <circle
              cx="14"
              cy="14"
              r={donutRadius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={donutCircumference}
              strokeDashoffset={donutOffset}
              className="text-primary transition-all duration-300"
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal text-xs leading-5">
        <div className="space-y-1.5">
          <div className="font-medium text-foreground">{t('composer.contextUsage.tooltipTitle')}</div>
          <div className="flex items-center justify-between gap-4">
            <span>{t('composer.contextUsage.lastRoundTotal')}</span>
            <span className="font-medium text-foreground">{formatTokenCount(contextOccupancy.lastRoundTotalTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>{t('composer.contextUsage.cache')}</span>
            <span className="font-medium text-foreground">{formatTokenCount(contextOccupancy.cacheTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>{t('composer.contextUsage.limit')}</span>
            <span className="font-medium text-foreground">
              {typeof contextOccupancy.contextLimitTokens === 'number'
                ? formatTokenCount(contextOccupancy.contextLimitTokens)
                : t('composer.contextUsage.unknown')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>{t('composer.contextUsage.ratio')}</span>
            <span className="font-medium text-foreground">{occupancyPercentLabel}</span>
          </div>
          {currentSessionTokenInfo?.totalTokensFresh === false && (
            <div className="pt-1 text-muted-foreground">{t('composer.contextUsage.stale')}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

ContextOccupancyIndicator.displayName = 'ContextOccupancyIndicator';

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'surface-hover',
      )}
    >
      <span className="text-[14px] font-medium text-foreground">{agent.name}</span>
      <span className="text-[11px] text-muted-foreground">{agent.id}</span>
    </button>
  );
}

function SkillPickerItem({
  item,
  selected,
  onSelect,
}: {
  item: SlashPickerItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('skills');
  const { t: tChat } = useTranslation('chat');
  const isCommand = isSlashCommandItem(item);
  const source = isCommand ? '' : (item.source || '').trim().toLowerCase();
  let sourceLabel = tChat('composer.slashCommands.commandBadge');
  const itemName = isCommand ? getSlashCommandName(item, tChat) : item.name;
  const itemDescription = isCommand ? getSlashCommandDescription(item, tChat) : item.description || `/${item.slug || item.id}`;

  if (!isCommand) {
    sourceLabel = item.isCore
      ? t('detail.coreSystem', { defaultValue: 'Core System' })
      : item.isBundled
        ? t('source.badge.bundled', { defaultValue: 'Bundled' })
        : source === 'agents-skills-personal'
          ? t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' })
          : source === 'agents-skills-project'
            ? t('source.badge.agentsProject', { defaultValue: 'Project .agents' })
            : source === 'openclaw-extra'
              ? t('source.badge.extra', { defaultValue: 'Extra dirs' })
              : source === 'openclaw-managed'
                ? t('source.badge.managed', { defaultValue: 'Managed' })
                : t('source.badge.unknown', { defaultValue: 'Skill' });
  }

  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'surface-muted text-foreground' : 'surface-hover',
      )}
    >
      <span className={cn(
        'flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground',
        selected
          ? 'text-foreground'
          : 'text-muted-foreground',
      )}>
        {isCommand ? <Terminal className="h-3.5 w-3.5" /> : <Package2 className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex flex-1 items-baseline gap-2 overflow-hidden">
        <span className="shrink-0 truncate text-[13px] font-medium text-foreground">{itemName}</span>
        <span className="truncate text-[11px] text-muted-foreground">{itemDescription}</span>
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
        {sourceLabel}
      </span>
    </button>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-lg border border-border">
      {isImage ? (
        <div className="w-16 h-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
        </div>
      )}

      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-[10px] text-destructive font-medium px-1">Error</span>
        </div>
      )}

      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
