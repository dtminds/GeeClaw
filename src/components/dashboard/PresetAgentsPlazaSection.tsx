import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { MarketplacePresetDetailDialog } from '@/pages/Agents/MarketplacePresetDetailDialog';

const PRESET_CATEGORY_TRANSLATION_KEYS: Record<string, string> = {
  finance: 'finance',
  research: 'research',
};

export function PresetAgentsPlazaSection() {
  const { t } = useTranslation('dashboard');
  const { i18n } = useTranslation();
  const {
    agents,
    presets,
    installingPresetId,
    installStage,
    installProgress,
    error,
    fetchAgents,
    fetchPresets,
    installMarketplaceAgent,
    updateMarketplaceAgent,
  } = useAgentsStore();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchPresets()]);
  }, [fetchAgents, fetchPresets]);

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

  const getCategoryLabel = (category: string) => {
    if (category === 'all') {
      return t('presetPlaza.all');
    }

    const key = PRESET_CATEGORY_TRANSLATION_KEYS[category];
    return key ? t(`presetPlaza.categories.${key}`) : category;
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
        onUpdate={(agentId) => void updateMarketplaceAgent(agentId)}
        availabilityTitle={t('presetPlaza.platformsTitle')}
        skillsTitle={t('presetPlaza.skillsTitle')}
        closeLabel={t('presetPlaza.close')}
        locale={i18n.resolvedLanguage || i18n.language}
      />
    </>
  );
}

export default PresetAgentsPlazaSection;
