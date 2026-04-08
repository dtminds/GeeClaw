import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useApprovalStore } from '@/stores/approval';
import { HugeiconsIcon } from '@hugeicons/react';
import { Clock04Icon, DocumentValidationIcon } from '@hugeicons/core-free-icons';

type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

type ApprovalEntry = {
  id: string;
  kind: 'exec' | 'plugin';
  createdAtMs: number;
  expiresAtMs: number;
  request: Record<string, unknown> & { command?: unknown };
  allowedDecisions?: ApprovalDecision[];
  pluginTitle?: string | null;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
};

type DecisionOption = {
  value: ApprovalDecision;
  labelKey: string;
  variant: 'default' | 'outline' | 'destructive';
};

const DEFAULT_DECISIONS: ApprovalDecision[] = ['allow-once', 'allow-always', 'deny'];

const DECISION_OPTIONS: DecisionOption[] = [
  {
    value: 'allow-once',
    labelKey: 'approvalDialog.decisions.allowOnce',
    variant: 'default',
  },
  {
    value: 'allow-always',
    labelKey: 'approvalDialog.decisions.allowAlways',
    variant: 'outline',
  },
  {
    value: 'deny',
    labelKey: 'approvalDialog.decisions.deny',
    variant: 'destructive',
  },
];

function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function toDisplayText(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function formatRemainingTime(ms: number): string {
  const remainingMs = Math.max(0, ms);
  const totalSeconds = Math.floor(remainingMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  return `${totalHours}h`;
}

export function ApprovalDialog() {
  const { t } = useTranslation('common');
  const queue = useApprovalStore((state) => state.queue);
  const busy = useApprovalStore((state) => state.busy);
  const error = useApprovalStore((state) => state.error);
  const pendingDecisionId = useApprovalStore((state) => state.pendingDecisionId);
  const resolveActive = useApprovalStore((state) => state.resolveActive);
  const clearError = useApprovalStore((state) => state.clearError);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const active = queue[0] as ApprovalEntry | undefined;

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const timer = globalThis.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [active?.kind, active?.createdAtMs, active?.expiresAtMs]);

  if (!active) {
    return null;
  }

  const request = active.request ?? {};
  const command = hasDisplayValue(request.command) ? toDisplayText(request.command) : null;
  const expiryLabel = active.expiresAtMs <= nowMs
      ? t('approvalDialog.expired')
      : t('approvalDialog.expiresIn', {
          time: formatRemainingTime(active.expiresAtMs - nowMs),
        });
  const title = active.kind === 'plugin'
    ? (hasDisplayValue(active.pluginTitle) ? toDisplayText(active.pluginTitle) : t('approvalDialog.titles.pluginFallback'))
    : t('approvalDialog.titles.exec');
  const isExpired = active.expiresAtMs <= nowMs;
  const isAwaitingResolution = pendingDecisionId === active.id;
  const decisionDisabled = busy || isExpired || isAwaitingResolution;

  const requestedDecisions = active.allowedDecisions;
  const decisionSet = Array.isArray(requestedDecisions) && requestedDecisions.length > 0
    ? new Set<ApprovalDecision>(requestedDecisions)
    : new Set<ApprovalDecision>(DEFAULT_DECISIONS);
  const visibleDecisions = DECISION_OPTIONS.filter((option) => decisionSet.has(option.value));
  const decisions = visibleDecisions.length > 0 ? visibleDecisions : DECISION_OPTIONS;

  const primaryRows = [
    {
      label: t('approvalDialog.metadata.pluginSeverity'),
      value: active.kind === 'plugin' ? active.pluginSeverity : null,
    },
  ].filter((row) => hasDisplayValue(row.value));

  const metadataRows = [
    {
      label: t('approvalDialog.metadata.cwd'),
      value: request.cwd,
    },
    {
      label: t('approvalDialog.metadata.agentId'),
      value: request.agentId,
    },
    {
      label: t('approvalDialog.metadata.sessionKey'),
      value: request.sessionKey,
    },
    {
      label: t('approvalDialog.metadata.host'),
      value: request.host,
    },
    {
      label: t('approvalDialog.metadata.security'),
      value: request.security,
    },
    {
      label: t('approvalDialog.metadata.ask'),
      value: request.ask,
    },
    {
      label: t('approvalDialog.metadata.resolvedPath'),
      value: request.resolvedPath,
    },
    {
      label: t('approvalDialog.metadata.pluginId'),
      value: active.kind === 'plugin' ? (active.pluginId ?? request.pluginId) : null,
    },
    {
      label: t('approvalDialog.metadata.pluginSeverity'),
      value: null,
    },
  ].filter((row) => hasDisplayValue(row.value));

  const handleDecision = (decision: ApprovalDecision) => {
    if (decisionDisabled) return;
    void resolveActive(decision);
  };

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        hideCloseButton
        overlayClassName="z-[100100]"
        viewportClassName="z-[100101]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="modal-card-surface w-[min(760px,calc(100vw-2rem))] max-w-[620px] rounded-[24px] border p-0"
      >
        <div className="px-6 py-6 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <DialogHeader className="pr-2">
              <DialogTitle className="modal-title flex items-center gap-2">
                <HugeiconsIcon icon={DocumentValidationIcon} /> {title}
              </DialogTitle>
              <DialogDescription className="modal-description mt-2">
                {t('approvalDialog.description')}
              </DialogDescription>
            </DialogHeader>
            {queue.length > 1 && (
              <div className="modal-field-surface rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
                {t('approvalDialog.queueCount', { count: queue.length })}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 sm:px-7">
          <div>
            {active.kind === 'plugin' && hasDisplayValue(active.pluginDescription) && (
              <div className="mb-3">
                <p className="mt-1 text-sm text-foreground">{toDisplayText(active.pluginDescription)}</p>
              </div>
            )}

            {command && (
              <div className="mb-3">
                <pre className="modal-field-surface mt-1 whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-xs leading-5 text-foreground">
                  {command}
                </pre>
              </div>
            )}

            {primaryRows.length > 0 && (
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {primaryRows.map((row) => (
                  <div key={row.label} className="modal-field-surface rounded-xl border px-3 py-2">
                    <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {row.label}
                    </dt>
                    <dd className="mt-1 break-words text-xs text-foreground">{toDisplayText(row.value)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {metadataRows.length > 0 && (
              <details className="group mt-3 rounded-xl border border-black/8 bg-background/55 px-3 py-3 dark:border-white/10 dark:bg-black/10">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
                  <span>{t('approvalDialog.details')}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {metadataRows.map((row) => (
                    <div key={row.label} className="modal-field-surface rounded-xl border px-3 py-2">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="mt-1 break-words text-xs text-foreground">{toDisplayText(row.value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}

            {hasDisplayValue(error) && (
              <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="text-xs font-medium text-destructive">{t('approvalDialog.errorTitle')}</p>
                <p className="mt-1 text-xs text-destructive">{toDisplayText(error)}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={clearError}
                >
                  {t('approvalDialog.clearError')}
                </Button>
              </div>
            )}

            {isAwaitingResolution && (
              <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">{t('approvalDialog.submitting')}</p>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer px-6 py-5 sm:px-7">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <HugeiconsIcon icon={Clock04Icon} size={16} />
              {expiryLabel}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              {decisions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={option.variant}
                  onClick={() => handleDecision(option.value)}
                  disabled={decisionDisabled}
                >
                  {t(option.labelKey)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ApprovalDialog;
