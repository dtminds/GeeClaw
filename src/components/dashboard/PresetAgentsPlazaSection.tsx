import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarketplacePresetDetailDialog } from '@/pages/Agents/MarketplacePresetDetailDialog';

const PRESET_CATEGORY_TRANSLATION_KEYS: Record<string, string> = {
  finance: 'finance',
  research: 'research',
};

export function PresetAgentsPlazaSection() {
  const { t } = useTranslation('dashboard');
  const { t: tAgents, i18n } = useTranslation('agents');
  const navigate = useNavigate();
  const {
    agents,
    presets,
    installingPresetId,
    installStage,
    installProgress,
    marketplaceCompletion,
    error,
    fetchAgents,
    fetchPresets,
    installMarketplaceAgent,
    updateMarketplaceAgent,
    clearMarketplaceCompletion,
  } = useAgentsStore();
  const openAgentMainSession = useChatStore((state) => state.openAgentMainSession);
  const queueComposerSeed = useChatStore((state) => state.queueComposerSeed);

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [pendingUpdateAgentId, setPendingUpdateAgentId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchPresets()]);
  }, [fetchAgents, fetchPresets]);

  useEffect(() => {
    if (marketplaceCompletion) {
      setActiveAgentId(null);
      setPendingUpdateAgentId(null);
    }
  }, [marketplaceCompletion]);

  const categories = useMemo(
    () => Array.from(new Set(presets.map((preset) => preset.category).filter(Boolean))),
    [presets],
  );

  const installedAgentIds = useMemo(
    () => new Set(
      agents
        .filter((agent) => agent.source === 'preset' && agent.managementSource === 'marketplace')
        .map((agent) => agent.id),
    ),
    [agents],
  );

  const filteredPresets = useMemo(
    () => (activeCategory === 'all'
      ? presets
      : presets.filter((preset) => preset.category === activeCategory)),
    [activeCategory, presets],
  );

  const activePreset = useMemo(
    () => presets.find((preset) => preset.agentId === activeAgentId) ?? null,
    [activeAgentId, presets],
  );
  const completionPreset = useMemo(
    () => presets.find((preset) => preset.agentId === marketplaceCompletion?.agentId) ?? null,
    [marketplaceCompletion?.agentId, presets],
  );

  const getCategoryLabel = (category: string) => {
    if (category === 'all') {
      return t('presetPlaza.all');
    }

    const key = PRESET_CATEGORY_TRANSLATION_KEYS[category];
    return key ? t(`presetPlaza.categories.${key}`) : category;
  };

  const handleUpdateConfirm = async () => {
    if (!pendingUpdateAgentId) {
      return;
    }

    const targetAgentId = pendingUpdateAgentId;
    setPendingUpdateAgentId(null);
    await updateMarketplaceAgent(targetAgentId);
  };

  const handleSuccessAction = async () => {
    if (!marketplaceCompletion) {
      return;
    }

    await openAgentMainSession(marketplaceCompletion.agentId);
    if (marketplaceCompletion.promptText) {
      queueComposerSeed(marketplaceCompletion.promptText);
    }
    clearMarketplaceCompletion();
    navigate('/chat');
  };

  return (
    <>
      <section className="space-y-5">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div
            role="tablist"
            aria-label={t('presetPlaza.title')}
            className="flex min-w-max items-center gap-6 border-b border-black/5 px-4 dark:border-white/5"
          >
            {['all', ...categories].map((category) => {
              const active = activeCategory === category;

              return (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(category)}
                  className={cn(
                    'relative pb-2 text-[15px] font-medium transition-colors',
                    active
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {getCategoryLabel(category)}
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="rounded-[18px] border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPresets.map((preset) => {
            return (
              <button
                key={preset.agentId}
                type="button"
                onClick={() => setActiveAgentId(preset.agentId)}
                className={cn(
                  'group relative min-h-[176px] overflow-hidden rounded-[20px] border border-black/[0.06] text-left',
                  'bg-muted/20 p-5 shadow-none transition-all duration-200',
                  'hover:-translate-y-0.5 hover:border-black/[0.09]',
                  'dark:border-white/[0.08]',
                  'dark:hover:border-white/[0.12]',
                )}
              >
                <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/60 to-transparent opacity-80" />

                <div className="mb-5 flex h-12 w-12 items-center justify-center text-[40px]">
                  <span aria-hidden="true">{preset.emoji}</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <h3 className="min-h-[1.4em] line-clamp-1 text-[16px] font-semibold leading-[1.4] tracking-[-0.02em] text-foreground">
                      {preset.name}
                    </h3>
                    <p className="min-h-8 line-clamp-2 text-[12px] leading-4 text-foreground/45 dark:text-foreground/56">
                      {preset.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <MarketplacePresetDetailDialog
        preset={activePreset}
        open={!!activePreset}
        installed={activePreset ? activePreset.installed || installedAgentIds.has(activePreset.agentId) : false}
        hasUpdate={activePreset?.hasUpdate ?? false}
        isInstalling={activePreset ? installingPresetId === activePreset.agentId : false}
        installStage={installStage}
        installProgress={installProgress}
        disableInstall={!!installingPresetId}
        onClose={() => setActiveAgentId(null)}
        onInstall={(agentId) => void installMarketplaceAgent(agentId)}
        onUpdate={(agentId) => setPendingUpdateAgentId(agentId)}
        availabilityTitle={t('presetPlaza.platformsTitle')}
        skillsTitle={t('presetPlaza.skillsTitle')}
        closeLabel={t('presetPlaza.close')}
        locale={i18n.resolvedLanguage || i18n.language}
      />

      <ConfirmDialog
        open={!!pendingUpdateAgentId}
        title={tAgents('marketplace.updateConfirmTitle')}
        message={tAgents('marketplace.updateConfirmMessage')}
        confirmLabel={tAgents('marketplace.updateConfirmConfirm')}
        cancelLabel={tAgents('marketplace.updateConfirmCancel')}
        onCancel={() => setPendingUpdateAgentId(null)}
        onConfirm={() => void handleUpdateConfirm()}
      />

      <Dialog open={!!marketplaceCompletion} onOpenChange={(open) => !open && clearMarketplaceCompletion()}>
        <DialogContent
          hideCloseButton
          className="modal-card-surface w-[min(560px,calc(100vw-2rem))] max-w-[560px] overflow-hidden rounded-[28px] border bg-[var(--app-sidebar)] p-0 shadow-none"
        >
          {marketplaceCompletion && (
            <div className="relative px-6 py-6 sm:px-8 sm:py-8">
              <button
                type="button"
                onClick={clearMarketplaceCompletion}
                className="modal-close-button absolute right-6 top-6"
                aria-label={t('presetPlaza.close')}
              >
                <X className="h-5 w-5" />
              </button>

              <DialogHeader className="items-center pt-6 text-center sm:pt-8">
                <div className="mb-2 flex h-18 w-18 items-center justify-center text-[56px]">
                  <span aria-hidden="true">{completionPreset?.emoji ?? '🤖'}</span>
                </div>
                <DialogTitle className="modal-title text-center text-[22px] leading-[1.3] tracking-[-0.03em] sm:text-[26px]">
                  {marketplaceCompletion.operation === 'install'
                    ? tAgents('marketplace.postInstallTitle')
                    : tAgents('marketplace.postUpdateTitle')}
                </DialogTitle>
                <DialogDescription className="modal-description mt-1 max-w-3xl text-center text-[13px] leading-7 text-foreground/42 dark:text-foreground/56 sm:text-[14px]">
                  {marketplaceCompletion.operation === 'install'
                    ? tAgents('marketplace.postInstallDescription')
                    : tAgents('marketplace.postUpdateDescription')}
                </DialogDescription>
                {marketplaceCompletion.promptText && (
                  <div className="modal-section-surface mt-5 w-full rounded-[18px] border px-4 py-4 text-left shadow-none">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                      {tAgents('marketplace.postInstallPromptLabel')}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground/84">
                      {marketplaceCompletion.promptText}
                    </p>
                  </div>
                )}
              </DialogHeader>

              <div className="modal-footer mt-8 flex-col-reverse items-stretch gap-3 pb-1 sm:mt-10 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  className="modal-secondary-button"
                  onClick={clearMarketplaceCompletion}
                >
                  {tAgents('marketplace.dismiss')}
                </Button>
                <Button
                  className="modal-primary-button"
                  onClick={() => void handleSuccessAction()}
                >
                  {marketplaceCompletion.promptText
                    ? tAgents('marketplace.goSend')
                    : tAgents('marketplace.goChat')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PresetAgentsPlazaSection;
