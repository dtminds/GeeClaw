import type { CronAgentRunSummary } from '@/types/cron';
import type {
  AttachedFileMeta,
  ContentBlock,
  DesktopSessionSummary,
  ProposalDecisionEntry,
  RawMessage,
  SessionTokenInfo,
  ToolStatus,
  ToolStreamEntry,
} from './model';

export interface PendingComposerSeed {
  text: string;
  nonce: number;
  tokenizableSkillSlugs?: string[];
}

export type ChatViewMode = 'session' | 'cron';

export type ChatMessageAttachmentInput = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
};

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingTextStartedAt: number | null;
  streamingTextLastEventAt: number | null;
  streamSegments: Array<{ text: string; ts: number }>;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  toolMessages: RawMessage[];
  toolResultHistoryReloadedIds: Set<string>;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  pendingOptimisticUserId: string | null;
  pendingOptimisticUserAnchorAt: number | null;
  pendingOptimisticUserIndex: number | null;
  historyRequestGeneration: number;
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
  loadDesktopSessionSummaries: () => Promise<void>;
  openAgentMainSession: (agentId: string) => Promise<void>;
  switchSession: (key: string) => void;
  openCronRun: (run: CronAgentRunSummary) => Promise<void>;
  newSession: () => Promise<void>;
  newTemporarySession: (agentId?: string) => Promise<void>;
  deleteSession: (key: string) => Promise<void>;
  renameSession: (desktopSessionId: string, title: string) => Promise<void>;
  cleanupEmptySession: () => Promise<void>;
  loadHistory: (quiet?: boolean, mode?: 'default' | 'tool_patch') => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: ChatMessageAttachmentInput[],
    targetAgentId?: string | null,
  ) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  handleAgentEvent: (event: Record<string, unknown>) => void;
  handleAgentDeleted: (agentId: string) => Promise<void>;
  toggleThinking: () => void;
  toggleToolCalls: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  queueComposerSeed: (text: string, tokenizableSkillSlugs?: string[]) => void;
  consumePendingComposerSeed: () => void;
  setEvolutionProposalDecision: (proposalId: string, decision: 'approved' | 'rejected') => Promise<void>;
}

type ChatActionKeys =
  | 'loadSessions'
  | 'loadDesktopSessionSummaries'
  | 'openAgentMainSession'
  | 'switchSession'
  | 'openCronRun'
  | 'newSession'
  | 'newTemporarySession'
  | 'deleteSession'
  | 'renameSession'
  | 'cleanupEmptySession'
  | 'loadHistory'
  | 'sendMessage'
  | 'abortRun'
  | 'handleChatEvent'
  | 'handleAgentEvent'
  | 'handleAgentDeleted'
  | 'toggleThinking'
  | 'toggleToolCalls'
  | 'refresh'
  | 'clearError'
  | 'queueComposerSeed'
  | 'consumePendingComposerSeed'
  | 'setEvolutionProposalDecision';

export type ChatDataState = Omit<ChatState, ChatActionKeys>;

export type ToolRuntimeState = Pick<
  ChatState,
  | 'streamingText'
  | 'streamingTextStartedAt'
  | 'streamingTextLastEventAt'
  | 'streamSegments'
  | 'toolStreamById'
  | 'toolStreamOrder'
  | 'toolMessages'
  | 'toolResultHistoryReloadedIds'
>;

export type ConversationResetState = Pick<
  ChatState,
  | 'messages'
  | keyof ToolRuntimeState
  | 'activeRunId'
  | 'error'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingOptimisticUserId'
  | 'pendingOptimisticUserAnchorAt'
  | 'pendingOptimisticUserIndex'
  | 'pendingToolImages'
  | 'pendingToolHiddenCount'
>;

export function createEmptyToolRuntimeState(): ToolRuntimeState {
  return {
    streamingText: '',
    streamingTextStartedAt: null,
    streamingTextLastEventAt: null,
    streamSegments: [],
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    toolMessages: [],
    toolResultHistoryReloadedIds: new Set<string>(),
  };
}

export function createConversationResetState(): ConversationResetState {
  return {
    messages: [],
    ...createEmptyToolRuntimeState(),
    activeRunId: null,
    error: null,
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingOptimisticUserId: null,
    pendingOptimisticUserAnchorAt: null,
    pendingOptimisticUserIndex: null,
    pendingToolImages: [],
    pendingToolHiddenCount: 0,
  };
}

export function createChatInitialState(): ChatDataState {
  return {
    messages: [],
    loading: false,
    error: null,

    sending: false,
    activeRunId: null,
    ...createEmptyToolRuntimeState(),
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingOptimisticUserId: null,
    pendingOptimisticUserAnchorAt: null,
    pendingOptimisticUserIndex: null,
    historyRequestGeneration: 0,
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
  };
}

export type {
  AttachedFileMeta,
  ContentBlock,
  DesktopSessionSummary,
  ProposalDecisionEntry,
  RawMessage,
  SessionTokenInfo,
  ToolStatus,
  ToolStreamEntry,
};
