import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronRight, History, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { hydrateHistoryMessagesForDisplay, type RawMessage } from '@/stores/chat';
import type { CronJob, CronRunSummary } from '@/types/cron';

type CronRunsResponse = {
  job: CronJob | null;
  runs: CronRunSummary[];
};

type CronRunMessagesResponse = {
  job: CronJob | null;
  run: CronRunSummary | null;
  messages: RawMessage[];
};

function formatRunTimestamp(run: CronRunSummary): string {
  const rawValue = run.finishedAt || run.startedAt;
  if (rawValue) {
    const date = new Date(rawValue);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
  }
  return '-';
}

function formatRunDuration(run: CronRunSummary, t: ReturnType<typeof useTranslation<'cron'>>['t']): string {
  if (!run.durationMs || !Number.isFinite(run.durationMs)) {
    return t('history.durationUnknown');
  }
  if (run.durationMs < 1000) return `${Math.round(run.durationMs)}ms`;
  if (run.durationMs < 10_000) return `${(run.durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(run.durationMs / 1000)}s`;
}

function statusPillClass(status: CronRunSummary['status']): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'error':
      return 'bg-destructive/10 text-destructive';
    case 'running':
      return 'bg-sky-500/10 text-sky-700 dark:text-sky-300';
    default:
      return 'bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]';
  }
}

function StatusIcon({ status }: { status: CronRunSummary['status'] }) {
  if (status === 'ok') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (status === 'error') return <AlertCircle className="h-3.5 w-3.5" />;
  return <History className="h-3.5 w-3.5" />;
}

export function CronRunHistoryPage() {
  const { t } = useTranslation('cron');
  const navigate = useNavigate();
  const { jobId = '' } = useParams<{ jobId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunId = searchParams.get('run') || '';

  const [job, setJob] = useState<CronJob | null>(null);
  const [runs, setRuns] = useState<CronRunSummary[]>([]);
  const [messages, setMessages] = useState<RawMessage[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const refreshRuns = useCallback(async () => {
    if (!jobId) return;
    setLoadingRuns(true);
    setRunsError(null);
    try {
      const data = await hostApiFetch<CronRunsResponse>(`/api/cron/jobs/${encodeURIComponent(jobId)}/runs`);
      setJob(data.job);
      setRuns(data.runs ?? []);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        const run = current.get('run');
        const firstRunId = data.runs?.[0]?.id;
        if (!run && firstRunId) {
          next.set('run', firstRunId);
        } else if (run && !data.runs?.some((entry) => entry.id === run)) {
          if (firstRunId) {
            next.set('run', firstRunId);
          } else {
            next.delete('run');
          }
        }
        return next;
      }, { replace: true });
    } catch (error) {
      setRunsError(String(error));
      setRuns([]);
      setJob(null);
    } finally {
      setLoadingRuns(false);
    }
  }, [jobId, setSearchParams]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    if (!jobId || !selectedRun) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setMessagesError(null);

    hostApiFetch<CronRunMessagesResponse>(
      `/api/cron/jobs/${encodeURIComponent(jobId)}/messages?runId=${encodeURIComponent(selectedRun.id)}&limit=200`,
    )
      .then(async (data) => {
        if (cancelled) return;
        if (data.job) setJob(data.job);
        const prepared = await hydrateHistoryMessagesForDisplay(Array.isArray(data.messages) ? data.messages : []);
        if (cancelled) return;
        setMessages(prepared);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessages([]);
        setMessagesError(String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, selectedRun]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate('/cron')}
              className="-ml-2 h-7 rounded-lg px-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              {t('history.back')}
            </Button>
            <Link to="/cron" className="transition-colors hover:text-foreground">
              {t('title')}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="max-w-[18rem] truncate">{job?.name || t('history.taskFallback')}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshRuns()} disabled={loadingRuns}>
          {loadingRuns ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <History className="mr-2 h-4 w-4" />}
          {t('refresh')}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col border-none bg-transparent shadow-none">
          <CardHeader className="px-0 pb-3">
            <CardTitle className="text-[15px]">{t('history.runListTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
              {loadingRuns ? (
                <div className="flex h-48 items-center justify-center">
                  <LoadingSpinner size="lg" />
                </div>
              ) : runsError ? (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                  {runsError}
                </div>
              ) : runs.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{t('history.emptyTitle')}</p>
                  <p className="mt-1">{t('history.emptyDescription')}</p>
                </div>
              ) : (
                <div className="scrollbar-hidden h-full min-h-0 space-y-2 overflow-y-auto pr-2">
                  {runs.map((run) => {
                    const isActive = selectedRun?.id === run.id;
                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSearchParams({ run: run.id }, { replace: true })}
                        className={cn(
                          'w-full rounded-xl border px-2.5 py-2 text-left transition-colors',
                          isActive
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border bg-background hover:bg-muted/60',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', statusPillClass(run.status))}>
                                <StatusIcon status={run.status} />
                                {t(`history.status.${run.status}`)}
                              </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/50">{formatRunTimestamp(run)}</span>
                          </div>
                          <div className="mt-1 truncate text-[13px] font-medium">
                            {run.summary || run.error || t('history.noSummary')}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{t('history.messagesTitle')}</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/70">
                    {selectedRun?.sessionKey || '-'}
                  </CardDescription>
                </div>
                {selectedRun && (
                  <span className="inline-flex items-center rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:bg-white/[0.06]">
                    {formatRunDuration(selectedRun, t)}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="min-h-0 p-0">
              {loadingMessages ? (
                <div className="flex h-48 items-center justify-center">
                  <LoadingSpinner size="lg" />
                </div>
              ) : messagesError ? (
                <div className="m-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                  {messagesError}
                </div>
              ) : !selectedRun ? (
                <div className="m-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  {t('history.selectRun')}
                </div>
              ) : messages.length === 0 ? (
                <div className="m-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  {t('history.messagesEmpty')}
                </div>
              ) : (
                <div className="max-h-[calc(100vh-16rem)] space-y-4 overflow-y-auto px-8 py-1">
                  {messages.map((message, index) => (
                    <ChatMessage
                      key={message.id || `${selectedRun.id}-${index}`}
                      message={message}
                      showThinking
                      showToolCalls
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </div>
  );
}

export default CronRunHistoryPage;
