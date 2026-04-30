import { GATEWAY_INCOMPLETE_TURN_ERROR_CODE } from '../../shared/chat-errors';

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export interface IncompleteTurnErrorInfo {
  runId: string;
  sessionId: string;
  stopReason: string;
}

export interface IncompleteTurnChatErrorEvent {
  message: {
    runId: string;
    state: 'error';
    errorCode: string;
    message: {
      role: 'assistant';
      content: string;
      stopReason: 'error';
      errorCode: string;
      isError: true;
      timestamp: number;
    };
  };
}

const INCOMPLETE_TURN_PATTERN = /incomplete turn detected:\s+runId=(\S+)\s+sessionId=(\S+)\s+stopReason=(\S+)\s+payloads=0\b/i;

export function parseIncompleteTurnErrorLine(line: string): IncompleteTurnErrorInfo | null {
  const normalized = line.replace(ANSI_ESCAPE_PATTERN, '');
  const match = normalized.match(INCOMPLETE_TURN_PATTERN);
  if (!match) return null;

  return {
    runId: match[1],
    sessionId: match[2],
    stopReason: match[3],
  };
}

export function createIncompleteTurnChatErrorEvent(info: IncompleteTurnErrorInfo): IncompleteTurnChatErrorEvent {
  return {
    message: {
      runId: info.runId,
      state: 'error',
      errorCode: GATEWAY_INCOMPLETE_TURN_ERROR_CODE,
      message: {
        role: 'assistant',
        content: '',
        stopReason: 'error',
        errorCode: GATEWAY_INCOMPLETE_TURN_ERROR_CODE,
        isError: true,
        timestamp: Date.now(),
      },
    },
  };
}
