import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';
import inspirationJson from '@/assets/inspiration/inspiration.json';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface InspirationItem {
  category: string;
  order: number;
  title: string;
  subtitle: string;
  emoji?: string;
  prompt: string;
  scene?: string;
  required_skills?: string[];
  is_show: boolean;
}

interface InspirationPayload {
  data?: {
    resp?: {
      data?: {
        list?: InspirationItem[];
      };
    };
  };
}

const CATEGORY_TRANSLATION_KEYS: Record<string, string> = {
  '办公提效': 'productivity',
  '研究学习': 'study',
  '娱乐游戏': 'fun',
  '自律生活': 'life',
};

const rawInspirationItems: InspirationItem[] =
  (inspirationJson as InspirationPayload).data?.resp?.data?.list ?? [];

const inspirationItems: InspirationItem[] = [...rawInspirationItems]
  .filter((item) => item.is_show)
  .sort((a, b) => a.order - b.order);

const inspirationCategories: string[] = Array.from(
  new Set(inspirationItems.map((item) => item.category)),
);

type GatewaySkillStatus = {
  skillKey?: string;
  slug?: string;
  eligible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
};

function resolveKnownSkillKeys(skills: GatewaySkillStatus[] | undefined): string[] {
  return (skills || [])
    .flatMap((skill) => [skill.skillKey, skill.slug])
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
}

function hasMissingRequirements(skill: GatewaySkillStatus): boolean {
  const missing = skill.missing;
  if (!missing) return false;

  return Boolean(
    (missing.bins && missing.bins.length > 0)
    || (missing.anyBins && missing.anyBins.length > 0)
    || (missing.env && missing.env.length > 0)
    || (missing.config && missing.config.length > 0)
    || (missing.os && missing.os.length > 0),
  );
}

function resolveEnabledSkillKeys(skills: GatewaySkillStatus[] | undefined): string[] {
  return (skills || [])
    .filter((skill) => {
      if (skill.disabled || skill.blockedByAllowlist) {
        return false;
      }

      if (hasMissingRequirements(skill)) {
        return false;
      }

      return skill.eligible !== false;
    })
    .map((skill) => skill.skillKey || skill.slug || '')
    .filter(Boolean);
}

function buildSeedPrompt(prompt: string, requiredSkills: string[]): string {
  const normalizedSkills = requiredSkills
    .map((skill) => skill.trim())
    .filter(Boolean)
    .map((skill) => (skill.startsWith('/') ? skill : `/${skill}`));

  return [...normalizedSkills, prompt.trim()].filter(Boolean).join(' ');
}

export function InspirationPlazaSection() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const agents = useAgentsStore((state) => state.agents);
  const defaultAgentId = useAgentsStore((state) => state.defaultAgentId);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const openAgentMainSession = useChatStore((state) => state.openAgentMainSession);
  const queueComposerSeed = useChatStore((state) => state.queueComposerSeed);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<InspirationItem | null>(null);
  const [enabledSkillKeys, setEnabledSkillKeys] = useState<string[]>([]);
  const [requiredSkillsLoading, setRequiredSkillsLoading] = useState(false);

  const filteredItems = activeCategory === 'all'
    ? inspirationItems
    : inspirationItems.filter((item) => item.category === activeCategory);

  const sceneLines = useMemo(
    () => selectedItem?.scene
      ?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean) ?? [],
    [selectedItem],
  );

  const requiredSkills = useMemo(
    () => (selectedItem?.required_skills || []).filter(Boolean),
    [selectedItem],
  );

  const missingRequiredSkills = useMemo(() => {
    if (requiredSkills.length === 0) {
      return [];
    }

    const enabledSet = new Set(enabledSkillKeys);
    return requiredSkills.filter((skillId) => !enabledSet.has(skillId));
  }, [enabledSkillKeys, requiredSkills]);

  useEffect(() => {
    if (!selectedItem || requiredSkills.length === 0) {
      return;
    }

    let cancelled = false;
    const agentId = useAgentsStore.getState().defaultAgentId || defaultAgentId || 'main';

    useGatewayStore.getState().rpc<{ skills?: GatewaySkillStatus[] }>('skills.status', { agentId })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setEnabledSkillKeys(resolveEnabledSkillKeys(result.skills));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn('Failed to load required skill status for inspiration item:', error);
        setEnabledSkillKeys([]);
      })
      .finally(() => {
        if (!cancelled) {
          setRequiredSkillsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultAgentId, requiredSkills, selectedItem]);

  const getCategoryLabel = (category: string) => {
    if (category === 'all') {
      return t('inspirationPlaza.all');
    }

    const key = CATEGORY_TRANSLATION_KEYS[category];
    return key ? t(`inspirationPlaza.categories.${key}`) : category;
  };

  const handleSelectItem = (item: InspirationItem) => {
    setSelectedItem(item);
    setRequiredSkillsLoading(Boolean(item.required_skills?.length));
  };

  const handleCloseItem = () => {
    setSelectedItem(null);
    setRequiredSkillsLoading(false);
  };

  const handleUseNow = async () => {
    if (!selectedItem) {
      return;
    }

    if (agents.length === 0) {
      try {
        await fetchAgents();
      } catch (error) {
        console.warn('Failed to refresh agents before opening inspiration prompt:', error);
      }
    }

    const resolvedDefaultAgentId = useAgentsStore.getState().defaultAgentId || defaultAgentId || 'main';
    let tokenizableRequiredSkills: string[] = [];

    if (requiredSkills.length > 0) {
      try {
        const result = await useGatewayStore.getState().rpc<{ skills?: GatewaySkillStatus[] }>('skills.status', {
          agentId: resolvedDefaultAgentId,
        });
        const knownSkillKeys = new Set(resolveKnownSkillKeys(result.skills));
        tokenizableRequiredSkills = requiredSkills.filter((skillId) => knownSkillKeys.has(skillId));
      } catch (error) {
        console.warn('Failed to refresh skill status before seeding inspiration prompt:', error);
      }
    }

    await openAgentMainSession(resolvedDefaultAgentId);
    queueComposerSeed(buildSeedPrompt(selectedItem.prompt, requiredSkills), tokenizableRequiredSkills);
    handleCloseItem();
    navigate('/chat');
  };

  const handleManageSkills = () => {
    const resolvedDefaultAgentId = useAgentsStore.getState().defaultAgentId || defaultAgentId || 'main';
    handleCloseItem();
    navigate(`/skills?agentId=${encodeURIComponent(resolvedDefaultAgentId)}`);
  };

  return (
    <>
      <section className="space-y-5">

        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div
            role="tablist"
            aria-label={t('inspirationPlaza.title')}
            className="flex min-w-max items-center gap-6 border-b border-black/5 px-4 dark:border-white/5"
          >
            {['all', ...inspirationCategories].map((category) => {
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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => (
            <button
              key={`${item.category}-${item.order}-${item.title}`}
              type="button"
              onClick={() => handleSelectItem(item)}
              className={cn(
                'group relative min-h-[176px] overflow-hidden rounded-[20px] border border-black/[0.06] text-left',
                'bg-muted/20 p-5 shadow-none transition-all duration-200',
                'hover:-translate-y-0.5 hover:border-black/[0.09]',
                'dark:border-white/[0.08]',
                'dark:hover:border-white/[0.12]',
              )}
            >
              <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/60 to-transparent opacity-80" />

              <div className="mb-5 flex h-12 w-12 items-center justify-center">
                {item.emoji ? (
                  <img
                    src={item.emoji}
                    alt=""
                    loading="lazy"
                    className="h-12 w-12 object-contain"
                  />
                ) : (
                  <span className="text-xl">✨</span>
                )}
              </div>

              <div className="space-y-1">
                <h3 className="min-h-[1.4em] line-clamp-1 text-[16px] font-semibold leading-[1.4] tracking-[-0.02em] text-foreground">
                  {item.title}
                </h3>
                <p className="min-h-8 line-clamp-2 text-[12px] leading-4 text-foreground/45 dark:text-foreground/56">
                  {item.subtitle}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && handleCloseItem()}>
        <DialogContent
          hideCloseButton
          className="modal-card-surface w-[min(620px,calc(100vw-2rem))] max-w-[620px] overflow-hidden rounded-[28px] border bg-[var(--app-sidebar)] p-0 shadow-none"
        >
          {selectedItem && (
            <div className="relative px-6 py-6 sm:px-8 sm:py-8">
              <button
                type="button"
                onClick={handleCloseItem}
                className="modal-close-button absolute right-6 top-6"
                aria-label={t('inspirationPlaza.close')}
              >
                <X className="h-5 w-5" />
              </button>

              <DialogHeader className="items-center pt-6 text-center sm:pt-8">
                <div className="mb-2 flex h-18 w-18 items-center justify-center">
                  {selectedItem.emoji ? (
                    <img
                      src={selectedItem.emoji}
                      alt=""
                      loading="lazy"
                      className="h-18 w-18 object-contain"
                    />
                  ) : (
                    <span className="text-xl">✨</span>
                  )}
                </div>
                <DialogTitle className="modal-title text-center text-[22px] leading-[1.3] tracking-[-0.03em] sm:text-[26px]">
                  {selectedItem.title}
                </DialogTitle>
                <DialogDescription className="modal-description mt-1 max-w-3xl text-center text-[13px] leading-7 text-foreground/42 dark:text-foreground/56 sm:text-[14px]">
                  {selectedItem.subtitle}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-5 space-y-5 sm:mt-6">
                <section className="border-t border-black/6 pt-5 dark:border-white/10">
                  <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                    {t('inspirationPlaza.sceneTitle')}
                  </h3>
                  <div className="modal-section-surface mt-4 rounded-[18px] border px-4 py-2 shadow-none">
                    <div className="text-[14px] leading-6 text-foreground/72">
                      {sceneLines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="border-t border-black/6 pt-5 dark:border-white/10">
                  <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                    {t('inspirationPlaza.promptTitle')}
                  </h3>
                  <div className="modal-section-surface mt-4 rounded-[18px] border px-4 py-4 shadow-none">
                    <p className="whitespace-pre-wrap text-[14px] leading-6 text-foreground/78">
                      {selectedItem.prompt}
                    </p>
                  </div>
                </section>

                {missingRequiredSkills.length > 0 && !requiredSkillsLoading && (
                  <div className="border-t border-black/6 pt-4 dark:border-white/10">
                    <div className="flex items-start gap-3 text-amber-700 dark:text-amber-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="text-[13px] leading-6">
                        {t('inspirationPlaza.requiredSkillsMissing', {
                          defaultValue: 'Missing skills: {{skills}}. Install or enable them before using this prompt for best results.',
                          skills: missingRequiredSkills.join(', '),
                        })}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer mt-5 justify-center gap-3 pb-1 sm:mt-6">
                {requiredSkills.length > 0 && missingRequiredSkills.length > 0 && !requiredSkillsLoading && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleManageSkills}
                    className="modal-secondary-button min-w-[160px] px-8 text-[14px]"
                  >
                    {t('inspirationPlaza.manageSkills', { defaultValue: 'Manage Skills' })}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => void handleUseNow()}
                  className="modal-primary-button min-w-[160px] px-8 text-[14px]"
                >
                  {t('inspirationPlaza.useNow')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InspirationPlazaSection;
