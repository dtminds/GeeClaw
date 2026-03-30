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
  const { t, i18n } = useTranslation('agents');

  if (!preset) {
    return null;
  }

  const platformLabels = getPresetPlatformLabels(t, preset.platforms);
  const availabilityCopy = !preset.supportedOnCurrentPlatform
    ? getPresetAvailabilityCopy(t, i18n.resolvedLanguage || i18n.language, preset.platforms)
    : null;
  const installLabel = installed
    ? t('marketplace.installed')
    : preset.supportedOnCurrentPlatform
      ? t('marketplace.install')
      : t('marketplace.unavailable');

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
              <span
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.04] text-2xl dark:bg-white/[0.06]"
                aria-hidden="true"
              >
                {preset.emoji}
              </span>
              <h2 className="modal-title">{preset.name}</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{preset.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {platformLabels.map((label) => (
                <Badge
                  key={label}
                  variant="secondary"
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto px-8 py-7">

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.skills')}</h3>
              <div className="flex flex-wrap gap-2">
                {preset.presetSkills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className=" px-2.5 py-1 text-[11px] font-medium"
                  >
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.summary')}</h3>
              <div className="modal-section-surface space-y-3 rounded-2xl border p-4">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                    {t('fields.agentId')}
                  </p>
                  <p className="font-mono text-[13px] text-foreground">{preset.agentId}</p>
                </div>
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
              {installLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
