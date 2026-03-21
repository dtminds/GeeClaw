import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { stripRuntimeChannelTags } from '@/lib/chat-message-text';
import { cn, formatShortDateTime } from '@/lib/utils';
import { renderSkillMarkersAsPlainText } from '@/lib/chat-message-text';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import type { CronAgentRunSummary } from '@/types/cron';
import { useTranslation } from 'react-i18next';

function toPreview(text: string): string {
  return renderSkillMarkersAsPlainText(stripRuntimeChannelTags(text)).replace(/\s+/g, ' ').trim();
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

type SessionPanelTab = 'temporary' | 'cron';

type CronRunsResponse = {
  runs?: CronAgentRunSummary[];
};

function extractSessionKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (typeof record.sessionKey === 'string' && record.sessionKey) {
    return record.sessionKey;
  }

  if (record.message && typeof record.message === 'object') {
    const nested = extractSessionKey(record.message);
    if (nested) return nested;
  }

  if (record.params && typeof record.params === 'object') {
    const nested = extractSessionKey(record.params);
    if (nested) return nested;
  }

  if (record.data && typeof record.data === 'object') {
    const nested = extractSessionKey(record.data);
    if (nested) return nested;
  }

  return null;
}

function getCronAgentIdFromSessionKey(sessionKey: string | null): string | null {
  if (!sessionKey || !sessionKey.startsWith('agent:') || !sessionKey.includes(':cron:')) {
    return null;
  }
  const parts = sessionKey.split(':');
  return parts[1] || null;
}

function shouldRefreshCronRuns(
  payload: { method?: string; params?: Record<string, unknown> } | unknown,
  currentAgentId: string,
): boolean {
  if (!currentAgentId) return false;

  if (payload && typeof payload === 'object' && 'method' in (payload as Record<string, unknown>)) {
    const method = typeof (payload as Record<string, unknown>).method === 'string'
      ? String((payload as Record<string, unknown>).method).toLowerCase()
      : '';
    if (method.includes('cron')) {
      return true;
    }
  }

  return getCronAgentIdFromSessionKey(extractSessionKey(payload)) === currentAgentId;
}

interface SessionButtonProps {
  title: string;
  preview: string;
  time?: string;
  active: boolean;
  onClick: () => void;
  action?: ReactNode;
}

function SessionButton({
  title,
  preview,
  time,
  active,
  onClick,
  action,
}: SessionButtonProps) {
  return (
    <div
      className={cn(
        'group relative rounded-md',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-transparent',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full px-2.5 py-1.5 text-left"
      >
        <div className="min-w-0">
          <div className="flex h-6 items-center justify-between gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px] font-medium',
                active ? 'text-primary-foreground' : 'text-foreground/88',
              )}
            >
              {title}
            </span>
            {(time || action) ? (
              <span className="relative ml-2 h-7 w-11 shrink-0">
                {time ? (
                  <span
                    className={cn(
                      'absolute inset-0 flex items-center justify-end text-[11px] tabular-nums transition-opacity',
                      action && 'group-hover:opacity-0',
                      active ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {time}
                  </span>
                ) : null}
                {action ? (
                  <span className="absolute inset-0 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                    {action}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <p className={cn('truncate text-[12px]', active ? 'text-primary-foreground/72' : 'text-muted-foreground')}>
            {preview}
          </p>
        </div>
      </button>
    </div>
  );
}

export function ChatSessionsPanel() {
  const { t } = useTranslation('chat');
  const desktopSessions = useChatStore((s) => s.desktopSessions);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentDesktopSessionId = useChatStore((s) => s.currentDesktopSessionId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentViewMode = useChatStore((s) => s.currentViewMode);
  const selectedCronRun = useChatStore((s) => s.selectedCronRun);
  const isDraftSession = useChatStore((s) => s.isDraftSession);
  const openAgentMainSession = useChatStore((s) => s.openAgentMainSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const openCronRun = useChatStore((s) => s.openCronRun);
  const newTemporarySession = useChatStore((s) => s.newTemporarySession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const agents = useAgentsStore((s) => s.agents);
  const [activeTab, setActiveTab] = useState<SessionPanelTab>('temporary');
  const [cronRuns, setCronRuns] = useState<CronAgentRunSummary[]>([]);
  const [cronRunsAgentId, setCronRunsAgentId] = useState('');
  const [cronRunsError, setCronRunsError] = useState<string | null>(null);

  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentMainSessionKey = currentAgent?.mainSessionKey ?? `agent:${currentAgentId}:main`;

  const { mainSession, temporarySessions } = useMemo(() => {
    const scopedSessions = desktopSessions.filter(
      (session) => getAgentIdFromSessionKey(session.gatewaySessionKey) === currentAgentId,
    );

    const main = scopedSessions.find((session) => session.gatewaySessionKey === currentMainSessionKey) ?? null;
    const temporary = scopedSessions
      .filter((session) => session.gatewaySessionKey !== currentMainSessionKey)
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return { mainSession: main, temporarySessions: temporary };
  }, [currentAgentId, currentMainSessionKey, desktopSessions]);

  const isMainSessionActive = !isDraftSession && currentSessionKey === currentMainSessionKey;
  const showDraftTemporarySession = isDraftSession;
  const isCronRunsCurrent = activeTab === 'cron' && cronRunsAgentId === currentAgentId;
  const loadingCronRuns = activeTab === 'cron' && Boolean(currentAgentId) && !isCronRunsCurrent;
  const visibleCronRuns = isCronRunsCurrent ? cronRuns : [];
  const visibleCronRunsError = isCronRunsCurrent ? cronRunsError : null;

  const mainPreview = toPreview(mainSession?.lastMessagePreview || '')
    || t('sessionPanel.mainSessionHint');
  const conversationItems: Array<{
    key: string;
    title: string;
    preview: string;
    time?: string;
    active: boolean;
    action?: ReactNode;
    onClick: () => void;
  }> = [
    {
      key: 'main',
      title: t('sessionPanel.mainSession'),
      preview: mainPreview,
      time: mainSession?.updatedAt ? formatShortDateTime(mainSession.updatedAt) : '',
      active: isMainSessionActive,
      onClick: () => {
        void openAgentMainSession(currentAgentId);
      },
    },
  ];

  if (showDraftTemporarySession) {
    conversationItems.push({
      key: 'draft',
      title: t('sessionPanel.draftTemporarySession'),
      preview: t('sessionPanel.draftTemporarySessionHint'),
      active: true,
      onClick: () => {},
    });
  }

  temporarySessions.forEach((session) => {
    const label = session.title.trim() || t('toolbar.untitledTemporarySession');
    const preview = toPreview(session.lastMessagePreview) || t('sessionPanel.temporarySessionHint');
    const isActive = currentViewMode === 'session' && session.id === currentDesktopSessionId;

    conversationItems.push({
      key: session.id,
      title: label,
      preview,
      time: formatShortDateTime(session.updatedAt),
      active: isActive,
      action: (
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
            isActive
              ? 'text-primary-foreground/72 hover:bg-white/14 hover:text-primary-foreground'
              : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          )}
          aria-label={t('toolbar.deleteTemporarySession')}
          onClick={(event) => {
            event.stopPropagation();
            void deleteSession(session.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
      onClick: () => {
        switchSession(session.id);
      },
    });
  });

  useEffect(() => {
    if (activeTab !== 'cron' || !currentAgentId || cronRunsAgentId === currentAgentId) return;

    let cancelled = false;

    hostApiFetch<CronRunsResponse>(`/api/cron/agents/${encodeURIComponent(currentAgentId)}/runs?limit=100`)
      .then((data) => {
        if (cancelled) return;
        setCronRunsAgentId(currentAgentId);
        setCronRuns(Array.isArray(data.runs) ? data.runs : []);
        setCronRunsError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setCronRunsAgentId(currentAgentId);
        setCronRuns([]);
        setCronRunsError(String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentAgentId, cronRunsAgentId]);

  useEffect(() => {
    if (activeTab !== 'cron' || !currentAgentId) return;

    const invalidate = () => {
      setCronRunsAgentId('');
    };

    const unsubscribeNotification = subscribeHostEvent<{ method?: string; params?: Record<string, unknown> }>(
      'gateway:notification',
      (payload) => {
        if (shouldRefreshCronRuns(payload, currentAgentId)) {
          invalidate();
        }
      },
    );

    const unsubscribeChatMessage = subscribeHostEvent(
      'gateway:chat-message',
      (payload) => {
        if (shouldRefreshCronRuns(payload, currentAgentId)) {
          invalidate();
        }
      },
    );

    return () => {
      unsubscribeNotification();
      unsubscribeChatMessage();
    };
  }, [activeTab, currentAgentId]);

  return (
    <aside
      className="flex h-full w-full border-r border-black/5 bg-background/40 dark:border-white/6 dark:bg-background/20"
    >
      <div className="flex min-h-0 w-full flex-col">
        <div className="shrink-0 px-2.5 py-3">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SessionPanelTab)} className="min-w-0">
            <TabsList className="grid h-9 w-full grid-cols-2 items-stretch rounded-full bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
              <TabsTrigger
                value="temporary"
                className="h-full rounded-full px-2.5 py-0 text-[12px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-none"
              >
                {t('sessionPanel.temporaryTab')}
              </TabsTrigger>
              <TabsTrigger
                value="cron"
                className="h-full rounded-full px-2.5 py-0 text-[12px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-none"
              >
                {t('sessionPanel.cronTab')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {activeTab === 'temporary' ? (
          <>
            <div
              className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2.5 pb-2"
              style={{
                maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 2.75rem), transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 2.75rem), transparent 100%)',
              }}
            >
              <div>
                {conversationItems.map((item, index) => {
                  const nextItem = conversationItems[index + 1];
                  return (
                    <div key={item.key}>
                      <SessionButton
                        title={item.title}
                        preview={item.preview}
                        time={item.time}
                        active={item.active}
                        action={item.action}
                        onClick={item.onClick}
                      />
                      {index < conversationItems.length - 1 ? (
                        <div className="px-2.5">
                          <div
                            className={cn(
                              'h-px bg-black/[0.05] transition-opacity duration-150 ease-out dark:bg-white/[0.08]',
                              item.active || nextItem?.active ? 'opacity-0' : 'opacity-100',
                            )}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 px-2.5 py-2">
              <Button
                variant="ghost"
                className="h-9 w-full justify-center rounded-xl border border-black/8 text-[13px] font-medium text-foreground/80 hover:bg-black/[0.04] hover:text-foreground dark:border-white/10 dark:hover:bg-white/[0.06]"
                onClick={() => {
                  void newTemporarySession(currentAgentId);
                }}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                {t('toolbar.newTemporarySession')}
              </Button>
            </div>
          </>
        ) : (
          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
            {loadingCronRuns ? (
              <div className="rounded-xl border border-dashed border-black/8 bg-background/55 px-3 py-3 dark:border-white/10 dark:bg-white/[0.02]">
                <p className="text-[13px] text-muted-foreground">
                  {t('sessionPanel.loadingCronRuns')}
                </p>
              </div>
            ) : visibleCronRunsError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-[12px] text-destructive">
                {visibleCronRunsError}
              </div>
            ) : visibleCronRuns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/8 bg-background/55 px-3 py-3 dark:border-white/10 dark:bg-white/[0.02]">
                <p className="text-[13px] font-medium text-foreground/86">
                  {t('sessionPanel.emptyCronRuns')}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {t('sessionPanel.emptyCronRunsHint')}
                </p>
              </div>
            ) : (
              <div>
                {visibleCronRuns.map((run, index) => {
                  const label = run.jobName.trim() || t('sessionPanel.cronRunTitleFallback');
                  const preview = toPreview(run.summary || run.error || '') || t('sessionPanel.cronRunHint');
                  const runTime = run.finishedAt || run.startedAt;
                  const isActive = currentViewMode === 'cron'
                    && selectedCronRun?.jobId === run.jobId
                    && selectedCronRun?.id === run.id;
                  const nextRun = visibleCronRuns[index + 1];
                  const nextIsActive = currentViewMode === 'cron'
                    && selectedCronRun?.jobId === nextRun?.jobId
                    && selectedCronRun?.id === nextRun?.id;
                  return (
                    <div key={`${run.jobId}:${run.id}`}>
                      <SessionButton
                        title={label}
                        preview={preview}
                        time={runTime ? formatShortDateTime(runTime) : ''}
                        active={isActive}
                        onClick={() => {
                          void openCronRun(run);
                        }}
                      />
                      {index < visibleCronRuns.length - 1 ? (
                        <div className="px-2.5">
                          <div
                            className={cn(
                              'h-px bg-black/[0.05] transition-opacity duration-150 ease-out dark:bg-white/[0.08]',
                              isActive || nextIsActive ? 'opacity-0' : 'opacity-100',
                            )}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
