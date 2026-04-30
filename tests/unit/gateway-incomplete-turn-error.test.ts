import { describe, expect, it } from 'vitest';
import {
  createIncompleteTurnChatErrorEvent,
  parseIncompleteTurnErrorLine,
} from '@electron/gateway/incomplete-turn-error';

describe('gateway incomplete turn error bridge', () => {
  it('parses the stderr incomplete-turn line emitted by the embedded agent', () => {
    const line = '\u001b[90m2026-04-30T11:44:41.425+08:00\u001b[39m \u001b[33m[agent/embedded]\u001b[39m \u001b[33mincomplete turn detected: runId=1a3ec31e-ce3c-4e69-9aa2-fda9b9d02ccf sessionId=07e62e35-33dd-4cc8-8c51-ccef5a744667 stopReason=stop payloads=0 - surfacing error to user\u001b[39m';

    expect(parseIncompleteTurnErrorLine(line)).toEqual({
      runId: '1a3ec31e-ce3c-4e69-9aa2-fda9b9d02ccf',
      sessionId: '07e62e35-33dd-4cc8-8c51-ccef5a744667',
      stopReason: 'stop',
    });
  });

  it('creates a chat error event that the renderer can route by run id', () => {
    const event = createIncompleteTurnChatErrorEvent({
      runId: 'run-1',
      sessionId: 'session-1',
      stopReason: 'stop',
    });

    expect(event).toMatchObject({
      message: {
        runId: 'run-1',
        state: 'error',
        errorCode: 'gateway.incompleteTurn',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorCode: 'gateway.incompleteTurn',
          isError: true,
        },
      },
    });
    expect(event.message.message.timestamp).toEqual(expect.any(Number));
  });
});
