import { DEFAULT_SESSION_KEY, type ChatState } from './types';
import { createRuntimeActions } from './runtime-actions';
import { createSessionHistoryActions } from './session-history-actions';
import type { ChatGet, ChatSet } from './store-api';

export const initialChatState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingTextStartedAt'
  | 'streamSegments'
  | 'toolStreamById'
  | 'toolStreamOrder'
  | 'toolMessages'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingToolImages'
  | 'pendingToolHiddenCount'
  | 'sessions'
  | 'currentSessionKey'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'showThinking'
  | 'thinkingLevel'
> = {
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingTextStartedAt: null,
  streamSegments: [],
  toolStreamById: new Map(),
  toolStreamOrder: [],
  toolMessages: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],
  pendingToolHiddenCount: 0,

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  sessionLabels: {},
  sessionLastActivity: {},

  showThinking: false,
  thinkingLevel: null,
};

export function createChatActions(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatState,
  | 'loadSessions'
  | 'switchSession'
  | 'newSession'
  | 'deleteSession'
  | 'cleanupEmptySession'
  | 'loadHistory'
  | 'sendMessage'
  | 'abortRun'
  | 'handleChatEvent'
  | 'handleAgentEvent'
  | 'toggleThinking'
  | 'refresh'
  | 'clearError'
> {
  return {
    ...createSessionHistoryActions(set, get),
    ...createRuntimeActions(set, get),
  };
}
