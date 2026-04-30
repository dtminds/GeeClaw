/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { GATEWAY_INCOMPLETE_TURN_ERROR_CODE } from '../../shared/chat-errors';
import {
  renderSkillMarkersAsPlainText,
} from '@/lib/chat-message-text';
import type { CronAgentRunSummary } from '@/types/cron';
import {
  extractImagesAsAttachedFiles,
  extractAssistantInlineArtifactFiles,
  extractMediaDirectiveSources,
  extractMediaRefs,
  extractRawFilePaths,
  extractToolInputArtifactRefs,
  hydrateHistoryMessagesForDisplay,
  limitAttachedFilesForMessage,
  loadMissingPreviews,
  makeAttachedFileFromMediaSource,
  makeAttachedFile,
  prepareHistoryMessagesForDisplay,
  upsertImageCacheEntry,
} from './chat/history';
import type {
  AttachedFileMeta,
  ContentBlock,
  DesktopSessionSummary,
  ProposalDecisionEntry,
  RawMessage,
  ToolStatus,
} from './chat/model';
import {
  createChatInitialState,
  createConversationResetState,
  createEmptyToolRuntimeState,
  createRunResetState,
} from './chat/state';
import type { ChatMessageAttachmentInput, ChatState, QueuedChatMessage } from './chat/state';
import {
  buildCronRunSessionKey,
  buildDefaultMainSessionKey,
  buildTemporarySessionKey,
  getAgentIdFromSessionKey,
} from './chat/session-keys';
import {
  createDesktopSessionRequest,
  deleteDesktopSessionRequest,
  fetchDesktopSessions,
  fetchSessionTokenInfoByKey,
  updateDesktopSessionRequest,
} from './chat/api';
import {
  hasNonToolAssistantContent,
  isErroredToolResult,
  isToolOnlyMessage,
  isToolResultRole,
  looksLikeToolErrorText,
  mergeToolStatus,
  parseDurationMs,
  upsertToolStatuses,
} from './chat/tool-status';
import {
  buildOrderedLiveAssistantContentBlocks,
  buildToolStreamMessage,
  collectLiveToolStatuses,
  hasRunningLiveToolMessages,
  mergeHistoryToolStatusesIntoMessages,
  mergeToolStatusesIntoEquivalentAssistantMessage,
  normalizeFinalAssistantContentBlocks,
  patchToolRuntimeWithHistory,
  reconcileToolRuntimeWithHistory,
  syncToolMessages,
} from './chat/live-runtime';
import {
  extractTextFromRuntimeMessage,
  extractToolOutputText,
  getLatestTerminalAssistantRunError,
  getMessageErrorMessage,
  getMessageText,
  getMessageStopReason,
  getRunErrorFromPayloads,
  getToolCallInput,
  hasEquivalentFinalAssistantMessage,
  isInternalMessage,
  isTerminalAssistantErrorMessage,
  shouldExtractRawFilePathsForTool,
  stripRenderedPrefixFromStreamingText,
  toSessionPreview,
  toMs,
} from './chat/utils';
import {
  appendPendingOptimisticUserMessage,
  buildDesktopSessionMetadataSync,
  CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS,
  createHistoryRequestSnapshot,
  getHistoryRequestKey,
  isHistoryUnavailableDuringGatewayStartup,
  isSameHistoryRequest,
} from './chat/history-actions';
import type { CronRunMessagesResponse } from './chat/history-actions';
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
  isInternalMessage,
  stripRenderedPrefixFromStreamingText,
} from './chat/utils';

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where the current live text may be empty while
// tool cards are still streaming.
let _lastChatEventAt = 0;

// Timer for fallback history polling during active sends.
// If no streaming events arrive within a few seconds, we periodically
// poll chat.history to surface intermediate tool-call turns.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;
let _historyStartupRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _historyStartupRetryState: { requestKey: string; attempt: number; mode: 'default' | 'tool_patch' } | null = null;

// Timer for delayed error finalization. When the Gateway reports a mid-stream
// error (e.g. "terminated"), it may retry internally and recover. We wait
// before committing the error to give the recovery path a chance.
let _errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

// A chat.send RPC can resolve after the user has already pressed stop. Track
// send generations so stale completions cannot re-bind the UI to an aborted run.
let _sendGeneration = 0;

let _runtimeSubscriptionGeneration = 0;
let _subscribedMessagesSessionKey: string | null = null;
let _sessionToolFallbackSubscribed = false;
let _sessionToolFallbackUnsubscribeTimer: ReturnType<typeof setTimeout> | null = null;
let _queuedMessageFlushTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_ABORTED_RUN_IDS = 50;
const MAX_BLOCKED_RUN_EVENTS = 100;
const MAX_SEEN_TOOL_EVENTS = 500;
const MAX_RUN_SCOPED_SUBSCRIBED_RUN_IDS = 200;
const CHAT_SEND_TIMEOUT_MS = 120_000;
type BlockedRunEvent =
  | { kind: 'chat'; event: Record<string, unknown> }
  | { kind: 'tool'; event: Record<string, unknown> };
const _abortedRunIds = new Set<string>();
const _abortedRunIdOrder: string[] = [];
const _ignoredSteerAckRunIds = new Set<string>();
const _ignoredSteerAckRunIdOrder: string[] = [];
let _blockUnknownAbortedRunEvents = false;
const _blockedRunEvents = new Map<string, BlockedRunEvent[]>();
const _seenToolEventKeys = new Set<string>();
const _seenToolEventKeyOrder: string[] = [];
const _runScopedSubscribedRunIds = new Set<string>();
const _runScopedSubscribedRunIdOrder: string[] = [];
let _awaitingSteeredRunAdoption = false;

function logChatTrace(_event: string, _details?: Record<string, unknown>): void {}


function getRuntimeErrorCode(event: Record<string, unknown>): string | null {
  const directCode = event['errorCode'] ?? event['error_code'];
  if (typeof directCode === 'string' && directCode.trim()) return directCode.trim();
  const message = event['message'];
  if (!message || typeof message !== 'object') return null;
  const messageRecord = message as Record<string, unknown>;
  const messageCode = messageRecord['errorCode'] ?? messageRecord['error_code'];
  return typeof messageCode === 'string' && messageCode.trim() ? messageCode.trim() : null;
}

function getLocalizedRuntimeErrorMessage(event: Record<string, unknown>): string {
  if (getRuntimeErrorCode(event) === GATEWAY_INCOMPLETE_TURN_ERROR_CODE) {
    return i18n.t('chat:runError.incompleteTurn');
  }
  return String(
    event['errorMessage']
    || getMessageErrorMessage(event['message'])
    || i18n.t('chat:runError.generic'),
  );
}

function getLocalizedRunPayloadErrorMessage(error: string): string {
  if (error === GATEWAY_INCOMPLETE_TURN_ERROR_CODE) {
    return getLocalizedRuntimeErrorMessage({ errorCode: error });
  }
  return error || i18n.t('chat:runError.generic');
}

function summarizeChatSelection(
  state: Pick<ChatState, 'currentSessionKey' | 'currentDesktopSessionId' | 'currentAgentId' | 'isDraftSession' | 'currentViewMode'>,
): Record<string, unknown> {
  return {
    currentSessionKey: state.currentSessionKey,
    currentDesktopSessionId: state.currentDesktopSessionId,
    currentAgentId: state.currentAgentId,
    isDraftSession: state.isDraftSession,
    currentViewMode: state.currentViewMode,
  };
}

function isMainSessionKey(sessionKey: string): boolean {
  const agentId = getAgentIdFromSessionKey(sessionKey);
  return sessionKey === resolveMainSessionKeyForAgent(agentId);
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

function clearHistoryStartupRetryTimer(): void {
  if (_historyStartupRetryTimer) {
    clearTimeout(_historyStartupRetryTimer);
    _historyStartupRetryTimer = null;
  }
}

function clearHistoryStartupRetry(): void {
  clearHistoryStartupRetryTimer();
  _historyStartupRetryState = null;
}

function clearSessionToolFallbackUnsubscribeTimer(): void {
  if (_sessionToolFallbackUnsubscribeTimer) {
    clearTimeout(_sessionToolFallbackUnsubscribeTimer);
    _sessionToolFallbackUnsubscribeTimer = null;
  }
}

function clearQueuedMessageFlushTimer(): void {
  if (_queuedMessageFlushTimer) {
    clearTimeout(_queuedMessageFlushTimer);
    _queuedMessageFlushTimer = null;
  }
}

function getCurrentRuntimeSessionKey(state: Pick<ChatState, 'currentSessionKey' | 'currentViewMode'>): string {
  return state.currentViewMode === 'session' ? state.currentSessionKey : '';
}

async function rpcBestEffort(method: string, params?: unknown): Promise<unknown | null> {
  try {
    return await useGatewayStore.getState().rpc(method, params);
  } catch {
    return null;
  }
}

function hasActiveGatewayRun(row: Record<string, unknown> | undefined): boolean {
  if (!row) return false;
  return row.status === 'running'
    || row.hasActiveSubagentRun === true
    || row.subagentRunState === 'active';
}

async function resolveSessionHasActiveRun(sessionKey: string): Promise<boolean> {
  const result = await rpcBestEffort('sessions.list', {
    includeGlobal: true,
    includeUnknown: true,
    activeMinutes: 120,
  });
  if (!result || typeof result !== 'object') return false;
  const sessions = Array.isArray((result as Record<string, unknown>).sessions)
    ? (result as Record<string, unknown>).sessions as Array<Record<string, unknown>>
    : [];
  return hasActiveGatewayRun(sessions.find((session) => session.key === sessionKey));
}

async function unsubscribeSessionMessages(): Promise<void> {
  const previous = _subscribedMessagesSessionKey;
  if (!previous) return;
  _subscribedMessagesSessionKey = null;
  await rpcBestEffort('sessions.messages.unsubscribe', { key: previous });
}

async function subscribeSessionMessages(sessionKey: string, generation: number): Promise<void> {
  if (_subscribedMessagesSessionKey !== sessionKey) {
    await unsubscribeSessionMessages();
  }
  if (generation !== _runtimeSubscriptionGeneration) return;
  await rpcBestEffort('sessions.messages.subscribe', { key: sessionKey });
  if (generation === _runtimeSubscriptionGeneration) {
    _subscribedMessagesSessionKey = sessionKey;
  }
}

async function enableSessionToolFallback(_reason: string): Promise<void> {
  clearSessionToolFallbackUnsubscribeTimer();
  if (_sessionToolFallbackSubscribed) return;
  const result = await rpcBestEffort('sessions.subscribe', {});
  if (result !== null) {
    _sessionToolFallbackSubscribed = true;
  }
}

async function disableSessionToolFallback(_reason: string): Promise<void> {
  clearSessionToolFallbackUnsubscribeTimer();
  if (!_sessionToolFallbackSubscribed) return;
  _sessionToolFallbackSubscribed = false;
  await rpcBestEffort('sessions.unsubscribe', {});
}

function scheduleSessionToolFallbackUnsubscribe(reason: string): void {
  if (!_sessionToolFallbackSubscribed) return;
  clearSessionToolFallbackUnsubscribeTimer();
  _sessionToolFallbackUnsubscribeTimer = setTimeout(() => {
    if (shouldKeepSessionToolFallbackSubscribed()) {
      return;
    }
    void disableSessionToolFallback(reason);
  }, 3_000);
}

function shouldKeepSessionToolFallbackSubscribed(): boolean {
  const state = useChatStore.getState();
  const sessionKey = getCurrentRuntimeSessionKey(state);
  if (!sessionKey) return false;
  return state.sending
    || state.sendAckPending
    || !!state.activeRunId
    || state.queuedMessages.some((message) => message.kind === 'steered' || !!message.pendingRunId);
}

function getToolEventData(event: Record<string, unknown>): Record<string, unknown> {
  return event.data && typeof event.data === 'object'
    ? event.data as Record<string, unknown>
    : event;
}

function getStringField(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function getToolEventRunId(event: Record<string, unknown>): string {
  const data = getToolEventData(event);
  return getStringField(event.runId, data.runId);
}

function getToolEventSessionKey(event: Record<string, unknown>): string {
  const data = getToolEventData(event);
  return getStringField(event.sessionKey, data.sessionKey, event.key, data.key);
}

function normalizeToolPhase(value: string): string {
  switch (value) {
    case 'started':
    case 'begin':
    case 'call':
    case 'tool_call':
      return 'start';
    case 'complete':
    case 'completed':
    case 'finish':
    case 'finished':
    case 'end':
      return 'result';
    case 'delta':
    case 'partial':
    case 'progress':
      return 'update';
    default:
      return value;
  }
}

function getToolEventToolCallId(event: Record<string, unknown>): string {
  const data = getToolEventData(event);
  return getStringField(
    data.toolCallId,
    data.tool_call_id,
    data.callId,
    data.call_id,
    data.id,
    event.toolCallId,
    event.tool_call_id,
    event.callId,
    event.call_id,
    event.id,
  );
}

function getToolEventPhase(event: Record<string, unknown>): string {
  const data = getToolEventData(event);
  const phase = getStringField(data.phase, data.type, data.status, event.phase, event.type, event.status);
  return phase ? normalizeToolPhase(phase) : '';
}

function getToolEventName(event: Record<string, unknown>): string {
  const data = getToolEventData(event);
  return getStringField(
    data.name,
    data.toolName,
    data.tool_name,
    event.name,
    event.toolName,
    event.tool_name,
  );
}

function getToolEventArgs(event: Record<string, unknown>, phase: string): unknown {
  const data = getToolEventData(event);
  if (phase !== 'start') return undefined;
  return data.args ?? data.arguments ?? data.input ?? event.args ?? event.arguments ?? event.input;
}

function getToolEventRawOutput(event: Record<string, unknown>, phase: string): unknown {
  const data = getToolEventData(event);
  if (phase === 'update') {
    return data.partialResult ?? data.partial_result ?? data.delta ?? data.output ?? event.partialResult ?? event.partial_result;
  }
  if (phase === 'result') {
    return data.result ?? data.output ?? data.content ?? event.result ?? event.output ?? event.content;
  }
  return undefined;
}

function isToolEventError(event: Record<string, unknown>, output: string | undefined): boolean {
  const data = getToolEventData(event);
  return data.isError === true
    || data.is_error === true
    || event.isError === true
    || event.is_error === true
    || (output ? looksLikeToolErrorText(output) : false);
}

function getToolEventDedupeKey(event: Record<string, unknown>): string | null {
  const data = getToolEventData(event);
  const runId = getToolEventRunId(event);
  const sessionKey = getToolEventSessionKey(event);
  const toolCallId = getToolEventToolCallId(event);
  const phase = getToolEventPhase(event);
  const seqValue = data.seq ?? event.seq;
  const seq = typeof seqValue === 'string' || typeof seqValue === 'number'
    ? String(seqValue)
    : '';

  if (!toolCallId || !phase) return null;
  const scope = runId || sessionKey;
  if (!scope) return null;
  if (!seq && phase === 'update') return null;
  return [scope, toolCallId, phase, seq].join('|');
}

function rememberToolEventKey(key: string): void {
  if (_seenToolEventKeys.has(key)) return;
  _seenToolEventKeys.add(key);
  _seenToolEventKeyOrder.push(key);
  while (_seenToolEventKeyOrder.length > MAX_SEEN_TOOL_EVENTS) {
    const oldest = _seenToolEventKeyOrder.shift();
    if (oldest) _seenToolEventKeys.delete(oldest);
  }
}

function rememberRunScopedSubscribedRunId(runId: string): void {
  if (!runId) return;
  if (!_runScopedSubscribedRunIds.has(runId)) {
    _runScopedSubscribedRunIds.add(runId);
    _runScopedSubscribedRunIdOrder.push(runId);
  }
  while (_runScopedSubscribedRunIdOrder.length > MAX_RUN_SCOPED_SUBSCRIBED_RUN_IDS) {
    const oldest = _runScopedSubscribedRunIdOrder.shift();
    if (oldest) {
      _runScopedSubscribedRunIds.delete(oldest);
    }
  }
}

function getSessionMessagePayloadSessionKey(payload: Record<string, unknown>, message: RawMessage | null): string {
  const directKey = payload.key ?? payload.sessionKey;
  if (typeof directKey === 'string') return directKey;
  const messageSessionKey = message && (message as unknown as Record<string, unknown>).sessionKey;
  return typeof messageSessionKey === 'string' ? messageSessionKey : '';
}

function getSessionMessage(payload: Record<string, unknown>): RawMessage | null {
  const candidate = payload.message && typeof payload.message === 'object'
    ? payload.message
    : payload;
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  if (!record.role && record.content == null) return null;
  return record as unknown as RawMessage;
}

function messagesMatch(left: RawMessage, right: RawMessage): boolean {
  if (left.id && right.id && left.id === right.id) return true;
  if (left.role !== right.role) return false;
  const leftTimestamp = typeof left.timestamp === 'number' ? left.timestamp : null;
  const rightTimestamp = typeof right.timestamp === 'number' ? right.timestamp : null;
  if (leftTimestamp !== null && rightTimestamp !== null && Math.abs(leftTimestamp - rightTimestamp) > 0.001) {
    return false;
  }
  return getMessageText(left.content) === getMessageText(right.content);
}

function hasMatchingSteeredQueuedMessage(state: ChatState, message: RawMessage): boolean {
  if (String(message.role).toLowerCase() !== 'user') return false;
  const messageText = getMessageText(message.content).trim();
  if (!messageText) return false;
  return state.queuedMessages.some((queuedMessage) => (
    queuedMessage.kind === 'steered'
    && !!queuedMessage.pendingRunId
    && queuedMessage.text.trim() === messageText
  ));
}

function rememberAbortedRunId(runId: string): void {
  if (!runId) return;
  if (!_abortedRunIds.has(runId)) {
    _abortedRunIds.add(runId);
    _abortedRunIdOrder.push(runId);
  }
  _blockedRunEvents.delete(runId);
  while (_abortedRunIdOrder.length > MAX_ABORTED_RUN_IDS) {
    const oldest = _abortedRunIdOrder.shift();
    if (oldest) {
      _abortedRunIds.delete(oldest);
      _blockedRunEvents.delete(oldest);
    }
  }
}

function blockUnknownAbortedRunEvents(): void {
  _blockUnknownAbortedRunEvents = true;
}

function unblockUnknownAbortedRunEvents(): void {
  _blockUnknownAbortedRunEvents = false;
}

function rememberIgnoredSteerAckRunId(runId: string): void {
  if (!runId) return;
  if (!_ignoredSteerAckRunIds.has(runId)) {
    _ignoredSteerAckRunIds.add(runId);
    _ignoredSteerAckRunIdOrder.push(runId);
  }
  while (_ignoredSteerAckRunIdOrder.length > MAX_ABORTED_RUN_IDS) {
    const oldest = _ignoredSteerAckRunIdOrder.shift();
    if (oldest) {
      _ignoredSteerAckRunIds.delete(oldest);
    }
  }
}

function isIgnorableSteerAckLifecycleEvent(
  runId: string,
  state: string,
  eventMessage: unknown,
): boolean {
  return !!runId
    && _ignoredSteerAckRunIds.has(runId)
    && eventMessage == null
    && (state === 'started' || state === 'final' || state === 'aborted');
}

function queueBlockedRunEvent(runId: string, event: BlockedRunEvent): void {
  const events = _blockedRunEvents.get(runId) ?? [];
  events.push({
    kind: event.kind,
    event: { ...event.event },
  } as BlockedRunEvent);
  if (events.length > MAX_BLOCKED_RUN_EVENTS) {
    events.shift();
  }
  _blockedRunEvents.set(runId, events);
}

function takeBlockedRunEvents(runId: string): BlockedRunEvent[] {
  const events = _blockedRunEvents.get(runId) ?? [];
  _blockedRunEvents.delete(runId);
  return events;
}

function replayBlockedRunEvents(runId: string | null, getState: () => ChatState): void {
  if (!runId) {
    return;
  }

  const blockedEvents = takeBlockedRunEvents(runId);
  for (const blockedEvent of blockedEvents) {
    if (blockedEvent.kind === 'chat') {
      getState().handleChatEvent(blockedEvent.event);
    } else {
      getState().handleAgentEvent(blockedEvent.event);
    }
  }
}

export function __resetChatRuntimeGuardsForTests(): void {
  clearErrorRecoveryTimer();
  clearHistoryPoll();
  clearHistoryStartupRetry();
  clearSessionToolFallbackUnsubscribeTimer();
  clearQueuedMessageFlushTimer();
  _lastChatEventAt = 0;
  _sendGeneration = 0;
  _runtimeSubscriptionGeneration = 0;
  _subscribedMessagesSessionKey = null;
  _sessionToolFallbackSubscribed = false;
  _abortedRunIds.clear();
  _abortedRunIdOrder.length = 0;
  _ignoredSteerAckRunIds.clear();
  _ignoredSteerAckRunIdOrder.length = 0;
  _blockUnknownAbortedRunEvents = false;
  _blockedRunEvents.clear();
  _seenToolEventKeys.clear();
  _seenToolEventKeyOrder.length = 0;
  _runScopedSubscribedRunIds.clear();
  _runScopedSubscribedRunIdOrder.length = 0;
  _awaitingSteeredRunAdoption = false;
}

function isRecoverableChatSendTimeout(error: string): boolean {
  return error.includes('RPC timeout: chat.send');
}

function cloneQueuedAttachments(
  attachments?: ChatMessageAttachmentInput[],
): ChatMessageAttachmentInput[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  return attachments.map((attachment) => ({ ...attachment }));
}

function createQueuedMessage(
  text: string,
  attachments: ChatMessageAttachmentInput[] | undefined,
  targetAgentId: string | null | undefined,
): QueuedChatMessage {
  return {
    id: crypto.randomUUID(),
    text,
    attachments: cloneQueuedAttachments(attachments),
    targetAgentId: targetAgentId ?? null,
    createdAt: Date.now(),
    kind: 'queued',
    pendingRunId: null,
  };
}

function queueMessageIfRuntimeBusy(
  state: ChatState,
  setState: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  text: string,
  attachments: ChatMessageAttachmentInput[] | undefined,
  targetAgentId: string | null | undefined,
): boolean {
  if (!state.sending && !state.activeRunId) {
    return false;
  }
  if (state.queuedMessages.length > 0) {
    return true;
  }

  const queuedMessage = createQueuedMessage(text, attachments, targetAgentId);
  setState((currentState) => ({
    queuedMessages: [...currentState.queuedMessages, queuedMessage],
  }));
  return true;
}

function completeSteeredQueuedMessagesForRun(
  runId: string,
  setState: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  getState: () => ChatState,
): string | null {
  if (!runId) {
    return null;
  }

  const queuedMessage = getState().queuedMessages.find((message) => (
    message.kind === 'steered' && message.pendingRunId === runId
  ));
  if (!queuedMessage) {
    return null;
  }


  const nowMs = Date.now();
  const optimisticAttachments = queuedMessage.attachments?.map((attachment) => ({
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    preview: attachment.preview,
    filePath: attachment.stagedPath,
  })) || [];
  const limitedOptimisticAttachments = limitAttachedFilesForMessage(optimisticAttachments);
  const userMsg: RawMessage = {
    role: 'user',
    content: queuedMessage.text || (queuedMessage.attachments?.length ? i18n.t('chat:composer.attachmentFallback') : ''),
    timestamp: nowMs / 1000,
    id: crypto.randomUUID(),
    _attachedFiles: limitedOptimisticAttachments.files,
    _hiddenAttachmentCount: limitedOptimisticAttachments.hiddenCount || undefined,
  };

  setState((state) => {
    const previousMessage = state.messages[state.messages.length - 1];
    return {
      messages: [...state.messages, userMsg],
      queuedMessages: state.queuedMessages.filter((message) => (
        message.kind !== 'steered' || message.pendingRunId !== runId
      )),
      sending: true,
      sendAckPending: false,
      activeRunId: null,
      error: null,
      runError: null,
      ...createEmptyToolRuntimeState(),
      streamingTextStartedAt: nowMs / 1000,
      pendingFinal: false,
      lastUserMessageAt: nowMs,
      pendingOptimisticUserId: userMsg.id || null,
      pendingOptimisticUserAnchorAt: typeof previousMessage?.timestamp === 'number'
        ? toMs(previousMessage.timestamp)
        : null,
      pendingOptimisticUserIndex: state.messages.length,
      historyRequestGeneration: state.historyRequestGeneration + 1,
    };
  });
  _awaitingSteeredRunAdoption = true;
  return queuedMessage.steerRunId ?? null;
}

function scheduleQueuedMessageFlush(getState: () => ChatState): void {
  if (_queuedMessageFlushTimer) {
    return;
  }
  _queuedMessageFlushTimer = setTimeout(() => {
    _queuedMessageFlushTimer = null;
    getState().flushNextQueuedMessage();
  }, 0);
}

function resolveMainSessionKeyForAgent(agentId?: string | null): string | null {
  if (!agentId) return null;
  const agent = useAgentsStore.getState().agents.find((entry) => entry.id === agentId);
  return agent?.mainSessionKey ?? buildDefaultMainSessionKey(agentId);
}

function resolveMainSessionKeyForKnownAgent(agentId: string): string {
  return resolveMainSessionKeyForAgent(agentId) ?? buildDefaultMainSessionKey(agentId);
}

function resolveAgentWorkspace(agentId?: string | null): string | null {
  if (!agentId) return null;
  const workspace = useAgentsStore.getState().agents.find((agent) => agent.id === agentId)?.workspace;
  const trimmed = workspace?.trim();
  return trimmed || null;
}

function upsertProposalDecisionEntry(
  entries: ProposalDecisionEntry[] | undefined,
  proposalId: string,
  decision: 'approved' | 'rejected',
): ProposalDecisionEntry[] {
  const trimmedProposalId = proposalId.trim();
  const nextEntries = (entries || []).filter((entry) => entry.proposalId !== trimmedProposalId);
  nextEntries.push({
    proposalId: trimmedProposalId,
    decision,
    updatedAt: Date.now(),
  });
  return nextEntries.slice(-50);
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

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  ...createChatInitialState(),

  // ── Load desktop sessions ──

  loadSessions: async () => {
    const startedAt = Date.now();
    try {
      const previousGatewayKey = get().currentSessionKey;
      const previousDesktopSessionId = get().currentDesktopSessionId;
      const previousIsDraft = get().isDraftSession;
      const previousDesktopSessions = get().desktopSessions;
      logChatTrace('loadSessions:start', {
        previousGatewayKey,
        previousDesktopSessionId,
        previousIsDraft,
        previousDesktopSessionsCount: previousDesktopSessions.length,
        ...summarizeChatSelection(get()),
      });
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
      void get().syncRuntimeSubscriptions();
      logChatTrace('loadSessions:done', {
        durationMs: Date.now() - startedAt,
        preferredMainSessionKey,
        desktopSessionsCount: desktopSessions.length,
        activeSessionId: activeSession?.id ?? '',
        activeSessionKey: activeSession?.gatewaySessionKey ?? '',
        tokenInfoCount: Object.keys(sessionTokenInfoByKey).length,
        ...summarizeChatSelection(get()),
      });

    } catch (err) {
      logChatTrace('loadSessions:error', {
        durationMs: Date.now() - startedAt,
        error: String(err),
        ...summarizeChatSelection(get()),
      });
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
    const startedAt = Date.now();
    const normalizedAgentId = agentId || 'main';
    const mainSessionKey = resolveMainSessionKeyForKnownAgent(normalizedAgentId);
    const existingMainSession = get().desktopSessions.find((session) => session.gatewaySessionKey === mainSessionKey);
    logChatTrace('openAgentMainSession:start', {
      agentId,
      normalizedAgentId,
      mainSessionKey,
      existingMainSessionId: existingMainSession?.id ?? '',
      ...summarizeChatSelection(get()),
    });

    if (existingMainSession) {
      set({
        isDraftSession: false,
        currentDesktopSessionId: existingMainSession.id,
        currentSessionKey: existingMainSession.gatewaySessionKey,
        currentAgentId: normalizedAgentId,
        currentViewMode: 'session',
        selectedCronRun: null,
        loading: true,
        ...createConversationResetState(),
      });
      void get().syncRuntimeSubscriptions();
      logChatTrace('openAgentMainSession:reuse-existing', {
        durationMs: Date.now() - startedAt,
        selectedSessionId: existingMainSession.id,
        selectedSessionKey: existingMainSession.gatewaySessionKey,
        ...summarizeChatSelection(get()),
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
        loading: true,
        ...createConversationResetState(),
      }));
      void get().syncRuntimeSubscriptions();
      logChatTrace('openAgentMainSession:created', {
        durationMs: Date.now() - startedAt,
        createdSessionId: createdMainSession.id,
        createdSessionKey: createdMainSession.gatewaySessionKey,
        ...summarizeChatSelection(get()),
      });
      await get().loadHistory(true);
    } catch (createError) {
      logChatTrace('openAgentMainSession:error', {
        durationMs: Date.now() - startedAt,
        error: String(createError),
        ...summarizeChatSelection(get()),
      });
      console.warn(`Failed to create main session for agent ${normalizedAgentId}:`, createError);
    }
  },

  // ── Switch session ──

  switchSession: (desktopSessionId: string) => {
    const target = get().desktopSessions.find((session) => session.id === desktopSessionId);
    if (!target) return;
    logChatTrace('switchSession:start', {
      targetSessionId: desktopSessionId,
      targetSessionKey: target.gatewaySessionKey,
      ...summarizeChatSelection(get()),
    });
    set({
      isDraftSession: false,
      currentDesktopSessionId: target.id,
      currentSessionKey: target.gatewaySessionKey,
      currentAgentId: getAgentIdFromSessionKey(target.gatewaySessionKey),
      currentViewMode: 'session',
      selectedCronRun: null,
      ...createConversationResetState(),
    });
    void get().syncRuntimeSubscriptions();
    logChatTrace('switchSession:selected', {
      targetSessionId: target.id,
      targetSessionKey: target.gatewaySessionKey,
      ...summarizeChatSelection(get()),
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
      ...createConversationResetState(),
      thinkingLevel: null,
    });
    void get().syncRuntimeSubscriptions();
    await get().loadHistory();
  },

  // ── Delete desktop session ──

  deleteSession: async (desktopSessionId: string) => {
    logChatTrace('deleteSession:start', {
      desktopSessionId,
      ...summarizeChatSelection(get()),
      desktopSessionsCount: get().desktopSessions.length,
    });
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
        const fallbackMainKey = resolveMainSessionKeyForKnownAgent(fallbackAgentId);
        remaining = [await createDesktopSessionRequest('', fallbackMainKey)];
      } catch (error) {
        console.warn('Failed to create replacement desktop session:', error);
      }
    }

    const preferredAgentId = currentAgentId || useAgentsStore.getState().defaultAgentId || 'main';
    const preferredMainSessionKey = resolveMainSessionKeyForKnownAgent(preferredAgentId);
    const sameAgentRemaining = remaining.filter(
      (session) => getAgentIdFromSessionKey(session.gatewaySessionKey) === preferredAgentId,
    );
    const next = remaining.find((session) => session.id === currentDesktopSessionId)
      ?? sameAgentRemaining.find((session) => session.gatewaySessionKey === preferredMainSessionKey)
      ?? sameAgentRemaining[0]
      ?? remaining[0];
    const conversationState = createConversationResetState();
    if (currentDesktopSessionId !== desktopSessionId) {
      conversationState.messages = get().messages;
    }

    set({
      desktopSessions: remaining,
      isDraftSession: !next,
      currentDesktopSessionId: next?.id ?? '',
      currentSessionKey: next?.gatewaySessionKey ?? '',
      currentAgentId: next?.gatewaySessionKey ? getAgentIdFromSessionKey(next.gatewaySessionKey) : 'main',
      currentViewMode: 'session',
      selectedCronRun: null,
      ...conversationState,
    });
    void get().syncRuntimeSubscriptions();
    logChatTrace('deleteSession:done', {
      deletedSessionId: desktopSessionId,
      nextSessionId: next?.id ?? '',
      nextSessionKey: next?.gatewaySessionKey ?? '',
      remainingCount: remaining.length,
      ...summarizeChatSelection(get()),
    });

    if (currentDesktopSessionId === desktopSessionId && next?.gatewaySessionKey) {
      await get().loadHistory();
    }
  },

  renameSession: async (desktopSessionId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;

    const session = get().desktopSessions.find((entry) => entry.id === desktopSessionId);
    if (!session) return;

    const updatedSession = await updateDesktopSessionRequest(desktopSessionId, {
      title: nextTitle,
      updatedAt: Date.now(),
    });

    set({
      desktopSessions: get().desktopSessions.map((entry) => (
        entry.id === desktopSessionId ? updatedSession : entry
      )),
    });
  },

  // ── New session ──

  newSession: async () => {
    await get().newTemporarySession(get().currentAgentId || 'main');
  },

  // ── New temporary session ──

  newTemporarySession: async (agentId?: string) => {
    const nextAgentId = agentId || get().currentAgentId || 'main';
    clearHistoryStartupRetry();
    logChatTrace('newTemporarySession:start', {
      requestedAgentId: agentId ?? '',
      resolvedAgentId: nextAgentId,
      ...summarizeChatSelection(get()),
    });
    set((state) => ({
      isDraftSession: true,
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: nextAgentId,
      currentViewMode: 'session',
      selectedCronRun: null,
      loading: false,
      ...createConversationResetState(),
      historyRequestGeneration: state.historyRequestGeneration + 1,
    }));
    void get().syncRuntimeSubscriptions();
    logChatTrace('newTemporarySession:selected', summarizeChatSelection(get()));
  },

  // ── Cleanup empty session on navigate away ──

  cleanupEmptySession: async () => {
    const { currentDesktopSessionId, desktopSessions, messages } = get();
    if (!currentDesktopSessionId || messages.length > 0) return;
    if (desktopSessions.length <= 1) return;
    const currentSession = desktopSessions.find((session) => session.id === currentDesktopSessionId);
    if (!currentSession || isMainSessionKey(currentSession.gatewaySessionKey)) return;
    logChatTrace('cleanupEmptySession:delete-current', {
      currentDesktopSessionId,
      currentSessionKey: currentSession.gatewaySessionKey,
      desktopSessionsCount: desktopSessions.length,
      messagesCount: messages.length,
      ...summarizeChatSelection(get()),
    });
    await get().deleteSession(currentDesktopSessionId);
  },

  // ── Load chat history ──

  loadHistory: async (quiet = false, mode = 'default') => {
    const startedAt = Date.now();
    clearHistoryStartupRetryTimer();
    const { currentSessionKey, currentDesktopSessionId, currentViewMode, selectedCronRun } = get();
    logChatTrace('loadHistory:start', {
      quiet,
      requestSessionKey: currentSessionKey,
      requestDesktopSessionId: currentDesktopSessionId,
      requestViewMode: currentViewMode,
      requestCronRunId: selectedCronRun?.id ?? '',
      ...summarizeChatSelection(get()),
    });
    if (!currentSessionKey) {
      clearHistoryStartupRetry();
      logChatTrace('loadHistory:skip-no-session', {
        quiet,
        durationMs: Date.now() - startedAt,
        ...summarizeChatSelection(get()),
      });
      if (!quiet) set({ loading: false });
      return;
    }
    const request = createHistoryRequestSnapshot(get());
    if (!quiet) set({ loading: true, error: null, runError: null });

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

        const displayMessages = await hydrateHistoryMessagesForDisplay(rawMessages, {
          artifactBaseDir: resolveAgentWorkspace(selectedCronRun.agentId || get().currentAgentId),
        });
        const latestTerminalAssistantErrorTurn = getLatestTerminalAssistantRunError(
          rawMessages,
          get().lastUserMessageAt,
        );
        const latestTerminalAssistantError = latestTerminalAssistantErrorTurn
          ? getLocalizedRuntimeErrorMessage({ message: latestTerminalAssistantErrorTurn })
          : null;
        if (!isSameHistoryRequest(request, get())) {
          return;
        }
        clearHistoryStartupRetry();
        set((state) => ({
          messages: displayMessages,
          thinkingLevel: null,
          loading: false,
          error: null,
          runError: latestTerminalAssistantError,
          ...reconcileToolRuntimeWithHistory(
            state.toolStreamOrder,
            state.toolStreamById,
            state.toolResultHistoryReloadedIds,
            displayMessages,
          ),
        }));
      } catch (err) {
        console.warn('Failed to load cron run history:', err);
        if (!isSameHistoryRequest(request, get())) {
          return;
        }
        clearHistoryStartupRetry();
        set({ messages: [], loading: false, error: String(err), runError: null });
      }
      return;
    }

    try {
      const tokenInfoPromise = fetchSessionTokenInfoByKey()
        .then((sessionTokenInfoByKey) => ({ success: true as const, sessionTokenInfoByKey }))
        .catch((error) => ({ success: false as const, error }));
      const data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
        'chat.history',
        { sessionKey: currentSessionKey, limit: 200 },
      );
      clearHistoryStartupRetry();
      logChatTrace('loadHistory:rpc-resolved', {
        quiet,
        durationMs: Date.now() - startedAt,
        requestSessionKey: currentSessionKey,
        rawMessagesCount: Array.isArray(data?.messages) ? data.messages.length : 0,
        thinkingLevel: data?.thinkingLevel ? String(data.thinkingLevel) : '',
      });
      if (data) {
        const rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
        const latestTerminalAssistantErrorTurn = getLatestTerminalAssistantRunError(
          rawMessages,
          get().lastUserMessageAt,
        );
        const latestTerminalAssistantError = latestTerminalAssistantErrorTurn
          ? getLocalizedRuntimeErrorMessage({ message: latestTerminalAssistantErrorTurn })
          : null;

        // Before filtering: attach images/files from tool_result messages to the next assistant message
        const filteredMessages = prepareHistoryMessagesForDisplay(rawMessages, {
          artifactBaseDir: resolveAgentWorkspace(getAgentIdFromSessionKey(currentSessionKey)),
        });
        const enrichedMessages = filteredMessages;
        const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;

        const finalMessages = appendPendingOptimisticUserMessage(enrichedMessages, get());

        if (!isSameHistoryRequest(request, get())) {
          logChatTrace('loadHistory:stale-before-apply', {
            quiet,
            durationMs: Date.now() - startedAt,
            requestSessionKey: request.sessionKey,
            ...summarizeChatSelection(get()),
          });
          return;
        }
        clearHistoryStartupRetry();
        if (latestTerminalAssistantError) {
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          set({
            messages: finalMessages,
            thinkingLevel,
            loading: false,
            error: null,
            ...createRunResetState(),
            runError: latestTerminalAssistantError,
          });
          logChatTrace('loadHistory:terminal-run-error', {
            quiet,
            mode,
            durationMs: Date.now() - startedAt,
            requestSessionKey: request.sessionKey,
            error: latestTerminalAssistantError,
            ...summarizeChatSelection(get()),
          });
          return;
        }
        const toolPatchOnlyHistoryReload = mode === 'tool_patch';
        if (toolPatchOnlyHistoryReload) {
          set((state) => ({
            messages: mergeHistoryToolStatusesIntoMessages(state.messages, enrichedMessages),
            thinkingLevel,
            loading: false,
            error: null,
            runError: quiet ? state.runError : null,
            ...patchToolRuntimeWithHistory(
              state.toolStreamOrder,
              state.toolStreamById,
              state.toolResultHistoryReloadedIds,
              enrichedMessages,
              state.sending ? (state.lastUserMessageAt ?? 0) : 0,
            ),
          }));
          logChatTrace('loadHistory:applied-tool-patch', {
            quiet,
            mode,
            durationMs: Date.now() - startedAt,
            requestSessionKey: request.sessionKey,
            toolHistoryMessagesCount: enrichedMessages.length,
            ...summarizeChatSelection(get()),
          });
          return;
        }

        const midRunToolOnlyHistoryReload = quiet && get().sending;
        if (midRunToolOnlyHistoryReload) {
          const state = get();
          const userMsTs = state.lastUserMessageAt ? toMs(state.lastUserMessageAt) : 0;
          const recentAssistant = state.pendingFinal
            ? [...filteredMessages].reverse().find((msg) => {
                if (msg.role !== 'assistant') return false;
                if (!hasNonToolAssistantContent(msg)) return false;
                if (!userMsTs || !msg.timestamp) return true;
                return toMs(msg.timestamp) >= userMsTs;
              })
            : null;

          if (state.activeRunId && recentAssistant) {
            const completedRunId = state.activeRunId;
            clearHistoryPoll();
            set({
              messages: finalMessages,
              thinkingLevel,
              loading: false,
              error: null,
              runError: quiet ? state.runError : null,
              sending: false,
              sendAckPending: false,
              activeRunId: null,
              pendingFinal: false,
              lastUserMessageAt: null,
              pendingOptimisticUserId: null,
              pendingOptimisticUserAnchorAt: null,
              pendingOptimisticUserIndex: null,
              ...createEmptyToolRuntimeState(),
            });
            const replayRunId = completeSteeredQueuedMessagesForRun(completedRunId ?? '', set, get);
            replayBlockedRunEvents(replayRunId, get);
            scheduleQueuedMessageFlush(get);
            return;
          }

          set((state) => ({
            messages: state.messages,
            loading: false,
            error: null,
            runError: quiet ? state.runError : null,
            ...patchToolRuntimeWithHistory(
              state.toolStreamOrder,
              state.toolStreamById,
              state.toolResultHistoryReloadedIds,
              enrichedMessages,
              state.lastUserMessageAt ?? 0,
            ),
          }));
          logChatTrace('loadHistory:applied-tool-only', {
            quiet,
            durationMs: Date.now() - startedAt,
            requestSessionKey: request.sessionKey,
            toolHistoryMessagesCount: enrichedMessages.length,
            ...summarizeChatSelection(get()),
          });
          return;
        }
        set((state) => ({
          messages: finalMessages,
          thinkingLevel,
          loading: false,
          error: null,
          runError: quiet ? state.runError : null,
          ...reconcileToolRuntimeWithHistory(
            state.toolStreamOrder,
            state.toolStreamById,
            state.toolResultHistoryReloadedIds,
            finalMessages,
          ),
        }));
        logChatTrace('loadHistory:applied', {
          quiet,
          durationMs: Date.now() - startedAt,
          requestSessionKey: request.sessionKey,
          finalMessagesCount: finalMessages.length,
          pendingFinal: get().pendingFinal,
          sending: get().sending,
          ...summarizeChatSelection(get()),
        });

        void tokenInfoPromise.then((tokenInfoResult) => {
          if (!isSameHistoryRequest(request, get())) {
            return;
          }
          if (!tokenInfoResult.success) {
            console.warn('Failed to refresh gateway session token info during history load:', tokenInfoResult.error);
            return;
          }
          set({ sessionTokenInfoByKey: tokenInfoResult.sessionTokenInfoByKey });
        });

        void loadMissingPreviews(finalMessages)
          .then((previewsLoaded) => {
            if (!previewsLoaded || !isSameHistoryRequest(request, get())) {
              return;
            }
            const hydratedFilesById = new Map<string, RawMessage['_attachedFiles']>();
            const hydratedFilesByRef = new Map<RawMessage, RawMessage['_attachedFiles']>();
            for (const msg of finalMessages) {
              if (msg._attachedFiles === undefined) continue;
              const hydratedFiles = msg._attachedFiles.map((file) => ({ ...file }));
              hydratedFilesByRef.set(msg, hydratedFiles);
              if (msg.id) {
                hydratedFilesById.set(msg.id, hydratedFiles);
              }
            }

            set((state) => ({
              messages: state.messages.map((msg) => {
                const hydratedFiles = msg.id && hydratedFilesById.has(msg.id)
                  ? hydratedFilesById.get(msg.id)
                  : hydratedFilesByRef.get(msg);
                return hydratedFiles !== undefined
                  ? { ...msg, _attachedFiles: hydratedFiles }
                  : msg;
              }),
            }));
          })
          .catch((error) => {
            console.warn('[loadHistory] Failed to hydrate file previews:', error);
          });

        if (currentDesktopSessionId) {
          const currentDesktopSession = get().desktopSessions.find((session) => session.id === currentDesktopSessionId);
          const metadataSync = buildDesktopSessionMetadataSync(currentDesktopSession, finalMessages);
          if (metadataSync) {
            set((s) => ({
              desktopSessions: s.desktopSessions.map((session) => (
                session.id === currentDesktopSessionId
                  ? metadataSync.session
                  : session
              )),
            }));

            void updateDesktopSessionRequest(currentDesktopSessionId, metadataSync.patch).catch((error) => {
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
            const completedRunId = get().activeRunId;
            clearHistoryPoll();
            set({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              ...createEmptyToolRuntimeState(),
            });
            const replayRunId = completeSteeredQueuedMessagesForRun(completedRunId ?? '', set, get);
            replayBlockedRunEvents(replayRunId, get);
            scheduleQueuedMessageFlush(get);
          }
        }
      } else {
        if (!isSameHistoryRequest(request, get())) {
          logChatTrace('loadHistory:stale-empty', {
            quiet,
            durationMs: Date.now() - startedAt,
            requestSessionKey: request.sessionKey,
            ...summarizeChatSelection(get()),
          });
          return;
        }
        clearHistoryStartupRetry();
        set({ messages: [], loading: false, error: null, runError: null });
        logChatTrace('loadHistory:empty', {
          quiet,
          durationMs: Date.now() - startedAt,
          requestSessionKey: request.sessionKey,
          ...summarizeChatSelection(get()),
        });
      }
    } catch (err) {
      if (isHistoryUnavailableDuringGatewayStartup(err)) {
        const currentState = get();
        const shouldRetrySameRequest = isSameHistoryRequest(request, currentState);
        if (shouldRetrySameRequest) {
          const requestKey = getHistoryRequestKey(request);
          const nextAttempt = _historyStartupRetryState?.requestKey === requestKey
            ? _historyStartupRetryState.attempt + 1
            : 1;
          const keepLoading = currentState.messages.length === 0;
          const retryDelayMs = CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS[nextAttempt - 1];
          if (!retryDelayMs) {
            clearHistoryStartupRetry();
            logChatTrace('loadHistory:startup-retry-exhausted', {
              quiet,
              durationMs: Date.now() - startedAt,
              requestSessionKey: request.sessionKey,
              attempts: nextAttempt - 1,
              error: String(err),
              ...summarizeChatSelection(currentState),
            });
            set({
              error: String(err),
              runError: null,
              loading: false,
              ...(keepLoading ? { messages: [] } : {}),
            });
            return;
          }
          _historyStartupRetryState = {
            requestKey,
            attempt: nextAttempt,
            mode,
          };
          set({
            error: null,
            runError: null,
            loading: keepLoading,
          });
          _historyStartupRetryTimer = setTimeout(() => {
            if (!isSameHistoryRequest(request, get())) {
              clearHistoryStartupRetry();
              return;
            }
            logChatTrace('loadHistory:startup-retry', {
              quiet,
              attempt: nextAttempt,
              retryDelayMs,
              requestSessionKey: request.sessionKey,
              requestDesktopSessionId: request.desktopSessionId,
              requestViewMode: request.viewMode,
              requestCronRunId: request.cronRunId,
              ...summarizeChatSelection(get()),
            });
            void get().loadHistory(true, _historyStartupRetryState?.mode ?? mode);
          }, retryDelayMs);
          logChatTrace('loadHistory:startup-unavailable', {
            quiet,
            durationMs: Date.now() - startedAt,
            attempt: nextAttempt,
            requestSessionKey: request.sessionKey,
            keepLoading,
            retryScheduled: true,
            retryDelayMs,
            error: String(err),
            ...summarizeChatSelection(currentState),
          });
          return;
        }
      }
      clearHistoryStartupRetry();
      logChatTrace('loadHistory:error', {
        quiet,
        durationMs: Date.now() - startedAt,
        requestSessionKey: request.sessionKey,
        error: String(err),
        ...summarizeChatSelection(get()),
      });
      console.warn('Failed to load chat history:', err);
      if (!isSameHistoryRequest(request, get())) {
        return;
      }
      set({ messages: [], loading: false, runError: null });
    }
  },

  // ── Send message ──

  sendMessage: async (
    text: string,
    attachments?: ChatMessageAttachmentInput[],
    targetAgentId?: string | null,
  ) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const currentState = get();
    if (queueMessageIfRuntimeBusy(currentState, set, trimmed, attachments, targetAgentId)) {
      return;
    }

    const currentSendGeneration = ++_sendGeneration;

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
          ...createConversationResetState(),
        });
        void get().syncRuntimeSubscriptions();
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
          ...createConversationResetState(),
        }));
        void get().syncRuntimeSubscriptions();
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
      void get().syncRuntimeSubscriptions();
      logChatTrace('sendMessage:created-session-for-draft', {
        createdSessionId: createdSession.id,
        createdSessionKey: createdSession.gatewaySessionKey,
        draftAgentId,
        ...summarizeChatSelection(get()),
      });
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
      content: trimmed || (attachments?.length ? i18n.t('chat:composer.attachmentFallback') : ''),
      timestamp: nowMs / 1000,
      id: crypto.randomUUID(),
      _attachedFiles: limitedOptimisticAttachments.files,
      _hiddenAttachmentCount: limitedOptimisticAttachments.hiddenCount || undefined,
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      isDraftSession,
      sending: true,
      sendAckPending: true,
      error: null,
      runError: null,
      ...createEmptyToolRuntimeState(),
      streamingTextStartedAt: nowMs / 1000,
      pendingFinal: false,
      lastUserMessageAt: nowMs,
      pendingOptimisticUserId: userMsg.id || null,
      pendingOptimisticUserAnchorAt: (() => {
        const previousMessage = s.messages[s.messages.length - 1];
        return typeof previousMessage?.timestamp === 'number' ? toMs(previousMessage.timestamp) : null;
      })(),
      pendingOptimisticUserIndex: s.messages.length,
      historyRequestGeneration: s.historyRequestGeneration + 1,
    }));

    // Update desktop session metadata as soon as the first user message is sent.
    const { desktopSessions, messages } = get();
    const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
    const currentDesktopSession = desktopSessions.find((session) => session.id === currentDesktopSessionId);
    const titleText = renderSkillMarkersAsPlainText(trimmed);
    const previewText = toSessionPreview(trimmed || (attachments?.length ? i18n.t('chat:composer.attachmentFallback') : ''));
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
      logChatTrace('sendMessage:safety-timeout', {
        sessionKey: state.currentSessionKey,
        desktopSessionId: state.currentDesktopSessionId,
        lastChatEventAgeMs: Date.now() - _lastChatEventAt,
        pendingFinal: state.pendingFinal,
        streamingTextLength: state.streamingText.length,
        toolMessagesCount: state.toolMessages.length,
        streamSegmentsCount: state.streamSegments.length,
        ...summarizeChatSelection(state),
      });
      set({
        error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
        runError: null,
        sending: false,
        sendAckPending: false,
        activeRunId: null,
        lastUserMessageAt: null,
        pendingOptimisticUserId: null,
        pendingOptimisticUserAnchorAt: null,
        pendingOptimisticUserIndex: null,
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

      let result: { success: boolean; result?: Record<string, unknown> & { runId?: string }; error?: string };

      if (hasMedia) {
        result = await hostApiFetch<{ success: boolean; result?: { runId?: string }; error?: string }>(
          '/api/chat/send-with-media',
          {
            method: 'POST',
            body: JSON.stringify({
              sessionKey: currentSessionKey,
              message: trimmed || i18n.t('chat:composer.attachmentDefaultInstruction'),
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
        const rpcResult = await useGatewayStore.getState().rpc<Record<string, unknown> & { runId?: string }>(
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

      const returnedRunId = result.result?.runId;
      const returnedRunError = getRunErrorFromPayloads(result.result);
      if (currentSendGeneration !== _sendGeneration) {
        if (returnedRunId) {
          rememberAbortedRunId(returnedRunId);
        }
        if (!get().sending) {
          unblockUnknownAbortedRunEvents();
        }
        return;
      }

      if (returnedRunError !== null) {
        clearHistoryPoll();
        clearErrorRecoveryTimer();
        set({
          error: null,
          runError: getLocalizedRunPayloadErrorMessage(returnedRunError),
          sending: false,
          sendAckPending: false,
          activeRunId: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingOptimisticUserId: null,
          pendingOptimisticUserAnchorAt: null,
          pendingOptimisticUserIndex: null,
          ...createEmptyToolRuntimeState(),
        });
        unblockUnknownAbortedRunEvents();
      } else if (!result.success) {
        const errorMsg = result.error || 'Failed to send message';
        if (isRecoverableChatSendTimeout(errorMsg)) {
          logChatTrace('sendMessage:recoverable-timeout', {
            error: errorMsg,
            sessionKey: currentSessionKey,
            desktopSessionId: currentDesktopSessionId,
            ...summarizeChatSelection(get()),
          });
          console.warn(`[sendMessage] Recoverable chat.send timeout, keeping poll alive: ${errorMsg}`);
          set({ error: errorMsg, runError: null, sendAckPending: false });
        } else {
          clearHistoryPoll();
          set({ error: errorMsg, runError: null, sending: false, sendAckPending: false, ...createEmptyToolRuntimeState() });
          unblockUnknownAbortedRunEvents();
        }
      } else if (get().sending) {
        set({ sendAckPending: false });
        if (returnedRunId) {
          set({ activeRunId: returnedRunId });
        }
        unblockUnknownAbortedRunEvents();
        if (returnedRunId) {
          const blockedEvents = takeBlockedRunEvents(returnedRunId);
          for (const blockedEvent of blockedEvents) {
            if (blockedEvent.kind === 'chat') {
              get().handleChatEvent(blockedEvent.event);
            } else {
              get().handleAgentEvent(blockedEvent.event);
            }
          }
        }
      }
    } catch (err) {
      if (currentSendGeneration !== _sendGeneration) {
        if (!get().sending) {
          unblockUnknownAbortedRunEvents();
        }
        return;
      }
      const errStr = String(err);
      if (isRecoverableChatSendTimeout(errStr)) {
        logChatTrace('sendMessage:recoverable-timeout', {
          error: errStr,
          sessionKey: currentSessionKey,
          desktopSessionId: currentDesktopSessionId,
          ...summarizeChatSelection(get()),
        });
        console.warn(`[sendMessage] Recoverable chat.send timeout, keeping poll alive: ${errStr}`);
        set({ error: errStr, runError: null, sendAckPending: false });
      } else {
        clearHistoryPoll();
        set({ error: errStr, runError: null, sending: false, sendAckPending: false, ...createEmptyToolRuntimeState() });
        unblockUnknownAbortedRunEvents();
      }
    }
  },

  removeQueuedMessage: (id: string) => {
    set((state) => ({
      queuedMessages: state.queuedMessages.filter((message) => message.id !== id),
    }));
  },

  clearQueuedMessages: () => {
    set({ queuedMessages: [] });
  },

  flushNextQueuedMessage: () => {
    const state = get();
    if (state.sending || state.activeRunId || state.sendAckPending || state.queuedMessages.length === 0) {
      return;
    }

    const nextMessage = state.queuedMessages.find((message) => message.kind !== 'steered');
    if (!nextMessage) {
      return;
    }

    set((currentState) => ({
      queuedMessages: currentState.queuedMessages.filter((message) => message.id !== nextMessage.id),
    }));
    void get().sendMessage(
      nextMessage.text,
      cloneQueuedAttachments(nextMessage.attachments),
      nextMessage.targetAgentId,
    );
  },

  steerQueuedMessage: async (id: string) => {
    const queuedMessage = get().queuedMessages.find((message) => message.id === id);
    if (!queuedMessage) {
      return;
    }

    const activeRunId = get().activeRunId;
    if (!activeRunId) {
      return;
    }

    set((state) => ({
      queuedMessages: state.queuedMessages.map((message) => (
        message.id === id
          ? { ...message, kind: 'steered', pendingRunId: activeRunId }
          : message
      )),
    }));
    void enableSessionToolFallback('steered-follow-up');

    try {
      const idempotencyKey = crypto.randomUUID();
      const steerText = queuedMessage.text.trim() || i18n.t('chat:composer.steerDefaultInstruction');
      let steerRunId: string | null = null;
      if (queuedMessage.attachments?.length) {
        const result = await hostApiFetch<{ success?: boolean; result?: { runId?: string }; error?: string; errorCode?: string }>(
          '/api/chat/send-with-media',
          {
            method: 'POST',
            body: JSON.stringify({
              sessionKey: get().currentSessionKey,
              message: steerText,
              deliver: false,
              idempotencyKey,
              media: queuedMessage.attachments.map((attachment) => ({
                filePath: attachment.stagedPath,
                mimeType: attachment.mimeType,
                fileName: attachment.fileName,
              })),
            }),
          },
        );
        if (result?.success === false) {
          throw new Error(getLocalizedRunPayloadErrorMessage(result.errorCode || result.error || ''));
        }
        steerRunId = typeof result?.result?.runId === 'string' ? result.result.runId : null;
      } else {
        const result = await useGatewayStore.getState().rpc<Record<string, unknown> & { runId?: string }>(
          'chat.send',
          {
            sessionKey: get().currentSessionKey,
            message: steerText,
            deliver: false,
            idempotencyKey,
          },
          CHAT_SEND_TIMEOUT_MS,
        );
        steerRunId = typeof result?.runId === 'string' ? result.runId : null;
      }
      if (steerRunId) {
        rememberIgnoredSteerAckRunId(steerRunId);
      }
    } catch (err) {
      set({ error: String(err), runError: null });
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    _sendGeneration += 1;
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    const { currentSessionKey, activeRunId } = get();
    if (activeRunId) {
      rememberAbortedRunId(activeRunId);
      unblockUnknownAbortedRunEvents();
    } else {
      blockUnknownAbortedRunEvents();
    }
    set({
      ...createRunResetState(),
      queuedMessages: [],
    });

    try {
      await useGatewayStore.getState().rpc(
        'chat.abort',
        activeRunId
          ? { sessionKey: currentSessionKey, runId: activeRunId }
          : { sessionKey: currentSessionKey },
      );
    } catch (err) {
      set({ error: String(err), runError: null });
    }
  },

  syncRuntimeSubscriptions: async () => {
    const generation = ++_runtimeSubscriptionGeneration;
    const sessionKey = getCurrentRuntimeSessionKey(get());

    if (!sessionKey) {
      await unsubscribeSessionMessages();
      await disableSessionToolFallback('no-active-chat-session');
      return;
    }

    await subscribeSessionMessages(sessionKey, generation);
    if (generation !== _runtimeSubscriptionGeneration) return;

    const hasActiveRun = await resolveSessionHasActiveRun(sessionKey);
    if (generation !== _runtimeSubscriptionGeneration) return;

    if (hasActiveRun || shouldKeepSessionToolFallbackSubscribed()) {
      await enableSessionToolFallback(hasActiveRun ? 'active-run-detected' : 'local-runtime-pending');
    } else if (!get().sending && !get().activeRunId) {
      await disableSessionToolFallback('no-active-run');
    }
  },

  // ── Handle incoming chat events from Gateway ──

  handleChatEvent: (event: Record<string, unknown>) => {
    const runId = String(event['runId'] || '');
    const eventState = String(event['state'] || '');
    const eventSessionKey = event['sessionKey'] != null ? String(event['sessionKey']) : null;
    const { activeRunId, currentSessionKey } = get();

    // Only process events for the current session (when sessionKey is present)
    if (eventSessionKey != null && eventSessionKey !== currentSessionKey) {
      return;
    }

    const eventMessage = event['message'];
    if (isIgnorableSteerAckLifecycleEvent(runId, eventState, eventMessage)) {
      return;
    }

    const terminalAssistantError = isTerminalAssistantErrorMessage(eventMessage);
    const terminalAssistantErrorForActiveSession = terminalAssistantError
      && get().sending
      && eventSessionKey != null
      && eventSessionKey === currentSessionKey;

    // Only process events for the active run (or if no active run set)
    if (activeRunId && runId && runId !== activeRunId && !terminalAssistantErrorForActiveSession) {
      const pendingSteeredMessage = get().queuedMessages.find((message) => (
        message.kind === 'steered'
        && message.pendingRunId === activeRunId
        && (!message.steerRunId || message.steerRunId === runId)
      ));
      if (pendingSteeredMessage) {
        if (
          eventMessage == null
          && (eventState === 'started' || eventState === 'final' || eventState === 'aborted')
        ) {
          return;
        }
        if (!pendingSteeredMessage.steerRunId) {
          set((state) => ({
            queuedMessages: state.queuedMessages.map((message) => (
              message.id === pendingSteeredMessage.id
                ? { ...message, steerRunId: runId }
                : message
            )),
          }));
        }
        queueBlockedRunEvent(runId, { kind: 'chat', event });
        return;
      }
      return;
    }

    if (runId && _abortedRunIds.has(runId) && eventState !== 'aborted') {
      return;
    }

    if (_blockUnknownAbortedRunEvents && runId) {
      if (eventState === 'aborted') {
        rememberAbortedRunId(runId);
        if (get().sending) return;
        unblockUnknownAbortedRunEvents();
      } else {
        if (!activeRunId && get().sending) {
          queueBlockedRunEvent(runId, { kind: 'chat', event });
        }
        return;
      }
    }

    _lastChatEventAt = Date.now();

    // Defensive: if state is missing but we have a message, try to infer state.
    let resolvedState = eventState;
    if (terminalAssistantError) {
      resolvedState = 'error';
    } else if (!resolvedState && eventMessage && typeof eventMessage === 'object') {
      const msg = eventMessage as Record<string, unknown>;
      const stopReason = getMessageStopReason(eventMessage);
      if (stopReason) {
        resolvedState = 'final';
      } else if (msg['role'] || msg['content']) {
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
      const { sending, activeRunId: currentActiveRunId } = get();
      const canAdoptRun = !!runId && (resolvedState !== 'final' || eventMessage != null);
      if (!sending && canAdoptRun) {
        set({ sending: true, activeRunId: runId, error: null, runError: null });
      } else if (
        sending
        && !currentActiveRunId
        && canAdoptRun
        && (resolvedState === 'started' || _awaitingSteeredRunAdoption)
      ) {
        _awaitingSteeredRunAdoption = false;
        set({ activeRunId: runId, error: null, runError: null });
      }
    }

    switch (resolvedState) {
      case 'started': {
        // Run just started (e.g. from console); show loading immediately.
        const { sending: currentSending, activeRunId: currentActiveRunId } = get();
        if (!currentSending && runId) {
          set({ sending: true, activeRunId: runId, error: null, runError: null });
        } else if (currentSending && !currentActiveRunId && runId) {
          set({ activeRunId: runId, error: null, runError: null });
        }
        break;
      }
      case 'delta': {
        if (_errorRecoveryTimer) {
          clearErrorRecoveryTimer();
        }
        if (get().error || get().runError) {
          set({ error: null, runError: null });
        }
        const nextText = extractTextFromRuntimeMessage(eventMessage);
        const eventTimestamp = typeof (eventMessage as RawMessage | undefined)?.timestamp === 'number'
          ? (eventMessage as RawMessage).timestamp
          : undefined;
        const shouldResumeSending = !get().sending
          && !!eventMessage
          && typeof eventMessage === 'object'
          && !isToolResultRole((eventMessage as RawMessage).role);
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
                ?? (typeof (eventMessage as RawMessage | undefined)?.timestamp === 'number'
                  ? (eventMessage as RawMessage).timestamp!
                  : Date.now() / 1000)
              )
            : s.streamingTextStartedAt,
          streamingTextLastEventAt: nextText.trim()
            ? (eventTimestamp ?? Date.now() / 1000)
            : s.streamingTextLastEventAt,
        }));
        break;
      }
      case 'final': {
        clearErrorRecoveryTimer();
        if (get().error || get().runError) set({ error: null, runError: null });
        const finalMsg = eventMessage as RawMessage | undefined;
        if (finalMsg) {
          if (isToolResultRole(finalMsg.role)) {
            const toolFiles: AttachedFileMeta[] = [];
            const toolFileIds = new Set<string>();
            const pushToolFile = (file: AttachedFileMeta) => {
              const identity = file.filePath || file.url || file.preview || file.fileName;
              if (identity && toolFileIds.has(identity)) return;
              if (identity) toolFileIds.add(identity);
              toolFiles.push(file);
            };
            const text = getMessageText(finalMsg.content);
            const currentToolMessage = [...get().toolMessages]
              .reverse()
              .find((message) => (
                (finalMsg.toolCallId && message.toolCallId === finalMsg.toolCallId)
                || (!finalMsg.toolCallId && finalMsg.toolName && message.toolName === finalMsg.toolName)
              ));
            const toolInput = getToolCallInput(currentToolMessage, finalMsg.toolCallId, finalMsg.toolName);
            const shouldExtractToolArtifacts = shouldExtractRawFilePathsForTool(finalMsg.toolName, toolInput);
            if (shouldExtractToolArtifacts) {
              extractImagesAsAttachedFiles(finalMsg.content).forEach(pushToolFile);
            }
            const artifactExtractionOptions = {
              artifactBaseDir: resolveAgentWorkspace(get().currentAgentId),
            };
            if (shouldExtractToolArtifacts && !isErroredToolResult(finalMsg)) {
              for (const ref of extractToolInputArtifactRefs(finalMsg.toolName, toolInput, artifactExtractionOptions)) {
                pushToolFile(makeAttachedFile(ref));
              }
            }
            if (shouldExtractToolArtifacts && text && !isErroredToolResult(finalMsg)) {
              const mediaDirectiveSources = extractMediaDirectiveSources(text);
              const mediaDirectivePathSet = new Set(
                mediaDirectiveSources.filter((source) => !/^https?:\/\//i.test(source)),
              );
              for (const source of mediaDirectiveSources) pushToolFile(makeAttachedFileFromMediaSource(source));
              const mediaRefs = extractMediaRefs(text);
              const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
              for (const ref of mediaRefs) pushToolFile(makeAttachedFile(ref));
              for (const ref of extractRawFilePaths(text, artifactExtractionOptions)) {
                if (!mediaRefPaths.has(ref.filePath) && !mediaDirectivePathSet.has(ref.filePath)) {
                  pushToolFile(makeAttachedFile(ref));
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
              let nextStreamingTextLastEventAt = s.streamingTextLastEventAt;
              let entry = nextToolStreamById.get(toolCallId);
              if (!entry && s.streamingText.trim()) {
                const frozenTs = s.streamingTextLastEventAt ?? s.streamingTextStartedAt ?? finalMsg.timestamp ?? Date.now() / 1000;
                nextStreamSegments = [
                  ...s.streamSegments,
                  { text: s.streamingText, ts: frozenTs },
                ];
                nextStreamingText = '';
                nextStreamingTextStartedAt = null;
                nextStreamingTextLastEventAt = null;
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
                streamingTextLastEventAt: nextStreamingTextLastEventAt,
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

          if (isInternalMessage(finalMsg)) {
            clearHistoryPoll();
            set(createRunResetState());
            void get().loadHistory(true);
            replayBlockedRunEvents(completeSteeredQueuedMessagesForRun(runId, set, get), get);
            scheduleQueuedMessageFlush(get);
            break;
          }

          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          const hadToolEvents = get().toolStreamOrder.length > 0;
          const shouldDeferFinalAssistantText = hasOutput && hasRunningLiveToolMessages(get().toolMessages);
          const msgId = finalMsg.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          const inlineMediaFiles = (() => {
            const text = getMessageText(finalMsg.content);
            if (!text) return [] as AttachedFileMeta[];
            return extractAssistantInlineArtifactFiles(text, {
              artifactBaseDir: resolveAgentWorkspace(get().currentAgentId),
            });
          })();
          if (shouldDeferFinalAssistantText) {
            const nextText = extractTextFromRuntimeMessage(finalMsg);
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
                    ?? (typeof finalMsg.timestamp === 'number' ? finalMsg.timestamp : Date.now() / 1000)
                  )
                : s.streamingTextStartedAt,
              streamingTextLastEventAt: nextText.trim()
                ? (typeof finalMsg.timestamp === 'number' ? finalMsg.timestamp : Date.now() / 1000)
                : s.streamingTextLastEventAt,
              pendingFinal: true,
            }));
            break;
          }
          set((s) => {
            const liveToolStatuses = collectLiveToolStatuses(s.toolMessages);
            const orderedLiveContentBlocks = buildOrderedLiveAssistantContentBlocks(s.streamSegments, s.toolMessages);
            const pendingImgs = s.pendingToolImages;
            const limitedMessageAttachments = limitAttachedFilesForMessage(
              [...(finalMsg._attachedFiles || []), ...inlineMediaFiles, ...pendingImgs],
              (finalMsg._hiddenAttachmentCount || 0) + s.pendingToolHiddenCount,
            );
            const normalizedFinalContent = orderedLiveContentBlocks.length > 0
              ? normalizeFinalAssistantContentBlocks(finalMsg.content, s.streamSegments)
              : Array.isArray(finalMsg.content)
                ? finalMsg.content
                : (typeof finalMsg.content === 'string' && finalMsg.content.trim())
                  ? [{ type: 'text', text: finalMsg.content.trim() } satisfies ContentBlock]
                  : [];
            const msgWithImages: RawMessage = {
              ...finalMsg,
              role: (finalMsg.role || 'assistant') as RawMessage['role'],
              id: msgId,
              content: orderedLiveContentBlocks.length > 0
                ? [...orderedLiveContentBlocks, ...normalizedFinalContent]
                : finalMsg.content,
              _toolStatuses: liveToolStatuses.length > 0
                ? upsertToolStatuses(finalMsg._toolStatuses || [], liveToolStatuses)
                : finalMsg._toolStatuses,
              ...(limitedMessageAttachments.files.length > 0
                ? { _attachedFiles: limitedMessageAttachments.files }
                : {}),
              _hiddenAttachmentCount: limitedMessageAttachments.hiddenCount || undefined,
            };
            const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[], pendingToolHiddenCount: 0 };
            const alreadyExists = hasEquivalentFinalAssistantMessage(s.messages, msgWithImages, msgId);
            if (alreadyExists) {
              return {
                messages: mergeToolStatusesIntoEquivalentAssistantMessage(s.messages, msgWithImages, liveToolStatuses),
                ...(hasOutput ? createEmptyToolRuntimeState() : {}),
                sending: hasOutput ? false : s.sending,
                sendAckPending: hasOutput ? false : s.sendAckPending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                pendingOptimisticUserId: hasOutput ? null : s.pendingOptimisticUserId,
                pendingOptimisticUserAnchorAt: hasOutput ? null : s.pendingOptimisticUserAnchorAt,
                pendingOptimisticUserIndex: hasOutput ? null : s.pendingOptimisticUserIndex,
                ...clearPendingImages,
              };
            }
            return {
              messages: [...s.messages, msgWithImages],
              ...(hasOutput ? createEmptyToolRuntimeState() : {}),
              sending: hasOutput ? false : s.sending,
              sendAckPending: hasOutput ? false : s.sendAckPending,
              activeRunId: hasOutput ? null : s.activeRunId,
              pendingFinal: hasOutput ? false : true,
              pendingOptimisticUserId: hasOutput ? null : s.pendingOptimisticUserId,
              pendingOptimisticUserAnchorAt: hasOutput ? null : s.pendingOptimisticUserAnchorAt,
              pendingOptimisticUserIndex: hasOutput ? null : s.pendingOptimisticUserIndex,
              ...clearPendingImages,
            };
          });
          if (hasOutput && hadToolEvents && !toolOnly) {
            clearHistoryPoll();
            void get().loadHistory(true, 'tool_patch');
          }
          if (hasOutput) {
            scheduleSessionToolFallbackUnsubscribe(`terminal-final:${runId || 'unknown'}`);
            const replayRunId = completeSteeredQueuedMessagesForRun(runId, set, get);
            replayBlockedRunEvents(replayRunId, get);
            scheduleQueuedMessageFlush(get);
          }
        } else {
          if (get().pendingOptimisticUserId) {
            set({
              pendingFinal: true,
              sendAckPending: false,
            });
            void get().loadHistory(true);
            break;
          }

          set({
            sending: false,
            sendAckPending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingOptimisticUserId: null,
            pendingOptimisticUserAnchorAt: null,
            pendingOptimisticUserIndex: null,
            ...createEmptyToolRuntimeState(),
          });
          scheduleSessionToolFallbackUnsubscribe(`terminal-final-empty:${runId || 'unknown'}`);
          get().loadHistory();
          const replayRunId = completeSteeredQueuedMessagesForRun(runId, set, get);
          replayBlockedRunEvents(replayRunId, get);
          scheduleQueuedMessageFlush(get);
        }
        break;
      }
      case 'error': {
        const errorMsg = getLocalizedRuntimeErrorMessage(event);
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
          error: terminalAssistantError ? null : errorMsg,
          runError: terminalAssistantError ? errorMsg : null,
          ...createEmptyToolRuntimeState(),
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingOptimisticUserId: null,
          pendingOptimisticUserAnchorAt: null,
          pendingOptimisticUserIndex: null,
          pendingToolImages: [],
          pendingToolHiddenCount: 0,
        });

        if (terminalAssistantError) {
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          set({
            sending: false,
            sendAckPending: false,
            activeRunId: null,
          });
          scheduleSessionToolFallbackUnsubscribe(`terminal-error:${runId || 'unknown'}`);
          void get().loadHistory(true);
          replayBlockedRunEvents(completeSteeredQueuedMessagesForRun(runId, set, get), get);
          scheduleQueuedMessageFlush(get);
          break;
        }

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
                sendAckPending: false,
                activeRunId: null,
                lastUserMessageAt: null,
                pendingOptimisticUserId: null,
                pendingOptimisticUserAnchorAt: null,
                pendingOptimisticUserIndex: null,
              });
              state.loadHistory(true);
              replayBlockedRunEvents(completeSteeredQueuedMessagesForRun(runId, set, get), get);
              scheduleQueuedMessageFlush(get);
            }
          }, ERROR_RECOVERY_GRACE_MS);
        } else {
          clearHistoryPoll();
          set({
            sending: false,
            sendAckPending: false,
            activeRunId: null,
            lastUserMessageAt: null,
            pendingOptimisticUserId: null,
            pendingOptimisticUserAnchorAt: null,
            pendingOptimisticUserIndex: null,
          });
          replayBlockedRunEvents(completeSteeredQueuedMessagesForRun(runId, set, get), get);
          scheduleQueuedMessageFlush(get);
        }
        break;
      }
      case 'aborted': {
        clearHistoryPoll();
        clearErrorRecoveryTimer();
        set(createRunResetState());
        scheduleSessionToolFallbackUnsubscribe(`terminal-aborted:${runId || 'unknown'}`);
        replayBlockedRunEvents(completeSteeredQueuedMessagesForRun(runId, set, get), get);
        scheduleQueuedMessageFlush(get);
        break;
      }
      default: {
        const { sending } = get();
        if (sending && eventMessage && typeof eventMessage === 'object') {
          console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
          const nextText = extractTextFromRuntimeMessage(eventMessage);
          const eventTimestamp = typeof (eventMessage as RawMessage | undefined)?.timestamp === 'number'
            ? (eventMessage as RawMessage).timestamp
            : undefined;
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
                  ?? (typeof (eventMessage as RawMessage | undefined)?.timestamp === 'number'
                    ? (eventMessage as RawMessage).timestamp!
                    : Date.now() / 1000)
                )
              : s.streamingTextStartedAt,
            streamingTextLastEventAt: nextText.trim()
              ? (eventTimestamp ?? Date.now() / 1000)
              : s.streamingTextLastEventAt,
          }));
        }
        break;
      }
    }
  },

  handleToolEvent: (source: 'agent' | 'session.tool', event: Record<string, unknown>) => {
    const runId = getToolEventRunId(event);
    if (source === 'agent' && runId) {
      rememberRunScopedSubscribedRunId(runId);
    }
    if (source === 'session.tool' && runId && _runScopedSubscribedRunIds.has(runId)) {
      return;
    }

    const dedupeKey = getToolEventDedupeKey(event);
    if (dedupeKey && _seenToolEventKeys.has(dedupeKey)) {
      return;
    }
    if (dedupeKey) {
      rememberToolEventKey(dedupeKey);
    }
    get().handleAgentEvent(event);
  },

  handleAgentEvent: (event: Record<string, unknown>) => {
    const stream = String(event.stream || '');
    if (stream !== 'tool') {
      return;
    }

    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : event;
    const eventSessionKey = getToolEventSessionKey(event) || null;
    const runId = getToolEventRunId(event);

    if (eventSessionKey && eventSessionKey !== get().currentSessionKey) {
      return;
    }

    if (runId && _abortedRunIds.has(runId)) {
      return;
    }

    const activeRunId = get().activeRunId;
    if (activeRunId && runId && runId !== activeRunId) {
      const pendingSteeredMessage = get().queuedMessages.find((message) => (
        message.kind === 'steered'
        && message.pendingRunId === activeRunId
        && (!message.steerRunId || message.steerRunId === runId)
      ));
      if (pendingSteeredMessage) {
        if (!pendingSteeredMessage.steerRunId) {
          set((state) => ({
            queuedMessages: state.queuedMessages.map((message) => (
              message.id === pendingSteeredMessage.id
                ? { ...message, steerRunId: runId }
                : message
            )),
          }));
        }
        queueBlockedRunEvent(runId, { kind: 'tool', event });
        return;
      }
    }

    if (_blockUnknownAbortedRunEvents && runId) {
      if (!get().activeRunId && get().sending) {
        queueBlockedRunEvent(runId, { kind: 'tool', event });
      }
      return;
    }

    const toolCallId = getToolEventToolCallId(event);
    if (!toolCallId) {
      return;
    }

    const name = getToolEventName(event) || 'tool';
    const phase = getToolEventPhase(event);
    const rawOutput = getToolEventRawOutput(event, phase);
    const output = extractToolOutputText(rawOutput) ?? undefined;
    const meta = data.meta && typeof data.meta === 'object' ? data.meta as Record<string, unknown> : undefined;
    const rawDuration = meta?.durationMs ?? meta?.duration ?? data.durationMs;
    const durationMs = parseDurationMs(rawDuration);
    const status: ToolStatus['status'] = phase === 'result'
      ? (isToolEventError(event, output) ? 'error' : 'completed')
      : 'running';
    const startedAt = typeof event.ts === 'number' ? event.ts : Date.now() / 1000;
    const shouldReloadHistoryForMissingResult = phase === 'result'
      && output === undefined
      && !get().toolResultHistoryReloadedIds.has(toolCallId);

    _lastChatEventAt = Date.now();
    clearHistoryPoll();

    if (_errorRecoveryTimer) {
      clearErrorRecoveryTimer();
      set({ error: null, runError: null });
    }

    set((s) => {
      const nextToolStreamById = new Map(s.toolStreamById);
      const nextToolStreamOrder = [...s.toolStreamOrder];
      const nextToolResultHistoryReloadedIds = new Set(s.toolResultHistoryReloadedIds);
      let nextStreamSegments = s.streamSegments;
      let nextStreamingText = s.streamingText;
      let nextStreamingTextStartedAt = s.streamingTextStartedAt;
      let nextStreamingTextLastEventAt = s.streamingTextLastEventAt;

      let entry = nextToolStreamById.get(toolCallId);
      if (!entry) {
        if (s.streamingText.trim()) {
          const frozenTs = s.streamingTextLastEventAt ?? s.streamingTextStartedAt ?? startedAt;
          nextStreamSegments = [
            ...s.streamSegments,
            { text: s.streamingText, ts: frozenTs },
          ];
          nextStreamingText = '';
          nextStreamingTextStartedAt = null;
          nextStreamingTextLastEventAt = null;
        }
        entry = {
          toolCallId,
          runId: runId || s.activeRunId || '',
          sessionKey: eventSessionKey ?? undefined,
          name,
          args: getToolEventArgs(event, phase),
          output,
          status,
          durationMs,
          startedAt,
          updatedAt: Date.now(),
          historyReloadRequestedAt: shouldReloadHistoryForMissingResult ? Date.now() : undefined,
          message: {} as RawMessage,
        };
        nextToolStreamOrder.push(toolCallId);
      } else {
        entry = {
          ...entry,
          name,
          args: getToolEventArgs(event, phase) ?? entry.args,
          output: output ?? entry.output,
          status: mergeToolStatus(entry.status, status),
          durationMs: durationMs ?? entry.durationMs,
          updatedAt: Date.now(),
          historyReloadRequestedAt: shouldReloadHistoryForMissingResult
            ? (entry.historyReloadRequestedAt ?? Date.now())
            : entry.historyReloadRequestedAt,
        };
      }

      if (shouldReloadHistoryForMissingResult) {
        nextToolResultHistoryReloadedIds.add(toolCallId);
      }

      entry.message = buildToolStreamMessage(entry);
      nextToolStreamById.set(toolCallId, entry);

      return {
        sending: true,
        // Tool stream runIds can differ from chat stream runIds; keep the
        // active chat run id stable so later text deltas are not filtered out.
        activeRunId: s.activeRunId,
        error: null,
        runError: null,
        pendingFinal: phase === 'result' ? true : s.pendingFinal,
        streamingText: nextStreamingText,
        streamingTextStartedAt: nextStreamingTextStartedAt,
        streamingTextLastEventAt: nextStreamingTextLastEventAt,
        streamSegments: nextStreamSegments,
        toolStreamById: nextToolStreamById,
        toolStreamOrder: nextToolStreamOrder,
        toolResultHistoryReloadedIds: nextToolResultHistoryReloadedIds,
        toolMessages: syncToolMessages(nextToolStreamOrder, nextToolStreamById),
      };
    });

    if (get().pendingFinal && get().streamingText.trim() && !hasRunningLiveToolMessages(get().toolMessages)) {
      void get().loadHistory(true);
    } else if (shouldReloadHistoryForMissingResult) {
      void get().loadHistory(true, 'tool_patch');
    }
  },

  handleSessionMessageEvent: (event: Record<string, unknown>) => {
    const message = getSessionMessage(event);
    if (!message) return;
    if (String(message.role).toLowerCase() === 'assistant') {
      return;
    }

    const eventSessionKey = getSessionMessagePayloadSessionKey(event, message);
    if (eventSessionKey && eventSessionKey !== get().currentSessionKey) {
      return;
    }

    const [displayMessage] = prepareHistoryMessagesForDisplay([message], {
      artifactBaseDir: resolveAgentWorkspace(get().currentAgentId),
    });
    if (!displayMessage || isInternalMessage(displayMessage)) return;
    if (hasMatchingSteeredQueuedMessage(get(), displayMessage)) {
      return;
    }

    set((state) => {
      let existingIndex = state.messages.findIndex((current) => messagesMatch(current, displayMessage));
      if (existingIndex < 0 && displayMessage.role === 'user' && state.pendingOptimisticUserId) {
        const incomingText = getMessageText(displayMessage.content);
        existingIndex = state.messages.findIndex((current) => (
          current.id === state.pendingOptimisticUserId
          && current.role === 'user'
          && getMessageText(current.content) === incomingText
        ));
      }
      if (existingIndex >= 0) {
        const nextMessages = [...state.messages];
        nextMessages[existingIndex] = {
          ...nextMessages[existingIndex],
          ...displayMessage,
        };
        return { messages: nextMessages };
      }

      return {
        messages: [...state.messages, displayMessage],
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

  clearError: () => set({ error: null, runError: null }),

  queueComposerSeed: (text: string, tokenizableSkillSlugs?: string[]) => set({
    pendingComposerSeed: {
      text,
      nonce: Date.now(),
      tokenizableSkillSlugs,
    },
  }),

  consumePendingComposerSeed: () => set({ pendingComposerSeed: null }),

  setEvolutionProposalDecision: async (proposalId, decision) => {
    const { currentDesktopSessionId, desktopSessions } = get();
    if (!currentDesktopSessionId || !proposalId.trim()) {
      return;
    }

    const currentSession = desktopSessions.find((session) => session.id === currentDesktopSessionId);
    if (!currentSession) {
      return;
    }

    const nextProposalStateEntries = upsertProposalDecisionEntry(
      currentSession.proposalStateEntries,
      proposalId,
      decision,
    );

    set((state) => ({
      desktopSessions: state.desktopSessions.map((session) => (
        session.id === currentDesktopSessionId
          ? { ...session, proposalStateEntries: nextProposalStateEntries }
          : session
      )),
    }));

    try {
      const updatedSession = await updateDesktopSessionRequest(currentDesktopSessionId, {
        proposalStateEntries: nextProposalStateEntries,
      });
      set((state) => ({
        desktopSessions: state.desktopSessions.map((session) => (
          session.id === currentDesktopSessionId ? updatedSession : session
        )),
      }));
    } catch (error) {
      console.warn(`Failed to persist proposal decision for desktop session ${currentDesktopSessionId}:`, error);
    }
  },
}));
