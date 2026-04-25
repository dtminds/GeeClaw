import { AppError } from '@/lib/error-model';
import {
  cleanUserMessageText,
  renderSkillMarkersAsPlainText,
} from '@/lib/chat-message-text';
import type { DesktopSessionSummary, RawMessage } from './model';
import type { ChatState, ChatViewMode } from './state';
import {
  getLatestMessagePreview,
  getMessageText,
  hasPersistedOptimisticUserCopy,
  toMs,
} from './utils';

export const CHAT_HISTORY_STARTUP_UNAVAILABLE_CODE = 'CHAT_HISTORY_STARTUP_UNAVAILABLE';
export const CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const OPTIMISTIC_MATCH_THRESHOLD_MS = 5000;
const MAX_SESSION_TITLE_LENGTH = 50;

export type HistoryRequestSnapshot = {
  sessionKey: string;
  desktopSessionId: string;
  viewMode: ChatViewMode;
  cronRunId: string;
  generation: number;
};

type HistoryRequestState = Pick<
  ChatState,
  | 'currentSessionKey'
  | 'currentDesktopSessionId'
  | 'currentViewMode'
  | 'selectedCronRun'
  | 'historyRequestGeneration'
>;

type OptimisticUserState = Pick<
  ChatState,
  | 'sending'
  | 'lastUserMessageAt'
  | 'messages'
  | 'pendingOptimisticUserId'
  | 'pendingOptimisticUserAnchorAt'
  | 'pendingOptimisticUserIndex'
>;

export type DesktopSessionMetadataSync = {
  session: DesktopSessionSummary;
  patch: {
    title?: string;
    updatedAt?: number;
    lastMessagePreview?: string;
  };
};

export function createHistoryRequestSnapshot(state: HistoryRequestState): HistoryRequestSnapshot {
  return {
    sessionKey: state.currentSessionKey,
    desktopSessionId: state.currentDesktopSessionId,
    viewMode: state.currentViewMode,
    cronRunId: state.selectedCronRun?.id ?? '',
    generation: state.historyRequestGeneration,
  };
}

export function getHistoryRequestKey(request: HistoryRequestSnapshot): string {
  return `${request.sessionKey}::${request.desktopSessionId}::${request.viewMode}::${request.cronRunId}::${request.generation}`;
}

export function isSameHistoryRequest(
  request: HistoryRequestSnapshot,
  state: HistoryRequestState,
): boolean {
  return (
    state.currentSessionKey === request.sessionKey
    && state.currentDesktopSessionId === request.desktopSessionId
    && state.currentViewMode === request.viewMode
    && (state.selectedCronRun?.id ?? '') === request.cronRunId
    && state.historyRequestGeneration === request.generation
  );
}

function getHistoryStartupErrorCode(error: unknown): string | undefined {
  if (error instanceof AppError) {
    const code = error.details?.gatewayErrorCode;
    return typeof code === 'string' ? code : undefined;
  }
  if (error && typeof error === 'object') {
    const code = (error as { gatewayErrorCode?: unknown }).gatewayErrorCode;
    if (typeof code === 'string') {
      return code;
    }
    const detailsCode = (error as { details?: { gatewayErrorCode?: unknown } }).details?.gatewayErrorCode;
    return typeof detailsCode === 'string' ? detailsCode : undefined;
  }
  return undefined;
}

export function isHistoryUnavailableDuringGatewayStartup(error: unknown): boolean {
  const structuredCode = getHistoryStartupErrorCode(error);
  if (structuredCode === CHAT_HISTORY_STARTUP_UNAVAILABLE_CODE) {
    return true;
  }
  return String(error).toLowerCase().includes('chat.history unavailable during gateway startup');
}

function findRecentOptimisticUserMessage(messages: RawMessage[], userMsgAtMs: number): RawMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === 'user'
      && message.timestamp != null
      && Math.abs(toMs(message.timestamp) - userMsgAtMs) < OPTIMISTIC_MATCH_THRESHOLD_MS
    ) {
      return message;
    }
  }
  return undefined;
}

export function appendPendingOptimisticUserMessage(
  historyMessages: RawMessage[],
  state: OptimisticUserState,
): RawMessage[] {
  const userMsgAt = state.lastUserMessageAt;
  if (!state.sending || userMsgAt == null) {
    return historyMessages;
  }

  const userMsMs = toMs(userMsgAt);
  const optimistic = state.pendingOptimisticUserId
    ? state.messages.find((message) => message.id === state.pendingOptimisticUserId)
    : findRecentOptimisticUserMessage(state.messages, userMsMs);
  const optimisticCurrentIndex = optimistic ? state.messages.indexOf(optimistic) : -1;
  const isConversationStart = optimisticCurrentIndex >= 0
    && !state.messages.slice(0, optimisticCurrentIndex).some(
      (message) => message.role === 'user' || message.role === 'assistant',
    );

  if (optimistic && !hasPersistedOptimisticUserCopy(
    historyMessages,
    optimistic,
    state.pendingOptimisticUserAnchorAt,
    isConversationStart,
    state.pendingOptimisticUserIndex ?? (optimisticCurrentIndex >= 0 ? optimisticCurrentIndex : null),
  )) {
    return [...historyMessages, optimistic];
  }

  return historyMessages;
}

export function buildDesktopSessionMetadataSync(
  session: DesktopSessionSummary | undefined,
  messages: RawMessage[],
): DesktopSessionMetadataSync | null {
  if (!session) {
    return null;
  }

  let nextTitle = session.title;
  const nextLastMessagePreview = getLatestMessagePreview(messages);
  const firstUserMsg = messages.find((message) => message.role === 'user');
  if (firstUserMsg && !nextTitle.trim()) {
    const labelText = renderSkillMarkersAsPlainText(cleanUserMessageText(getMessageText(firstUserMsg.content)));
    if (labelText) {
      nextTitle = labelText.length > MAX_SESSION_TITLE_LENGTH
        ? `${labelText.slice(0, MAX_SESSION_TITLE_LENGTH)}…`
        : labelText;
    }
  }

  const lastMsg = messages[messages.length - 1];
  const lastAt = lastMsg?.timestamp != null ? toMs(lastMsg.timestamp) : undefined;
  const needsTitleUpdate = nextTitle !== session.title;
  const needsPreviewUpdate = nextLastMessagePreview !== session.lastMessagePreview;
  const needsUpdatedAt = typeof lastAt === 'number' && lastAt !== session.updatedAt;

  if (!needsTitleUpdate && !needsPreviewUpdate && !needsUpdatedAt) {
    return null;
  }

  const patch = {
    ...(needsTitleUpdate ? { title: nextTitle } : {}),
    ...(needsPreviewUpdate ? { lastMessagePreview: nextLastMessagePreview } : {}),
    ...(needsUpdatedAt && typeof lastAt === 'number' ? { updatedAt: lastAt } : {}),
  };

  return {
    patch,
    session: {
      ...session,
      title: nextTitle,
      lastMessagePreview: nextLastMessagePreview,
      updatedAt: typeof lastAt === 'number' ? lastAt : session.updatedAt,
    },
  };
}

export type CronRunMessagesResponse = {
  messages?: RawMessage[];
};
