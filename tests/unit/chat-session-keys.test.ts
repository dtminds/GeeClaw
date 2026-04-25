import { describe, expect, it, vi } from 'vitest';

import {
  buildCronRunSessionKey,
  buildDefaultMainSessionKey,
  buildTemporarySessionKey,
  getAgentIdFromSessionKey,
} from '@/stores/chat/session-keys';

describe('chat session key helpers', () => {
  it('resolves agent ids from agent-scoped session keys', () => {
    expect(getAgentIdFromSessionKey('agent:writer:geeclaw_main')).toBe('writer');
    expect(getAgentIdFromSessionKey('legacy-session')).toBe('main');
    expect(getAgentIdFromSessionKey('agent::geeclaw_main')).toBe('main');
  });

  it('builds stable main and cron run session keys', () => {
    expect(buildDefaultMainSessionKey('writer')).toBe('agent:writer:geeclaw_main');
    expect(buildCronRunSessionKey({
      agentId: 'writer',
      jobId: 'job-1',
      id: 'run-1',
    })).toBe('agent:writer:cron:job-1:run:run-1');
    expect(buildCronRunSessionKey({
      agentId: 'writer',
      jobId: 'job-1',
      id: 'run-1',
      sessionKey: 'existing-key',
    })).toBe('existing-key');
  });

  it('builds temporary keys with the generated uuid', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-1');

    expect(buildTemporarySessionKey('writer')).toBe('agent:writer:geeclaw_tmp_uuid-1');

    randomUUID.mockRestore();
  });
});
