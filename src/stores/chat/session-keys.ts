import type { CronAgentRunSummary } from '@/types/cron';

export function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

export function buildCronRunSessionKey(
  run: Pick<CronAgentRunSummary, 'agentId' | 'jobId' | 'id' | 'sessionKey'>,
): string {
  return run.sessionKey || `agent:${run.agentId || 'main'}:cron:${run.jobId}:run:${run.id}`;
}

export function buildDefaultMainSessionKey(agentId: string): string {
  return `agent:${agentId}:geeclaw_main`;
}

export function buildTemporarySessionKey(agentId: string): string {
  return `agent:${agentId}:geeclaw_tmp_${crypto.randomUUID()}`;
}
