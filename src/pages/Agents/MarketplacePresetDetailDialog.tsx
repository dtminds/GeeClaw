import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PresetInstallStage } from '@/stores/agents';
import type { AgentPresetSummary } from '@/types/agent';
import {
  getPresetAvailabilityCopy,
  getPresetPlatformLabels,
  getPresetRequirementMessages,
} from './preset-platforms';

type MarketplacePresetDetailDialogProps = {
  preset: AgentPresetSummary | null;
  open: boolean;
  installed: boolean;
  hasUpdate: boolean;
  isInstalling: boolean;
  installStage: PresetInstallStage;
  installProgress: number;
  disableInstall: boolean;
  onClose: () => void;
  onInstall: (agentId: string) => void;
  onUpdate: (agentId: string) => void;
  availabilityTitle?: string;
  skillsTitle?: string;
  closeLabel?: string;
  locale?: string;
  errorMessage?: string | null;
};

export function MarketplacePresetDetailDialog({
  preset,
  open,
  installed,
  hasUpdate,
  isInstalling,
  installStage,
  installProgress,
  disableInstall,
  onClose,
  onInstall,
  onUpdate,
  availabilityTitle,
  skillsTitle,
  closeLabel,
  locale,
  errorMessage,
}: MarketplacePresetDetailDialogProps) {
  const { t } = useTranslation('agents');

  if (!preset) {
    return null;
  }

  const platformLabels = getPresetPlatformLabels(t, preset.platforms);
  const availabilityCopy = !preset.supportedOnCurrentPlatform
    ? getPresetAvailabilityCopy(t, locale, preset.platforms)
    : null;
  const requirementMessages = getPresetRequirementMessages(t, locale, preset.missingRequirements);
  const installStageLabel = t(`marketplace.installState.${installStage}`);
  const installLabel = isInstalling
    ? installStageLabel
    : installed
      ? hasUpdate
        ? t('marketplace.update')
        : t('marketplace.installed')
    : !preset.supportedOnCurrentPlatform
      ? t('marketplace.unavailable')
    : preset.installable
      ? t('marketplace.install')
      : t('marketplace.requirementsMissing');
  const primaryAction = installed && hasUpdate ? onUpdate : onInstall;
  const actionDisabled = isInstalling
    || disableInstall
    || (installed ? !hasUpdate : !preset.installable);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        hideCloseButton
        className="modal-card-surface w-[min(620px,calc(100vw-2rem))] max-w-[620px] overflow-hidden rounded-[28px] border bg-[var(--app-sidebar)] p-0 shadow-none"
      >
        <div className="relative px-6 py-6 sm:px-8 sm:py-8">
          <button
            type="button"
            onClick={onClose}
            className="modal-close-button absolute right-6 top-6"
            aria-label={closeLabel || 'Close'}
          >
            <X className="h-5 w-5" />
          </button>

          <DialogHeader className="items-center pt-6 text-center sm:pt-8">
            <div className="mb-2 flex h-18 w-18 items-center justify-center text-[56px]">
              <span aria-hidden="true">{preset.emoji}</span>
            </div>
            <DialogTitle className="modal-title max-w-[24ch] text-center text-[22px] leading-[1.3] tracking-[-0.03em] sm:text-[26px]">
              {preset.name}
            </DialogTitle>
            <DialogDescription className="modal-description mt-1 max-w-3xl text-center text-[13px] leading-7 text-foreground/42 dark:text-foreground/56 sm:text-[14px]">
              {preset.description}
            </DialogDescription>
            <div className="modal-section-surface mt-5 w-full rounded-[18px] border px-4 py-4 shadow-none text-left">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                    {t('fields.agentId')}
                  </p>
                  <p className="font-mono text-[13px] text-foreground">{preset.agentId}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                    {availabilityTitle || 'Platforms'}
                  </p>
                  <p className="text-[13px] leading-6 text-foreground/78">
                    {platformLabels.join(' / ')}
                  </p>
                </div>
              </div>
              {availabilityCopy && (
                <p className="mt-4 text-[14px] leading-6 text-foreground/72">
                  {availabilityCopy}
                </p>
              )}
            </div>
          </DialogHeader>
          {preset.presetSkills?.length > 0 &&
          <div className="mt-6 space-y-6 sm:mt-8">
            <section className="border-t border-black/6 pt-6 dark:border-white/10">
              <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                {skillsTitle || t('marketplace.detail.skills')}
              </h3>
              <div className="modal-section-surface mt-4 rounded-[18px] border px-4 py-4 shadow-none">
                <div className="flex flex-wrap gap-2">
                  {preset.presetSkills.map((skill) => (
                    <Badge
                      key={skill}
                      variant="secondary"
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                    >
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            </section>
          </div>}
          <div className="modal-footer mt-8 flex-col items-stretch gap-4 pb-1 sm:mt-10">
            {requirementMessages.length > 0 && (
              <p className="text-center text-[13px] leading-6 text-foreground/68">
                {requirementMessages.join('，')}
              </p>
            )}
            {isInstalling && (
              <div className="preset-install-progress w-full space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-foreground/75 transition-[width] duration-300"
                    style={{ width: `${installProgress}%` }}
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  {installStageLabel} · {t('marketplace.installProgress', { progress: installProgress })}
                </p>
              </div>
            )}
            {errorMessage && (
              <p className="text-center text-sm leading-6 text-destructive">
                {errorMessage}
              </p>
            )}

            <Button
              className="modal-primary-button w-full px-8 text-[14px]"
              disabled={actionDisabled}
              onClick={() => primaryAction(preset.agentId)}
            >
              {installLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
