import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, MoreHorizontal, RefreshCw, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FeedbackState } from '@/components/common/FeedbackState';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc, toUserMessage } from '@/lib/api-client';

type CliMarketplaceJobOperation = 'install' | 'uninstall';
type CliMarketplaceJobStatus = 'running' | 'succeeded' | 'failed';
type CliMarketplaceInstallCompletionKind = 'skills-only' | 'docs-required' | 'skills-and-docs';

type CliMarketplaceManualMethodLabel = 'brew' | 'curl' | 'npm' | 'custom';

interface CliMarketplaceInstallMethodStatus {
  type: 'managed-npm' | 'manual';
  label: 'managed-npm' | CliMarketplaceManualMethodLabel;
  command?: string;
  available: boolean;
  unavailableReason?: 'missing-command' | 'runtime-missing';
  missingCommands?: string[];
  managed: boolean;
}

interface CliMarketplaceItem {
  id: string;
  title: string;
  description: string;
  homepage?: string;
  docsUrl?: string;
  installed: boolean;
  source: 'system' | 'geeclaw' | 'none';
  installMethods: CliMarketplaceInstallMethodStatus[];
}

interface CliMarketplaceJob {
  id: string;
  itemId: string;
  title: string;
  operation: CliMarketplaceJobOperation;
  status: CliMarketplaceJobStatus;
  logs: string;
  startedAt: string;
  finishedAt: string | null;
  completion?: {
    kind: CliMarketplaceInstallCompletionKind;
    requiresSkillEnable?: boolean;
    docsUrl?: string;
    extraSteps?: string[];
  };
  error?: string;
}

type CliMarketplaceManualMethodStatus = CliMarketplaceInstallMethodStatus & {
  type: 'manual';
  label: CliMarketplaceManualMethodLabel;
};

function getManagedInstallMethod(item: CliMarketplaceItem): CliMarketplaceInstallMethodStatus | null {
  return item.installMethods.find((method) => method.type === 'managed-npm') ?? null;
}

function getManualInstallMethods(item: CliMarketplaceItem): CliMarketplaceManualMethodStatus[] {
  return item.installMethods.filter((method): method is CliMarketplaceManualMethodStatus => method.type === 'manual');
}

function getFirstAvailableManualInstallMethod(item: CliMarketplaceItem): (CliMarketplaceManualMethodStatus & { command: string }) | null {
  return item.installMethods.find((method): method is CliMarketplaceManualMethodStatus & { command: string } => (
    method.type === 'manual'
    && method.available
    && typeof method.command === 'string'
    && method.command.length > 0
  )) ?? null;
}

function getManualMethodDisplayName(methodLabel: CliMarketplaceManualMethodLabel): string {
  if (methodLabel === 'brew') {
    return 'Homebrew';
  }
  if (methodLabel === 'curl') {
    return 'curl';
  }
  if (methodLabel === 'npm') {
    return 'npm';
  }
  return 'Command';
}

function InstallStatusBadge({
  installed,
  installedLabel,
  missingLabel,
}: {
  installed: boolean;
  installedLabel: string;
  missingLabel: string;
}) {
  if (installed) {
    return (
      <Badge className="gap-1 rounded-full border-0 bg-emerald-500/12 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {installedLabel}
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 rounded-full border-0 bg-rose-500/12 px-2.5 py-1 text-rose-700 dark:text-rose-300">
      <XCircle className="h-3.5 w-3.5" />
      {missingLabel}
    </Badge>
  );
}

function getCompletionDescription(
  completion: NonNullable<CliMarketplaceJob['completion']>,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  if (completion.kind === 'skills-only') {
    return t('cliMarketplace.completion.skillsOnly', {
      defaultValue: 'CLI and skills are installed. Enable the skills from the Skills page before use.',
    });
  }
  if (completion.kind === 'docs-required') {
    return t('cliMarketplace.completion.docsRequired', {
      defaultValue: 'CLI is installed, but you still need to finish other setup steps.',
    });
  }
  return t('cliMarketplace.completion.skillsAndDocs', {
    defaultValue: 'CLI and skills are installed, but you still need to finish other setup steps.',
  });
}

function getCompletionPrimaryAction(completion: NonNullable<CliMarketplaceJob['completion']>): 'docs' | 'skills' | null {
  if (completion.docsUrl) {
    return 'docs';
  }
  if (completion.requiresSkillEnable) {
    return 'skills';
  }
  return null;
}

export function CliMarketplaceSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const [items, setItems] = useState<CliMarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeJob, setActiveJob] = useState<CliMarketplaceJob | null>(null);
  const [openActionsMenuId, setOpenActionsMenuId] = useState<string | null>(null);
  const [manualInstallDialogItem, setManualInstallDialogItem] = useState<{
    title: string;
    methodLabel: CliMarketplaceManualMethodLabel;
    command: string;
  } | null>(null);
  const [showJobLogs, setShowJobLogs] = useState(true);
  const actionsMenuRootRef = useRef<HTMLDivElement | null>(null);

  const loadCatalog = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setLoadError(null);
    }

    try {
      const response = await hostApiFetch<CliMarketplaceItem[]>('/api/cli-marketplace/catalog');
      setItems(response);
      setLoadError(null);
    } catch (error) {
      const message = toUserMessage(error);
      if (background) {
        toast.error(`${t('cliMarketplace.loadFailed')}: ${message}`);
      } else {
        setLoadError(message);
      }
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void loadCatalog();
  }, []);

  const activeJobId = activeJob?.id ?? null;
  const activeJobStatus = activeJob?.status ?? null;

  useEffect(() => {
    if (!activeJobId || activeJobStatus !== 'running') {
      return undefined;
    }

    let cancelled = false;
    let timer: number | undefined;

    const pollJob = async () => {
      try {
        const nextJob = await hostApiFetch<CliMarketplaceJob>(`/api/cli-marketplace/jobs/${encodeURIComponent(activeJobId)}`);
        if (cancelled) {
          return;
        }

        setActiveJob(nextJob);
        if (nextJob.status === 'running') {
          timer = window.setTimeout(() => {
            void pollJob();
          }, 500);
          return;
        }

        await loadCatalog(true);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = toUserMessage(error);
        setActiveJob((current) => current ? {
          ...current,
          status: 'failed',
          error: message,
          finishedAt: current.finishedAt ?? new Date().toISOString(),
          logs: current.logs.endsWith('\n')
            ? `${current.logs}[error] ${message}\n`
            : `${current.logs}\n[error] ${message}\n`,
        } : current);
      }
    };

    void pollJob();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [activeJobId, activeJobStatus, loadCatalog]);

  useEffect(() => {
    if (!activeJob) {
      setShowJobLogs(true);
      return;
    }

    const collapseLogsByDefault = activeJob.status === 'succeeded' && activeJob.operation === 'install' && Boolean(activeJob.completion);
    setShowJobLogs(!collapseLogsByDefault);
  }, [activeJob?.id, activeJob?.status, activeJob?.operation, activeJob?.completion]);

  useEffect(() => {
    if (!openActionsMenuId) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!actionsMenuRootRef.current?.contains(target)) {
        setOpenActionsMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenActionsMenuId(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openActionsMenuId]);

  const startJob = async (item: CliMarketplaceItem, operation: CliMarketplaceJobOperation) => {
    try {
      const job = await hostApiFetch<CliMarketplaceJob>(
        operation === 'install' ? '/api/cli-marketplace/install' : '/api/cli-marketplace/uninstall',
        {
          method: 'POST',
          body: JSON.stringify({ id: item.id }),
        },
      );
      setActiveJob(job);
    } catch (error) {
      toast.error(`${t('cliMarketplace.installFailed')}: ${toUserMessage(error)}`);
    }
  };

  const copyInstallCommand = async (command: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(command);
      toast.success(t('cliMarketplace.copyInstallCommandCopied', { defaultValue: 'Install command copied' }));
    } catch (error) {
      toast.error(`${t('cliMarketplace.copyInstallCommandFailed', { defaultValue: 'Failed to copy install command' })}: ${toUserMessage(error)}`);
    }
  };

  const openDocs = async (url: string) => {
    try {
      await invokeIpc('shell:openExternal', url);
    } catch (error) {
      toast.error(`${t('cliMarketplace.docsOpenFailed', { defaultValue: 'Failed to open docs' })}: ${toUserMessage(error)}`);
    }
  };

  const openSkillsPage = () => {
    window.location.hash = '/skills';
    setActiveJob(null);
  };

  const isJobRunning = activeJob?.status === 'running';
  const jobCompletion = activeJob?.status === 'succeeded' && activeJob.operation === 'install'
    ? activeJob.completion
    : undefined;
  const jobCompletionPrimaryAction = jobCompletion ? getCompletionPrimaryAction(jobCompletion) : null;

  const getJobTitle = (operation: CliMarketplaceJobOperation): string => (
    operation === 'uninstall'
      ? t('cliMarketplace.job.title.uninstall')
      : t('cliMarketplace.job.title.install')
  );

  const getJobStatusLabel = (status: CliMarketplaceJobStatus): string => {
    if (status === 'succeeded') {
      return t('cliMarketplace.job.succeeded');
    }
    if (status === 'failed') {
      return t('cliMarketplace.job.failed');
    }
    return t('cliMarketplace.job.running');
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h2 className="modal-title">{t('cliMarketplace.title')}</h2>
            <p className="modal-description">{t('cliMarketplace.description')}</p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => void loadCatalog(true)}
            disabled={loading || refreshing || isJobRunning}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t('cliMarketplace.refresh')}
          </Button>
        </div>

        <section className={loading || loadError || items.length === 0 ? 'modal-section-surface rounded-3xl border p-5' : undefined}>
          {loading ? (
            <FeedbackState state="loading" title={t('common:status.loading')} />
          ) : loadError ? (
            <FeedbackState
              state="error"
              title={t('cliMarketplace.loadFailed')}
              description={loadError}
              action={(
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void loadCatalog()}
                >
                  {t('updates.action.retry')}
                </Button>
              )}
            />
          ) : items.length === 0 ? (
            <FeedbackState state="empty" title={t('cliMarketplace.empty')} />
          ) : (
            <div className="flex flex-col gap-4">
              {items.map((item) => (
                (() => {
                  const managedInstallMethod = getManagedInstallMethod(item);
                  const manualInstallMethods = getManualInstallMethods(item);
                  const firstAvailableManualInstallMethod = getFirstAvailableManualInstallMethod(item);
                  const docsUrl = item.docsUrl;
                  const canInstallWithManagedMethod = item.source === 'none' && managedInstallMethod?.available === true;
                  const canInstallWithManualMethod = item.source === 'none' && !canInstallWithManagedMethod && firstAvailableManualInstallMethod !== null;
                  const hasUnavailableManualMethod = manualInstallMethods.some((method) => !method.available);
                  const showManagedRuntimeMissingAction = item.source === 'none'
                    && managedInstallMethod?.available === false
                    && managedInstallMethod.unavailableReason === 'runtime-missing';
                  const primaryManualInstallMethod = canInstallWithManualMethod ? firstAvailableManualInstallMethod : null;
                  const fallbackManualInstallMethods = manualInstallMethods.filter((method) => (
                    !primaryManualInstallMethod
                    || method.label !== primaryManualInstallMethod.label
                    || method.command !== primaryManualInstallMethod.command
                  ));
                  const showManualInstallMethodsInMenu = fallbackManualInstallMethods.length > 0
                    && (
                      item.source !== 'none'
                      || canInstallWithManagedMethod
                      || hasUnavailableManualMethod
                      || fallbackManualInstallMethods.length > 0
                    );
                  const showActionsMenu = Boolean(docsUrl)
                    || canInstallWithManagedMethod
                    || canInstallWithManualMethod
                    || item.source === 'geeclaw'
                    || showManagedRuntimeMissingAction
                    || showManualInstallMethodsInMenu;
                  const sourceBadgeLabel = item.source === 'system'
                      ? t('cliMarketplace.source.system', { defaultValue: 'System' })
                      : null;

                  return (
                    <div key={item.id} className="modal-field-surface rounded-2xl border p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                            <InstallStatusBadge
                              installed={item.installed}
                              installedLabel={t('cliMarketplace.installed')}
                              missingLabel={t('cliMarketplace.missing')}
                            />
                            {sourceBadgeLabel && (
                              <Badge className="rounded-full border border-black/8 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground dark:border-white/10">
                                {sourceBadgeLabel}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {item.description || item.homepage || item.id}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {showActionsMenu ? (
                            <div
                              ref={(node) => {
                                if (openActionsMenuId === item.id) {
                                  actionsMenuRootRef.current = node;
                                } else if (actionsMenuRootRef.current === node) {
                                  actionsMenuRootRef.current = null;
                                }
                              }}
                              className="relative"
                            >
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-full px-3"
                                aria-label={t('cliMarketplace.moreActions')}
                                aria-haspopup="menu"
                                aria-expanded={openActionsMenuId === item.id}
                                aria-controls={openActionsMenuId === item.id ? `cli-marketplace-menu-${item.id}` : undefined}
                                onClick={() => setOpenActionsMenuId((current) => current === item.id ? null : item.id)}
                                disabled={isJobRunning}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                              {openActionsMenuId === item.id && (
                                <div
                                  id={`cli-marketplace-menu-${item.id}`}
                                  role="menu"
                                  aria-label={t('cliMarketplace.moreActions')}
                                  className="absolute right-0 top-[calc(100%+0.5rem)] z-[140] min-w-[220px] rounded-2xl border border-black/8 bg-background/95 p-1.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.36)] backdrop-blur-xl dark:border-white/10"
                                >
                                  {docsUrl && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      autoFocus
                                      onClick={() => {
                                        setOpenActionsMenuId(null);
                                        void openDocs(docsUrl);
                                      }}
                                    >
                                      {t('cliMarketplace.docs', { defaultValue: 'Docs' })}
                                    </Button>
                                  )}
                                  {canInstallWithManagedMethod && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      autoFocus={!docsUrl}
                                      onClick={() => {
                                        setOpenActionsMenuId(null);
                                        void startJob(item, 'install');
                                      }}
                                    >
                                      {t('cliMarketplace.install')}
                                    </Button>
                                  )}
                                  {canInstallWithManualMethod && primaryManualInstallMethod && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      autoFocus={!docsUrl && !canInstallWithManagedMethod}
                                      onClick={() => {
                                        setOpenActionsMenuId(null);
                                        setManualInstallDialogItem({
                                          title: item.title,
                                          methodLabel: primaryManualInstallMethod.label,
                                          command: primaryManualInstallMethod.command,
                                        });
                                      }}
                                    >
                                      {t('cliMarketplace.install')}
                                    </Button>
                                  )}
                                  {item.source === 'geeclaw' && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      autoFocus={!docsUrl && !canInstallWithManagedMethod && !canInstallWithManualMethod}
                                      onClick={() => {
                                        setOpenActionsMenuId(null);
                                        void startJob(item, 'install');
                                      }}
                                    >
                                      {t('cliMarketplace.reinstall')}
                                    </Button>
                                  )}
                                  {item.source === 'geeclaw' && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      onClick={() => {
                                        setOpenActionsMenuId(null);
                                        void startJob(item, 'uninstall');
                                      }}
                                    >
                                      {t('cliMarketplace.uninstall')}
                                    </Button>
                                  )}
                                  {showManagedRuntimeMissingAction && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      autoFocus={item.source !== 'geeclaw'}
                                      disabled
                                    >
                                      {t('cliMarketplace.managed.needRuntime', { defaultValue: 'Need managed runtime' })}
                                    </Button>
                                  )}
                                  {fallbackManualInstallMethods.map((method, index) => {
                                    const unavailableReasonLabel = method.label === 'brew'
                                      ? t('cliMarketplace.manual.needHomebrew', { defaultValue: 'Need Homebrew' })
                                      : method.label === 'curl'
                                        ? t('cliMarketplace.manual.needCurl', { defaultValue: 'Need curl' })
                                        : method.label === 'npm'
                                          ? t('cliMarketplace.manual.needNpm', { defaultValue: 'Need npm' })
                                          : t('cliMarketplace.manual.unavailable', { defaultValue: 'Unavailable' });
                                    const isUnavailable = !method.available || !method.command;
                                    const label = isUnavailable
                                      ? unavailableReasonLabel
                                      : t('cliMarketplace.manual.installMethod', {
                                        method: getManualMethodDisplayName(method.label),
                                        defaultValue: `Install via ${getManualMethodDisplayName(method.label)}`,
                                      });
                                    const autoFocus = !docsUrl
                                      && !canInstallWithManagedMethod
                                      && !canInstallWithManualMethod
                                      && item.source !== 'geeclaw'
                                      && !showManagedRuntimeMissingAction
                                      && index === 0;

                                    return (
                                      <Button
                                        key={`${item.id}-manual-${method.label}-${index}`}
                                        type="button"
                                        variant="ghost"
                                        role="menuitem"
                                        className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                        autoFocus={autoFocus}
                                        disabled={isUnavailable}
                                        onClick={() => {
                                          if (!method.command || isUnavailable) {
                                            return;
                                          }
                                          setOpenActionsMenuId(null);
                                          setManualInstallDialogItem({
                                            title: item.title,
                                            methodLabel: method.label,
                                            command: method.command,
                                          });
                                        }}
                                      >
                                        {label}
                                      </Button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={manualInstallDialogItem !== null} onOpenChange={(open) => !open && setManualInstallDialogItem(null)}>
        <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-[560px] rounded-[20px] p-0">
          {manualInstallDialogItem && (
            <div className="modal-card-surface flex flex-col gap-6 p-6 sm:p-7">
              <DialogHeader className="gap-2">
                <DialogTitle className="modal-title">
                  {t('cliMarketplace.manualDialog.title', { defaultValue: 'Install command' })}
                </DialogTitle>
                <DialogDescription className="modal-description">
                  {t('cliMarketplace.manualDialog.description', {
                    defaultValue: 'Copy the command below, then run it in your terminal.',
                  })}
                </DialogDescription>
              </DialogHeader>

              <div className="modal-section-surface rounded-2xl border p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {manualInstallDialogItem.title} · {getManualMethodDisplayName(manualInstallDialogItem.methodLabel)}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm leading-6 text-foreground">
                  <code>{manualInstallDialogItem.command}</code>
                </pre>
              </div>

              <div className="modal-footer">
                <Button
                  type="button"
                  variant="outline"
                  className="modal-secondary-button"
                  onClick={() => setManualInstallDialogItem(null)}
                >
                  {t('cliMarketplace.manualDialog.close', { defaultValue: 'Close' })}
                </Button>
                <Button
                  type="button"
                  className="modal-primary-button"
                  onClick={() => void copyInstallCommand(manualInstallDialogItem.command)}
                >
                  {t('cliMarketplace.manualDialog.copy', { defaultValue: 'Copy command' })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeJob !== null}
        onOpenChange={(open) => {
          if (!open && activeJob?.status !== 'running') {
            setActiveJob(null);
          }
        }}
      >
        <DialogContent
          className="max-w-3xl overflow-hidden p-0"
          hideCloseButton={activeJob?.status === 'running'}
        >
          {activeJob && (
            <div className="flex flex-col">
              <DialogHeader className="border-b border-black/6 px-6 py-5 dark:border-white/10">
                <div className="flex items-center gap-3">
                  {activeJob.status === 'running' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : null}
                  <DialogTitle className="text-lg">{getJobTitle(activeJob.operation)} - {activeJob.title}</DialogTitle>
                  <Badge className="rounded-full border-0 bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {getJobStatusLabel(activeJob.status)}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="px-6 py-5">
                {jobCompletion && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mb-4 w-full justify-between rounded-2xl border border-black/8 px-4 py-3 text-sm dark:border-white/10"
                    onClick={() => setShowJobLogs((current) => !current)}
                  >
                    {showJobLogs
                      ? t('cliMarketplace.completion.hideLogs', { defaultValue: 'Hide install logs' })
                      : t('cliMarketplace.completion.showLogs', { defaultValue: 'View install logs' })}
                    {showJobLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                )}
                {showJobLogs && (
                  <pre className="max-h-[60vh] overflow-auto rounded-2xl border border-black/6 bg-slate-950 p-4 text-xs leading-6 text-slate-100 dark:border-white/10 whitespace-pre-wrap break-all">
                    {activeJob.logs || '$ '}
                  </pre>
                )}
                {jobCompletion && (
                  <div className={`${showJobLogs ? 'mt-5' : ''} rounded-3xl border border-emerald-200/80 bg-emerald-50/80 p-5 shadow-[0_18px_50px_-34px_rgba(16,185,129,0.45)] dark:border-emerald-500/20 dark:bg-emerald-500/10`}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full bg-emerald-500/15 p-2 text-emerald-600 dark:text-emerald-300">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-emerald-950 dark:text-emerald-100">
                          {t('cliMarketplace.completion.title', { defaultValue: 'Install complete' })}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-emerald-900/80 dark:text-emerald-100/80">
                          {getCompletionDescription(jobCompletion, t)}
                        </p>
                        {jobCompletion.extraSteps && jobCompletion.extraSteps.length > 0 && (
                          <div className="mt-4">
                            <div className="text-sm font-medium text-emerald-950 dark:text-emerald-100">
                              {t('cliMarketplace.completion.nextSteps', { defaultValue: 'Next steps' })}
                            </div>
                            <ul className="mt-2 space-y-2 text-sm leading-6 text-emerald-900/80 dark:text-emerald-100/80">
                              {jobCompletion.extraSteps.map((step) => (
                                <li key={step} className="flex gap-2">
                                  <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600/70 dark:bg-emerald-300/70" />
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer border-t border-black/6 px-6 py-4 dark:border-white/10">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setActiveJob(null)}
                  disabled={activeJob.status === 'running'}
                >
                  {jobCompletion
                    ? t('cliMarketplace.completion.dismiss', { defaultValue: 'Dismiss' })
                    : t('cliMarketplace.job.close')}
                </Button>
                {jobCompletionPrimaryAction === 'skills' && (
                  <Button
                    type="button"
                    className="rounded-full modal-primary-button"
                    onClick={openSkillsPage}
                  >
                    {t('cliMarketplace.completion.openSkills', { defaultValue: 'Open Skills' })}
                  </Button>
                )}
                {jobCompletionPrimaryAction === 'docs' && jobCompletion?.docsUrl && (
                  <Button
                    type="button"
                    className="rounded-full modal-primary-button"
                    onClick={() => void openDocs(jobCompletion.docsUrl!)}
                  >
                    {t('cliMarketplace.completion.viewDocs', { defaultValue: 'View docs to finish setup' })}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CliMarketplaceSettingsSection;
