import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { buildCronUpdatePatch, normalizeCronDelivery, toUiCronDelivery, type GatewayCronDelivery } from '../../utils/cron-delivery';
import { getOpenClawConfigDir } from '../../utils/paths';
import type { CronSchedule } from '../../../src/types/cron';

interface GatewayCronJob {
  id: string;
  name: string;
  agentId?: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: GatewayCronDelivery;
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
}

interface CronRunSummary {
  id: string;
  sessionId?: string;
  sessionKey?: string;
  status: 'ok' | 'error' | 'running' | 'unknown';
  summary?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  model?: string;
  provider?: string;
}

interface CronAgentRunSummary extends CronRunSummary {
  jobId: string;
  jobName: string;
  agentId?: string;
}

interface CronMessagePayload {
  id: string;
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
  isError?: boolean;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function getCronRunEntryId(entry: CronRunLogEntry, index = 0): string {
  return String(entry.sessionId || entry.sessionKey || entry.ts || entry.runAtMs || `run-${index}`);
}

function transformCronRun(entry: CronRunLogEntry, index: number): CronRunSummary {
  const startedAtMs = normalizeTimestampMs(entry.runAtMs);
  const finishedAtMs = normalizeTimestampMs(entry.ts) ?? startedAtMs;
  const normalizedStatus = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const status: CronRunSummary['status'] = normalizedStatus === 'ok' || normalizedStatus === 'success'
    ? 'ok'
    : normalizedStatus === 'error'
      ? 'error'
      : normalizedStatus === 'running'
        ? 'running'
        : 'unknown';

  return {
    id: getCronRunEntryId(entry, index),
    sessionId: entry.sessionId,
    sessionKey: entry.sessionKey,
    status,
    summary: typeof entry.summary === 'string' ? entry.summary : undefined,
    error: typeof entry.error === 'string' ? entry.error : undefined,
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : undefined,
    finishedAt: finishedAtMs ? new Date(finishedAtMs).toISOString() : undefined,
    durationMs: entry.durationMs,
    model: entry.model,
    provider: entry.provider,
  };
}

function getCronRunSortTimestamp(run: Pick<CronRunSummary, 'finishedAt' | 'startedAt'>): number {
  return normalizeTimestampMs(run.finishedAt) ?? normalizeTimestampMs(run.startedAt) ?? 0;
}

function buildCronRunMessage(
  entry: CronRunLogEntry | undefined,
  index: number,
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>,
): CronMessagePayload[] {
  const messages: CronMessagePayload[] = [];
  const prompt = job?.payload?.message || job?.payload?.text || '';
  const taskName = job?.name?.trim() || '';
  const baseTs = normalizeTimestampMs(entry?.runAtMs)
    ?? normalizeTimestampMs(entry?.ts)
    ?? normalizeTimestampMs(job?.state?.runningAtMs)
    ?? Date.now();

  if (taskName || prompt) {
    const lines = [taskName ? `Scheduled task: ${taskName}` : 'Scheduled task'];
    if (prompt) lines.push(`Prompt: ${prompt}`);
    messages.push({
      id: `cron-meta-${job?.name || 'job'}-${index}`,
      role: 'system',
      content: lines.join('\n'),
      timestamp: Math.max(0, baseTs - 1),
    });
  }

  if (!entry) {
    messages.push({
      id: `cron-empty-${index}`,
      role: 'system',
      content: 'No run transcript is available for this scheduled task yet.',
      timestamp: baseTs,
    });
    return messages;
  }

  const normalizedStatus = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = summary || error;

  if (!content) {
    content = normalizedStatus === 'error'
      ? 'Scheduled task failed.'
      : normalizedStatus === 'running'
        ? 'Scheduled task is running.'
        : 'Scheduled task completed.';
  }

  if (normalizedStatus === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) {
    meta.push(`Model: ${entry.provider}/${entry.model}`);
  } else if (entry.model) {
    meta.push(`Model: ${entry.model}`);
  }
  if (meta.length > 0) {
    content = `${content}\n\n${meta.join(' | ')}`;
  }

  messages.push({
    id: `cron-run-${getCronRunEntryId(entry, index)}`,
    role: normalizedStatus === 'error' ? 'system' : 'assistant',
    content,
    timestamp: normalizeTimestampMs(entry.ts) ?? baseTs,
    ...(normalizedStatus === 'error' ? { isError: true } : {}),
  });

  return messages;
}

async function readCronRunLog(jobId: string): Promise<CronRunLogEntry[]> {
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  const entries: CronRunLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (!entry || entry.jobId !== jobId) continue;
      if (entry.action && entry.action !== 'finished') continue;
      entries.push(entry);
    } catch {
      // Ignore malformed log lines.
    }
  }

  return entries;
}

function transformCronJob(job: GatewayCronJob) {
  const message = job.payload?.message || job.payload?.text || '';
  const delivery = toUiCronDelivery(job.delivery);
  const channelType = delivery?.channel;
  const target = channelType && channelType !== 'last'
    ? { channelType, channelId: delivery?.accountId || channelType, channelName: channelType }
    : undefined;
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;
  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule,
    agentId: job.agentId,
    target,
    delivery,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

export async function handleCronRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname.match(/^\/api\/cron\/jobs\/[^/]+\/runs$/) && req.method === 'GET') {
    try {
      const jobId = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length, -'/runs'.length));
      const [jobsResult, runEntries] = await Promise.all([
        ctx.gatewayManager.rpc('cron.list', { includeDisabled: true }).catch(() => ({ jobs: [] as GatewayCronJob[] })),
        readCronRunLog(jobId),
      ]);
      const jobs = (jobsResult as { jobs?: GatewayCronJob[] }).jobs ?? [];
      const job = jobs.find((entry) => entry.id === jobId);
      const runs = [...runEntries]
        .sort((left, right) => {
          const leftTs = normalizeTimestampMs(left.ts) ?? normalizeTimestampMs(left.runAtMs) ?? 0;
          const rightTs = normalizeTimestampMs(right.ts) ?? normalizeTimestampMs(right.runAtMs) ?? 0;
          return rightTs - leftTs;
        })
        .map((entry, index) => transformCronRun(entry, index));

      sendJson(res, 200, {
        job: job ? transformCronJob(job) : null,
        runs,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.match(/^\/api\/cron\/jobs\/[^/]+\/messages$/) && req.method === 'GET') {
    try {
      const jobId = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length, -'/messages'.length));
      const runId = url.searchParams.get('runId')?.trim() || '';
      const rawLimit = Number(url.searchParams.get('limit') || '200');
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
        : 200;

      const [jobsResult, runEntries] = await Promise.all([
        ctx.gatewayManager.rpc('cron.list', { includeDisabled: true }).catch(() => ({ jobs: [] as GatewayCronJob[] })),
        readCronRunLog(jobId),
      ]);

      const jobs = (jobsResult as { jobs?: GatewayCronJob[] }).jobs ?? [];
      const job = jobs.find((entry) => entry.id === jobId);
      const selectedEntry = [...runEntries]
        .sort((left, right) => {
          const leftTs = normalizeTimestampMs(left.ts) ?? normalizeTimestampMs(left.runAtMs) ?? 0;
          const rightTs = normalizeTimestampMs(right.ts) ?? normalizeTimestampMs(right.runAtMs) ?? 0;
          return rightTs - leftTs;
        })
        .find((entry, index) => getCronRunEntryId(entry, index) === runId)
        ?? runEntries[0];

      let messages: unknown[] = [];
      if (selectedEntry?.sessionKey) {
        try {
          const history = await ctx.gatewayManager.rpc('chat.history', {
            sessionKey: selectedEntry.sessionKey,
            limit,
          }) as { messages?: unknown[] };
          if (Array.isArray(history.messages) && history.messages.length > 0) {
            messages = history.messages;
          }
        } catch {
          // Ignore and fall back to synthetic messages below.
        }
      }

      if (messages.length === 0) {
        messages = buildCronRunMessage(selectedEntry, 0, job).slice(-limit);
      }

      sendJson(res, 200, {
        job: job ? transformCronJob(job) : null,
        run: selectedEntry ? transformCronRun(selectedEntry, 0) : null,
        messages,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.match(/^\/api\/cron\/agents\/[^/]+\/runs$/) && req.method === 'GET') {
    try {
      const agentId = decodeURIComponent(url.pathname.slice('/api/cron/agents/'.length, -'/runs'.length));
      const rawLimit = Number(url.searchParams.get('limit') || '100');
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
        : 100;
      const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true }).catch(() => ({ jobs: [] as GatewayCronJob[] }));
      const jobs = ((result as { jobs?: GatewayCronJob[] }).jobs ?? []).filter((job) => job.agentId === agentId);
      const runGroups = await Promise.all(jobs.map(async (job) => ({
        job,
        entries: await readCronRunLog(job.id),
      })));

      const runs: CronAgentRunSummary[] = runGroups.flatMap(({ job, entries }) => (
        entries.map((entry, index) => {
          const run = transformCronRun(entry, index);
          return {
            ...run,
            jobId: job.id,
            jobName: job.name,
            agentId: job.agentId,
          };
        })
      ))
        .sort((left, right) => getCronRunSortTimestamp(right) - getCronRunSortTimestamp(left))
        .slice(0, limit);

      sendJson(res, 200, { runs });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'GET') {
    try {
      const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];
      for (const job of jobs) {
        const isIsolatedAgent =
          (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
          job.payload?.kind === 'agentTurn';
        const needsRepair =
          isIsolatedAgent &&
          job.delivery?.mode === 'announce' &&
          !job.delivery?.channel;
        if (needsRepair) {
          try {
            await ctx.gatewayManager.rpc('cron.update', {
              id: job.id,
              patch: { delivery: { mode: 'none' } },
            });
            job.delivery = { mode: 'none' };
            if (job.state?.lastError?.includes('Channel is required')) {
              job.state.lastError = undefined;
              job.state.lastStatus = 'ok';
            }
          } catch {
            // ignore per-job repair failure
          }
        }
      }
      sendJson(res, 200, jobs.map(transformCronJob));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'POST') {
    try {
      const input = await parseJsonBody<{
        name: string;
        message: string;
        schedule: CronSchedule;
        enabled?: boolean;
        delivery?: GatewayCronDelivery;
        agentId?: string;
      }>(req);
      const delivery = normalizeCronDelivery(input.delivery);
      const result = await ctx.gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: input.schedule,
        payload: { kind: 'agentTurn', message: input.message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        delivery,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      sendJson(res, 200, result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      const input = await parseJsonBody<Record<string, unknown>>(req);
      const patch = buildCronUpdatePatch(input);
      const result = await ctx.gatewayManager.rpc('cron.update', { id, patch });
      sendJson(res, 200, result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.remove', { id }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/toggle' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string; enabled: boolean }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.update', { id: body.id, patch: { enabled: body.enabled } }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/trigger' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.run', { id: body.id, mode: 'force' }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
