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
} from '@/lib/chat-message-text';
import type { CronAgentRunSummary } from '@/types/cron';
import {
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  extractRawFilePaths,
  hydrateHistoryMessagesForDisplay,
  limitAttachedFilesForMessage,
  loadMissingPreviews,
  makeAttachedFile,
  prepareHistoryMessagesForDisplay,
  upsertImageCacheEntry,
} from './chat/history';
import type {
  AttachedFileMeta,
  ContentBlock,
  DesktopSessionSummary,
  RawMessage,
  SessionTokenInfo,
  ToolStatus,
  ToolStreamEntry,
} from './chat/model';
import {
  hasNonToolAssistantContent,
  isErroredToolResult,
  isToolOnlyMessage,
  isToolResultRole,
  looksLikeToolErrorText,
  mergeToolStatus,
  parseDurationMs,
} from './chat/tool-status';
import {
  extractTextFromRuntimeMessage,
  extractToolOutputText,
  getLatestMessagePreview,
  getMessageText,
  getToolCallInput,
  hasEquivalentFinalAssistantMessage,
  shouldExtractRawFilePathsForTool,
  stripRenderedPrefixFromStreamingText,
  toSessionPreview,
  toMs,
} from './chat/utils';
import { useAgentsStore } from './agents';
import { useGatewayStore } from './gateway';

export type {
  AttachedFileMeta,
  ContentBlock,
  DesktopSessionSummary,
  GatewaySessionSummary,
  RawMessage,
  SessionTokenInfo,
  ToolStatus,
} from './chat/model';
export {
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  extractRawFilePaths,
  hydrateHistoryMessagesForDisplay,
  limitAttachedFilesForMessage,
  loadMissingPreviews,
  prepareHistoryMessagesForDisplay,
} from './chat/history';
export {
  hasEquivalentFinalAssistantMessage,
  stripRenderedPrefixFromStreamingText,
} from './chat/utils';

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
  loadDesktopSessionSummaries: () => Promise<void>;
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
  handleAgentDeleted: (agentId: string) => Promise<void>;
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

const DESKTOP_SESSIONS_API = '/api/desktop-sessions';

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

function reconcilePreferredMainSession(
  desktopSessions: DesktopSessionSummary[],
  options: {
    previousGatewayKey: string;
    previousDesktopSessionId: string;
    previousIsDraft: boolean;
    previousDesktopSessions: DesktopSessionSummary[];
    preferredMainSessionKey: string;
  },
): DesktopSessionSummary[] {
  const {
    previousGatewayKey,
    previousDesktopSessionId,
    previousIsDraft,
    previousDesktopSessions,
    preferredMainSessionKey,
  } = options;

  const previousSelectedSession = previousIsDraft
    ? undefined
    : previousDesktopSessions.find((session) =>
      session.id === previousDesktopSessionId
      || session.gatewaySessionKey === previousGatewayKey,
    );

  if (
    previousSelectedSession
    && isMainSessionKey(previousSelectedSession.gatewaySessionKey)
    && previousSelectedSession.gatewaySessionKey === preferredMainSessionKey
    && !desktopSessions.some((session) =>
      session.id === previousSelectedSession.id
      || session.gatewaySessionKey === previousSelectedSession.gatewaySessionKey,
    )
  ) {
    // Keep the explicitly opened agent main session selected when the next
    // list refresh momentarily lags behind session creation.
    return [previousSelectedSession, ...desktopSessions];
  }

  return desktopSessions;
}

async function fetchReconciledDesktopSessions(options: {
  preferredAgentId: string;
  previousGatewayKey: string;
  previousDesktopSessionId: string;
  previousIsDraft: boolean;
  previousDesktopSessions: DesktopSessionSummary[];
}): Promise<{
  desktopSessions: DesktopSessionSummary[];
  preferredMainSessionKey: string;
}> {
  const {
    preferredAgentId,
    previousGatewayKey,
    previousDesktopSessionId,
    previousIsDraft,
    previousDesktopSessions,
  } = options;

  const preferredMainSessionKey = resolveMainSessionKeyForAgent(preferredAgentId);
  if (!preferredMainSessionKey) {
    throw new Error(`Missing main session key for agent ${preferredAgentId}`);
  }

  const desktopSessions = reconcilePreferredMainSession(await fetchDesktopSessions(), {
    previousGatewayKey,
    previousDesktopSessionId,
    previousIsDraft,
    previousDesktopSessions,
    preferredMainSessionKey,
  });

  return {
    desktopSessions,
    preferredMainSessionKey,
  };
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
      const previousDesktopSessions = get().desktopSessions;
      let desktopSessions: DesktopSessionSummary[] = [];
      let preferredMainSessionKey = '';
      let sessionTokenInfoByKey = get().sessionTokenInfoByKey;
      try {
        sessionTokenInfoByKey = await fetchSessionTokenInfoByKey();
      } catch (gatewayError) {
        console.warn('Failed to load gateway session token info:', gatewayError);
      }
      const defaultAgentId = useAgentsStore.getState().defaultAgentId || 'main';
      const preferredAgentId = get().currentAgentId || defaultAgentId;
      ({ desktopSessions, preferredMainSessionKey } = await fetchReconciledDesktopSessions({
        preferredAgentId,
        previousGatewayKey,
        previousDesktopSessionId,
        previousIsDraft,
        previousDesktopSessions,
      }));

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

  loadDesktopSessionSummaries: async () => {
    try {
      const previousGatewayKey = get().currentSessionKey;
      const previousDesktopSessionId = get().currentDesktopSessionId;
      const previousIsDraft = get().isDraftSession;
      const previousDesktopSessions = get().desktopSessions;
      const defaultAgentId = useAgentsStore.getState().defaultAgentId || 'main';
      const preferredAgentId = get().currentAgentId || defaultAgentId;
      const { desktopSessions } = await fetchReconciledDesktopSessions({
        preferredAgentId,
        previousGatewayKey,
        previousDesktopSessionId,
        previousIsDraft,
        previousDesktopSessions,
      });

      set({ desktopSessions });
    } catch (err) {
      console.warn('Failed to load desktop session summaries:', err);
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
    const { currentDesktopSessionId, desktopSessions, messages } = get();
    if (!currentDesktopSessionId || messages.length > 0) return;
    if (desktopSessions.length <= 1) return;
    const currentSession = desktopSessions.find((session) => session.id === currentDesktopSessionId);
    if (!currentSession || isMainSessionKey(currentSession.gatewaySessionKey)) return;
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

      // Cache image attachments BEFORE the IPC call to avoid race condition:
      // history may reload (via Gateway event) before the RPC returns.
      // Keyed by staged file path which appears in [media attached: <path> ...].
      if (hasMedia && attachments) {
        for (const a of attachments) {
          upsertImageCacheEntry(a.stagedPath, {
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            preview: a.preview,
          });
        }
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

  handleAgentDeleted: async (agentId: string) => {
    const { currentAgentId, currentSessionKey } = get();
    const activeAgentId = currentSessionKey
      ? getAgentIdFromSessionKey(currentSessionKey)
      : currentAgentId;

    if (agentId !== currentAgentId && agentId !== activeAgentId) {
      return;
    }

    const agentsState = useAgentsStore.getState();
    const fallbackCandidates = [
      agentsState.defaultAgentId,
      ...agentsState.agents.map((agent) => agent.id),
      'main',
    ].filter(Boolean) as string[];
    const fallbackAgentId = fallbackCandidates.find((id) => id !== agentId) ?? 'main';

    await get().openAgentMainSession(fallbackAgentId);
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
