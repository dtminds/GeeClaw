import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AgentPresetSummary } from '@/types/agent';
import { getPresetAvailabilityCopy, getPresetPlatformLabels } from './preset-platforms';

type MarketplacePresetDetailDialogProps = {
  preset: AgentPresetSummary | null;
  open: boolean;
  installed: boolean;
  onClose: () => void;
  onInstall: (presetId: string) => void;
};

export function MarketplacePresetDetailDialog({
  preset,
  open,
  installed,
  onClose,
  onInstall,
}: MarketplacePresetDetailDialogProps) {
  const { t } = useTranslation('agents');

  if (!preset) {
    return null;
  }

  const platformLabels = getPresetPlatformLabels(t, preset.platforms);
  const availabilityCopy = !preset.supportedOnCurrentPlatform
    ? getPresetAvailabilityCopy(t, preset.platforms)
    : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="modal-card-surface w-[min(760px,calc(100vw-2rem))] max-w-[760px] overflow-hidden rounded-[28px] border p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{preset.name}</DialogTitle>
          <DialogDescription>{preset.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[min(86vh,760px)] flex-col overflow-hidden">
          <div className="border-b border-black/5 px-8 py-7 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="modal-title">{preset.name}</h2>
              <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                {t('managedBadge')}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{preset.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {platformLabels.map((label) => (
                <Badge
                  key={label}
                  variant="secondary"
                  className="rounded-full border-0 bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto px-8 py-7">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.summary')}</h3>
              <div className="modal-section-surface space-y-3 rounded-2xl border p-4">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                    {t('fields.agentId')}
                  </p>
                  <p className="font-mono text-[13px] text-foreground">{preset.agentId}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                    {t('fields.workspace')}
                  </p>
                  <p className="font-mono text-[13px] text-foreground">{preset.workspace}</p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.skills')}</h3>
              <div className="flex flex-wrap gap-2">
                {preset.presetSkills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className="rounded-full border-0 bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
                  >
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.files')}</h3>
              <div className="flex flex-wrap gap-2">
                {preset.managedFiles.map((file) => (
                  <Badge
                    key={file}
                    variant="secondary"
                    className="rounded-full border-0 bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
                  >
                    {file}
                  </Badge>
                ))}
              </div>
            </section>

            {availabilityCopy && (
              <p className="text-sm text-muted-foreground">{availabilityCopy}</p>
            )}
          </div>

          <div className="modal-footer justify-end px-8 py-5">
            <Button
              className="modal-primary-button"
              disabled={installed || !preset.supportedOnCurrentPlatform}
              onClick={() => onInstall(preset.presetId)}
            >
              {installed
                ? t('marketplace.installed')
                : preset.supportedOnCurrentPlatform
                  ? t('marketplace.install')
                  : t('marketplace.unavailable')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
