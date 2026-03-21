import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  extractRawFilePaths,
  getMessageText,
  hasEquivalentFinalAssistantMessage,
  getToolCallInput,
  hasErrorRecoveryTimer,
  hasNonToolAssistantContent,
  isErroredToolResult,
  isToolOnlyMessage,
  isToolResultRole,
  limitAttachedFilesForMessage,
  makeAttachedFile,
  resolveToolLikeName,
  setErrorRecoveryTimer,
  stripRenderedPrefixFromStreamingText,
  shouldDisplayToolResultFileRef,
  shouldExtractRawFilePathsForTool,
} from './helpers';
import type { AttachedFileMeta, RawMessage, ToolStatus, ToolStreamEntry } from './types';
import type { ChatGet, ChatSet } from './store-api';

function extractRuntimeText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const contentText = getMessageText(record.content);
  if (contentText.trim()) return contentText;
  return typeof record.text === 'string' ? record.text : '';
}

function extractToolOutput(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mergeStatus(current: ToolStatus['status'], incoming: ToolStatus['status']): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, completed: 1, error: 2 };
  return order[incoming] >= order[current] ? incoming : current;
}

function buildToolMessage(entry: ToolStreamEntry): RawMessage {
  const content: Array<Record<string, unknown>> = [
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

function syncToolMessages(toolStreamOrder: string[], toolStreamById: Map<string, ToolStreamEntry>): RawMessage[] {
  return toolStreamOrder
    .map((id) => toolStreamById.get(id)?.message)
    .filter((message): message is RawMessage => Boolean(message));
}

function emptyLiveRuntimeState() {
  return {
    streamingText: '',
    streamingTextStartedAt: null,
    streamSegments: [] as Array<{ text: string; ts: number }>,
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [] as string[],
    toolMessages: [] as RawMessage[],
  };
}

export function handleRuntimeEventState(
  set: ChatSet,
  get: ChatGet,
  event: Record<string, unknown>,
  resolvedState: string,
  runId: string,
): void {
  switch (resolvedState) {
    case 'started': {
      if (!get().sending && runId) {
        set({ sending: true, activeRunId: runId, error: null });
      }
      break;
    }
    case 'delta': {
      if (hasErrorRecoveryTimer()) {
        clearErrorRecoveryTimer();
        set({ error: null });
      }
      const nextText = extractRuntimeText(event.message);
      set((state) => ({
        streamingText: nextText.trim()
          ? (() => {
              const visibleText = stripRenderedPrefixFromStreamingText(nextText, state.streamSegments);
              return !state.streamingText || visibleText.length >= state.streamingText.length
                ? visibleText
                : state.streamingText;
            })()
          : state.streamingText,
        streamingTextStartedAt: nextText.trim()
          ? (state.streamingTextStartedAt ?? Date.now() / 1000)
          : state.streamingTextStartedAt,
        pendingFinal: false,
      }));
      break;
    }
    case 'final': {
      clearErrorRecoveryTimer();
      if (get().error) set({ error: null });
      const finalMsg = event.message as RawMessage | undefined;
      if (!finalMsg) {
        set({ sending: false, activeRunId: null, pendingFinal: false, ...emptyLiveRuntimeState() });
        get().loadHistory();
        break;
      }

      if (isToolResultRole(finalMsg.role)) {
        const toolName = resolveToolLikeName(finalMsg);
        const toolFiles: AttachedFileMeta[] = [...extractImagesAsAttachedFiles(finalMsg.content)];
        const text = getMessageText(finalMsg.content);
        if (text && !isErroredToolResult(finalMsg)) {
          const mediaRefs = extractMediaRefs(text);
          const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));
          for (const ref of mediaRefs) {
            if (shouldDisplayToolResultFileRef(ref.filePath, toolName)) {
              toolFiles.push(makeAttachedFile(ref));
            }
          }
          const toolInput = getToolCallInput(undefined, finalMsg.toolCallId, toolName);
          if (shouldExtractRawFilePathsForTool(toolName, toolInput)) {
            for (const ref of extractRawFilePaths(text)) {
              const duplicateMediaRef = mediaRefPaths.has(ref.filePath);
              if (!duplicateMediaRef && shouldDisplayToolResultFileRef(ref.filePath, toolName)) {
                toolFiles.push(makeAttachedFile(ref));
              }
            }
          }
        }
        set((state) => {
          const pending = limitAttachedFilesForMessage(
            [...state.pendingToolImages, ...toolFiles],
            state.pendingToolHiddenCount,
          );
          return {
            pendingFinal: true,
            pendingToolImages: pending.files,
            pendingToolHiddenCount: pending.hiddenCount,
          };
        });
        break;
      }

      const toolOnly = isToolOnlyMessage(finalMsg);
      const hasOutput = hasNonToolAssistantContent(finalMsg);
      const msgId = finalMsg.id || `run-${runId}`;
      set((state) => {
        const limited = limitAttachedFilesForMessage(
          [...(finalMsg._attachedFiles || []), ...state.pendingToolImages],
          (finalMsg._hiddenAttachmentCount || 0) + state.pendingToolHiddenCount,
        );
        const nextMessage: RawMessage = {
          ...finalMsg,
          id: msgId,
          ...(limited.files.length > 0 ? { _attachedFiles: limited.files } : {}),
          _hiddenAttachmentCount: limited.hiddenCount || undefined,
        };
        const alreadyExists = hasEquivalentFinalAssistantMessage(state.messages, nextMessage, msgId);
        return {
          messages: alreadyExists ? state.messages : [...state.messages, nextMessage],
          sending: hasOutput ? false : state.sending,
          activeRunId: hasOutput ? null : state.activeRunId,
          pendingFinal: hasOutput ? false : true,
          pendingToolImages: [],
          pendingToolHiddenCount: 0,
          ...(hasOutput ? emptyLiveRuntimeState() : {}),
        };
      });
      if (hasOutput && !toolOnly) {
        clearHistoryPoll();
        void get().loadHistory(true);
      }
      break;
    }
    case 'error': {
      const errorMsg = String(event.errorMessage || 'An error occurred');
      const wasSending = get().sending;
      const { streamingText, streamingTextStartedAt } = get();

      if (streamingText.trim()) {
        set((state) => ({
          messages: [
            ...state.messages,
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
        pendingFinal: false,
        pendingToolImages: [],
        pendingToolHiddenCount: 0,
        ...emptyLiveRuntimeState(),
      });

      if (wasSending) {
        clearErrorRecoveryTimer();
        const ERROR_RECOVERY_GRACE_MS = 15_000;
        setErrorRecoveryTimer(setTimeout(() => {
          setErrorRecoveryTimer(null);
          const state = get();
          if (state.sending && !state.streamingText.trim() && state.toolMessages.length === 0) {
            clearHistoryPoll();
            set({ sending: false, activeRunId: null, lastUserMessageAt: null });
            state.loadHistory(true);
          }
        }, ERROR_RECOVERY_GRACE_MS));
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
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        pendingToolHiddenCount: 0,
        ...emptyLiveRuntimeState(),
      });
      break;
    }
    default: {
      if (get().sending && event.message && typeof event.message === 'object') {
        const nextText = extractRuntimeText(event.message);
        set((state) => ({
          streamingText: nextText.trim()
            ? (() => {
                const visibleText = stripRenderedPrefixFromStreamingText(nextText, state.streamSegments);
                return !state.streamingText || visibleText.length >= state.streamingText.length
                  ? visibleText
                  : state.streamingText;
              })()
            : state.streamingText,
          streamingTextStartedAt: nextText.trim()
            ? (state.streamingTextStartedAt ?? Date.now() / 1000)
            : state.streamingTextStartedAt,
        }));
      }
    }
  }
}

export function handleRuntimeToolEvent(
  set: ChatSet,
  get: ChatGet,
  payload: Record<string, unknown>,
): void {
  void get;
  const data = payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown>
    : payload;
  const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
  if (!toolCallId) return;

  const name = typeof data.name === 'string' ? data.name : 'tool';
  const phase = typeof data.phase === 'string' ? data.phase : '';
  const output = extractToolOutput(
    phase === 'update' ? data.partialResult : phase === 'result' ? data.result : undefined,
  );
  const status: ToolStatus['status'] = phase === 'result'
    ? (data.isError === true ? 'error' : 'completed')
    : 'running';
  const startedAt = typeof payload.ts === 'number' ? payload.ts : Date.now() / 1000;

  set((state) => {
    const nextToolStreamById = new Map(state.toolStreamById);
    const nextToolStreamOrder = [...state.toolStreamOrder];
    let nextStreamSegments = state.streamSegments;
    let nextStreamingText = state.streamingText;
    let nextStreamingTextStartedAt = state.streamingTextStartedAt;

    let entry = nextToolStreamById.get(toolCallId);
    if (!entry) {
      if (state.streamingText.trim()) {
        nextStreamSegments = [
          ...state.streamSegments,
          { text: state.streamingText, ts: state.streamingTextStartedAt ?? startedAt },
        ];
        nextStreamingText = '';
        nextStreamingTextStartedAt = null;
      }
      entry = {
        toolCallId,
        runId: String(payload.runId || state.activeRunId || ''),
        sessionKey: typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined,
        name,
        args: phase === 'start' ? data.args : undefined,
        output,
        status,
        durationMs: undefined,
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
        status: mergeStatus(entry.status, status),
        updatedAt: Date.now(),
      };
    }

    entry.message = buildToolMessage(entry);
    nextToolStreamById.set(toolCallId, entry);

    return {
      sending: true,
      // Tool stream runIds can differ from the chat text runId.
      // Preserve the active chat run so following deltas are still accepted.
      activeRunId: state.activeRunId,
      streamingText: nextStreamingText,
      streamingTextStartedAt: nextStreamingTextStartedAt,
      streamSegments: nextStreamSegments,
      toolStreamById: nextToolStreamById,
      toolStreamOrder: nextToolStreamOrder,
      toolMessages: syncToolMessages(nextToolStreamOrder, nextToolStreamById),
    };
  });
}
