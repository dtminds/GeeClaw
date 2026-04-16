import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MoreHorizontal, RefreshCw, XCircle } from 'lucide-react';
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
import { hostApiFetch } from '@/lib/host-api';
import { toUserMessage } from '@/lib/api-client';

type CliMarketplaceJobOperation = 'install' | 'uninstall';
type CliMarketplaceJobStatus = 'running' | 'succeeded' | 'failed';

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
  error?: string;
}

function getManagedInstallMethod(item: CliMarketplaceItem): CliMarketplaceInstallMethodStatus | null {
  return item.installMethods.find((method) => method.type === 'managed-npm') ?? null;
}

function getManualInstallMethods(item: CliMarketplaceItem): Array<CliMarketplaceInstallMethodStatus & { type: 'manual' }> {
  return item.installMethods.filter((method): method is CliMarketplaceInstallMethodStatus & { type: 'manual' } => method.type === 'manual');
}

function getFirstAvailableManualInstallMethod(item: CliMarketplaceItem): (CliMarketplaceInstallMethodStatus & { type: 'manual'; command: string }) | null {
  return item.installMethods.find((method): method is CliMarketplaceInstallMethodStatus & { type: 'manual'; command: string } => (
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

export function CliMarketplaceSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const [items, setItems] = useState<CliMarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeJob, setActiveJob] = useState<CliMarketplaceJob | null>(null);
  const [openActionsMenuId, setOpenActionsMenuId] = useState<string | null>(null);
  const actionsMenuRootRef = useRef<HTMLDivElement | null>(null);

  const loadCatalog = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await hostApiFetch<CliMarketplaceItem[]>('/api/cli-marketplace/catalog');
      setItems(response);
    } catch (error) {
      toast.error(`${t('cliMarketplace.loadFailed')}: ${toUserMessage(error)}`);
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
  }, [loadCatalog]);

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

  const isJobRunning = activeJob?.status === 'running';

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

        <section>
          {loading ? (
            <div className="py-8 text-sm text-muted-foreground">{t('common:status.loading')}</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">{t('cliMarketplace.empty')}</div>
          ) : (
            <div className="flex flex-col gap-4">
              {items.map((item) => (
                (() => {
                  const managedInstallMethod = getManagedInstallMethod(item);
                  const manualInstallMethods = getManualInstallMethods(item);
                  const firstAvailableManualInstallMethod = getFirstAvailableManualInstallMethod(item);
                  const canInstallWithManagedMethod = item.source === 'none' && managedInstallMethod?.available === true;
                  const canInstallWithManualMethod = item.source === 'none' && !canInstallWithManagedMethod && firstAvailableManualInstallMethod !== null;
                  const hasUnavailableManualMethod = manualInstallMethods.some((method) => !method.available);
                  const showActionsMenu = item.source === 'geeclaw'
                    || (item.source === 'system' && manualInstallMethods.length > 0)
                    || hasUnavailableManualMethod
                    || manualInstallMethods.length > 1;
                  const sourceBadgeLabel = item.source === 'geeclaw'
                    ? t('cliMarketplace.source.geeclaw', { defaultValue: 'GeeClaw' })
                    : item.source === 'system'
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
                          </div>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {item.description || item.homepage || item.id}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {canInstallWithManagedMethod && (
                            <Button
                              type="button"
                              className="rounded-full"
                              onClick={() => void startJob(item, 'install')}
                              disabled={isJobRunning}
                            >
                              {t('cliMarketplace.install')}
                            </Button>
                          )}

                          {canInstallWithManualMethod && firstAvailableManualInstallMethod && (
                            <Button
                              type="button"
                              className="rounded-full"
                              onClick={() => {
                                void copyInstallCommand(firstAvailableManualInstallMethod.command);
                              }}
                              disabled={isJobRunning}
                            >
                              {t('cliMarketplace.copyInstallCommand', { defaultValue: 'Copy Install Command' })}
                            </Button>
                          )}

                          {!canInstallWithManagedMethod && !canInstallWithManualMethod && sourceBadgeLabel && (
                            <Badge className="rounded-full border border-black/8 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground dark:border-white/10">
                              {sourceBadgeLabel}
                            </Badge>
                          )}

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
                                  {item.source === 'geeclaw' && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      role="menuitem"
                                      className="w-full justify-start rounded-xl px-3 py-2 text-sm"
                                      autoFocus
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
                                  {manualInstallMethods.map((method, index) => {
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
                                      : t('cliMarketplace.manual.copyMethod', {
                                        defaultValue: `Copy via ${getManualMethodDisplayName(method.label)}`,
                                      });
                                    const autoFocus = item.source !== 'geeclaw' && index === 0;

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
                                          void copyInstallCommand(method.command);
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
                  <DialogTitle className="text-lg">{getJobTitle(activeJob.operation)}</DialogTitle>
                  <Badge className="rounded-full border-0 bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {getJobStatusLabel(activeJob.status)}
                  </Badge>
                </div>
                <DialogDescription>
                  {activeJob.title}
                </DialogDescription>
              </DialogHeader>

              <div className="px-6 py-5">
                <pre className="max-h-[60vh] overflow-auto rounded-2xl border border-black/6 bg-slate-950 p-4 text-xs leading-6 text-slate-100 dark:border-white/10 whitespace-pre-wrap break-all">
                  {activeJob.logs || '$ '}
                </pre>
              </div>

              <div className="modal-footer border-t border-black/6 px-6 py-4 dark:border-white/10">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setActiveJob(null)}
                  disabled={activeJob.status === 'running'}
                >
                  {t('cliMarketplace.job.close')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CliMarketplaceSettingsSection;
