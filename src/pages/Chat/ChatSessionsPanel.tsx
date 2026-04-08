import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        }}
        className="block w-full cursor-pointer px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="min-w-0">
          <div className={cn('flex h-6 items-center gap-2', (time || action) && 'pr-11')}>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px] font-medium',
                active ? 'text-primary-foreground' : 'text-foreground/88',
              )}
            >
              {title}
            </span>
          </div>
          <p className={cn('truncate text-[12px]', active ? 'text-primary-foreground/72' : 'text-muted-foreground')}>
            {preview}
          </p>
        </div>
      </div>
      {(time || action) ? (
        <div className="pointer-events-none absolute right-2.5 top-1.5 z-10">
          <div className="relative flex h-7 min-w-[2.75rem] items-center justify-end">
            {time ? (
              <span
                className={cn(
                  'text-[11px] tabular-nums transition-opacity',
                  action && 'group-hover:opacity-0',
                  active ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {time}
              </span>
            ) : null}
            {action ? (
              <div className="pointer-events-auto absolute inset-0 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                {action}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionGroupDivider({ title }: { title: string }) {
  return (
    <div className="px-2.5 py-2.5">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/[0.1]" />
        <span className="shrink-0 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground/75">
          {title}
        </span>
        <div className="h-px flex-1 bg-black/[0.06] dark:bg-white/[0.1]" />
      </div>
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
  const renameSession = useChatStore((s) => s.renameSession);
  const agents = useAgentsStore((s) => s.agents);
  const [activeTab, setActiveTab] = useState<SessionPanelTab>('temporary');
  const [cronRuns, setCronRuns] = useState<CronAgentRunSummary[]>([]);
  const [cronRunsAgentId, setCronRunsAgentId] = useState('');
  const [cronRunsError, setCronRunsError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

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
  const hasTemporarySessionSection = showDraftTemporarySession || temporarySessions.length > 0;
  const isCronRunsCurrent = activeTab === 'cron' && cronRunsAgentId === currentAgentId;
  const loadingCronRuns = activeTab === 'cron' && Boolean(currentAgentId) && !isCronRunsCurrent;
  const visibleCronRuns = isCronRunsCurrent ? cronRuns : [];
  const visibleCronRunsError = isCronRunsCurrent ? cronRunsError : null;

  const mainPreview = toPreview(mainSession?.lastMessagePreview || '')
    || t('sessionPanel.mainSessionHint');
  const mainConversationItems: Array<{
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

  const temporaryConversationItems: Array<{
    key: string;
    title: string;
    preview: string;
    time?: string;
    active: boolean;
    action?: ReactNode;
    onClick: () => void;
  }> = [];

  if (showDraftTemporarySession) {
    temporaryConversationItems.push({
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

    temporaryConversationItems.push({
      key: session.id,
      title: label,
      preview,
      time: formatShortDateTime(session.updatedAt),
      active: isActive,
      action: (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                isActive
                  ? 'text-primary-foreground/72 hover:bg-white/14 hover:text-primary-foreground'
                  : 'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]',
              )}
              aria-label={t('sessionPanel.moreActions')}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="bottom"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              className="z-50 min-w-[148px] overflow-hidden rounded-xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none dark:border-white/10 dark:bg-card"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
              }}
            >
              <DropdownMenu.Item
                className="mx-1 flex cursor-default items-center rounded-lg px-3 py-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent/60"
                onSelect={() => {
                  setRenameTarget({ id: session.id, title: label });
                  setRenameValue(label);
                }}
              >
                {t('sessionPanel.renameMenuItem')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="mx-1 flex cursor-default items-center rounded-lg px-3 py-2 text-[13px] text-destructive outline-none transition-colors data-[highlighted]:bg-destructive/10"
                onSelect={() => {
                  void deleteSession(session.id);
                }}
              >
                {t('sessionPanel.deleteMenuItem')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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

  const handleRenameDialogChange = (open: boolean) => {
    if (renaming) return;
    if (!open) {
      setRenameTarget(null);
      setRenameValue('');
    }
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) return;

    setRenaming(true);
    try {
      await renameSession(renameTarget.id, nextTitle);
      setRenameTarget(null);
      setRenameValue('');
    } finally {
      setRenaming(false);
    }
  };

  return (
    <>
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
                  {mainConversationItems.map((item) => (
                    <div key={item.key}>
                      <SessionButton
                        title={item.title}
                        preview={item.preview}
                        time={item.time}
                        active={item.active}
                        action={item.action}
                        onClick={item.onClick}
                      />
                    </div>
                  ))}

                  {hasTemporarySessionSection ? (
                    <>
                      <SessionGroupDivider title={t('sessionPanel.temporarySection')} />
                      {temporaryConversationItems.map((item, index) => {
                        const nextItem = temporaryConversationItems[index + 1];
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
                            {index < temporaryConversationItems.length - 1 ? (
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
                    </>
                  ) : null}
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

      <Dialog open={Boolean(renameTarget)} onOpenChange={handleRenameDialogChange}>
        {renameTarget ? (
          <DialogContent
            hideCloseButton
            className="modal-card-surface w-full max-w-md overflow-hidden rounded-3xl border p-0"
          >
            <DialogHeader className="px-6 pb-2 pt-6">
              <DialogTitle className="modal-title">
                {t('sessionPanel.renameTitle')}
              </DialogTitle>
              <DialogDescription className="modal-description">
                {t('sessionPanel.renameDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 p-6 pt-4">
              <div className="space-y-2.5">
                <Label htmlFor="rename-session-title" className="text-[14px] font-bold text-foreground/80">
                  {t('sessionPanel.renameLabel')}
                </Label>
                <Input
                  id="rename-session-title"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  placeholder={t('sessionPanel.renamePlaceholder')}
                  className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] text-foreground shadow-sm transition-all placeholder:text-foreground/40"
                />
              </div>

              <div className="modal-footer">
                <Button
                  variant="outline"
                  onClick={() => handleRenameDialogChange(false)}
                  disabled={renaming}
                  className="modal-secondary-button"
                >
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  onClick={() => void handleRenameSubmit()}
                  disabled={!renameValue.trim() || renaming}
                  className="modal-primary-button"
                >
                  {t('common:actions.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
