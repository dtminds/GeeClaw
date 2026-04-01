import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Loader2, Package2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useSkillsStore } from '@/stores/skills';
import type { Skill } from '@/types/skill';

interface AgentSkillsPanelProps {
  agentId: string;
  title: string;
  description?: string;
}

function normalizeSkillSearch(value: string): string {
  return value
    .normalize('NFKD')
    .trim()
    .toLowerCase();
}

function getSkillDescription(skill: Skill): string {
  const description = skill.description?.trim();
  if (description) {
    return description;
  }

  return `/${skill.slug || skill.id}`;
}

function SkillScopeOption({
  skill,
  selected,
  disabled,
  onSelect,
}: {
  skill: Skill;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('skills');
  const source = (skill.source || '').trim().toLowerCase();
  const sourceLabel = skill.isCore
    ? t('detail.coreSystem', { defaultValue: 'Core System' })
    : skill.isBundled
      ? t('source.badge.bundled', { defaultValue: 'Bundled' })
      : source === 'agents-skills-personal'
        ? t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' })
        : source === 'agents-skills-project'
          ? t('source.badge.agentsProject', { defaultValue: 'Project .agents' })
          : source === 'openclaw-extra'
            ? t('source.badge.extra', { defaultValue: 'Extra dirs' })
            : source === 'openclaw-managed'
              ? t('source.badge.managed', { defaultValue: 'Managed' })
              : source === 'workspace'
                ? t('source.badge.workspace', { defaultValue: 'Workspace' })
                : t('source.badge.unknown', { defaultValue: 'Skill' });

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'text-foreground' : 'surface-hover',
        disabled && !selected && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {selected ? <Check className="h-3.5 w-3.5 text-foreground" /> : <Package2 className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex flex-1 items-baseline gap-2 overflow-hidden">
        <span className="shrink-0 truncate text-[13px] font-medium text-foreground">{skill.name}</span>
        <span className="truncate text-[11px] text-muted-foreground">{getSkillDescription(skill)}</span>
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
        {sourceLabel}
      </span>
    </button>
  );
}

export function AgentSkillsPanel({ agentId, title, description }: AgentSkillsPanelProps) {
  const { t } = useTranslation(['chat', 'skills']);
  const agent = useAgentsStore((state) => state.agents.find((entry) => entry.id === agentId));
  const updateAgentSettings = useAgentsStore((state) => state.updateAgentSettings);
  const { skills, fetchSkills } = useSkillsStore();
  const [skillScopeMode, setSkillScopeMode] = useState<'default' | 'specified'>(agent?.skillScope.mode ?? 'default');
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    agent?.skillScope.mode === 'specified' ? agent.skillScope.skills : [],
  );
  const [maxSelectable, setMaxSelectable] = useState(20);
  const [savingSkills, setSavingSkills] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const skillSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    if (!agent) return;
    setSkillScopeMode(agent.skillScope.mode);
    setSelectedSkills(agent.skillScope.mode === 'specified' ? agent.skillScope.skills : []);
    setMaxSelectable(
      agent.skillScope.mode === 'specified'
        ? Math.max(20, agent.skillScope.skills.length)
        : 20,
    );
  }, [agent]);

  useEffect(() => {
    if (!skillPickerOpen) {
      setSkillSearch('');
      return;
    }

    const timeoutId = window.setTimeout(() => {
      skillSearchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [skillPickerOpen]);

  const presetSkillSet = useMemo(() => new Set(agent?.presetSkills ?? []), [agent?.presetSkills]);
  const availableSkills = useMemo(
    () => skills.filter((skill) => skill.eligible !== false && skill.hidden !== true),
    [skills],
  );
  const availableSkillsById = useMemo(
    () => new Map(availableSkills.map((skill) => [skill.id, skill])),
    [availableSkills],
  );
  const filteredSkills = useMemo(() => {
    const normalizedQuery = normalizeSkillSearch(skillSearch);
    if (!normalizedQuery) {
      return availableSkills;
    }

    return availableSkills.filter((skill) => (
      [
        skill.name,
        skill.id,
        skill.slug || '',
        getSkillDescription(skill),
      ]
        .map((value) => normalizeSkillSearch(value))
        .some((value) => value.includes(normalizedQuery))
    ));
  }, [availableSkills, skillSearch]);

  const toggleSkill = (skillId: string) => {
    setSelectedSkills((current) => {
      const currentSet = new Set(current);
      if (currentSet.has(skillId)) {
        if (presetSkillSet.has(skillId) && agent?.managed) {
          return current;
        }
        currentSet.delete(skillId);
      } else if (currentSet.size < maxSelectable) {
        currentSet.add(skillId);
      }
      return Array.from(currentSet);
    });
  };

  const handleSelectSkill = (skillId: string) => {
    if (selectedSkills.includes(skillId) || selectedSkills.length >= maxSelectable) {
      return;
    }

    toggleSkill(skillId);
    setSkillPickerOpen(false);
    setSkillSearch('');
  };

  const handleSaveSkills = async () => {
    if (!agent) return;
    if (skillScopeMode === 'specified' && selectedSkills.length === 0) {
      return;
    }

    setSavingSkills(true);
    try {
      await updateAgentSettings(agent.id, {
        skillScope: skillScopeMode === 'default'
          ? { mode: 'default' }
          : { mode: 'specified', skills: selectedSkills },
      });
      toast.success(t('agentSettingsDialog.general.toastSaved'));
    } catch (error) {
      toast.error(t('agentSettingsDialog.general.toastSaveFailed', { error: toUserMessage(error) }));
    } finally {
      setSavingSkills(false);
    }
  };

  const skillScopeHint = agent?.managed && (agent.presetSkills?.length ?? 0) > 0
    ? t('agentSettingsDialog.skillsManagedHint')
    : null;

  return (
    <section className="flex h-full min-h-0 flex-col px-1">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-5">
        {skillScopeHint && <p className="text-sm text-muted-foreground">{skillScopeHint}</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={skillScopeMode === 'default' ? 'default' : 'outline'}
            disabled={!agent || savingSkills || !agent.canUseDefaultSkillScope}
            onClick={() => setSkillScopeMode('default')}
            className="h-9 rounded-full px-4 text-[13px]"
          >
            {t('agentSettingsDialog.skillScope.default')}
          </Button>
          <Button
            type="button"
            variant={skillScopeMode === 'specified' ? 'default' : 'outline'}
            disabled={!agent || savingSkills}
            onClick={() => setSkillScopeMode('specified')}
            className="h-9 rounded-full px-4 text-[13px]"
          >
            {t('agentSettingsDialog.skillScope.specified')}
          </Button>
        </div>

        {skillScopeMode === 'specified' && (
          <div className="space-y-3 rounded-2xl border border-black/8 p-4 dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {t('agentSettingsDialog.skillScope.selected')}
              </p>
              <p className="text-xs text-muted-foreground">{selectedSkills.length} / {maxSelectable}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedSkills.map((skillId) => {
                const skill = availableSkillsById.get(skillId);
                const locked = agent?.managed && presetSkillSet.has(skillId);
                const label = skill?.name || skillId;
                return (
                  <button
                    key={skillId}
                    type="button"
                    onClick={() => toggleSkill(skillId)}
                    disabled={locked}
                    title={locked ? t('agentSettingsDialog.skillScope.preset') : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                      locked
                        ? 'bg-primary/10 text-primary'
                        : 'bg-black/[0.04] text-foreground/80 hover:bg-black/[0.08] dark:bg-white/[0.08]',
                    )}
                  >
                    <span>{label}</span>
                    {locked ? (
                      <span className="text-[10px] uppercase tracking-[0.08em] text-primary/80">
                        {t('agentSettingsDialog.skillScope.preset')}
                      </span>
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                );
              })}
            </div>

            <Popover.Root open={skillPickerOpen} onOpenChange={setSkillPickerOpen}>
              <Popover.Trigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="modal-field-surface surface-hover h-11 w-full justify-between rounded-2xl px-4 text-[13px] font-medium text-foreground shadow-none"
                >
                  <span className="flex min-w-0 items-center gap-2 text-left">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {t('agentSettingsDialog.skillScope.addSkill')}
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="start"
                  side="bottom"
                  sideOffset={8}
                  className="z-[130] w-[min(36rem,calc(100vw-5rem))] overflow-hidden rounded-[22px] border border-black/8 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-card"
                >
                  <div className="relative px-1 pb-2">
                    <Input
                      ref={skillSearchInputRef}
                      value={skillSearch}
                      onChange={(event) => setSkillSearch(event.target.value)}
                      aria-label={t('agentSettingsDialog.skillScope.search')}
                      placeholder={t('agentSettingsDialog.skillScope.searchPlaceholder')}
                      className="modal-field-surface h-10 rounded-xl border-0 px-3 text-[13px] shadow-none"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto pr-1">
                    {filteredSkills.length > 0 ? (
                      filteredSkills.map((skill) => {
                        const selected = selectedSkills.includes(skill.id);
                        return (
                          <SkillScopeOption
                            key={skill.id}
                            skill={skill}
                            selected={selected}
                            disabled={!selected && selectedSkills.length >= maxSelectable}
                            onSelect={() => handleSelectSkill(skill.id)}
                          />
                        );
                      })
                    ) : (
                      <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                        {t('agentSettingsDialog.skillScope.empty')}
                      </div>
                    )}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            <p className="text-xs text-muted-foreground">
              {selectedSkills.length >= maxSelectable
                ? t('agentSettingsDialog.skillScope.maxReached')
                : ''}
            </p>
          </div>
        )}

        <Button
          type="button"
          onClick={() => void handleSaveSkills()}
          disabled={!agent || savingSkills || (skillScopeMode === 'specified' && selectedSkills.length === 0)}
          className="modal-primary-button"
        >
          {savingSkills ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('agentSettingsDialog.skillScope.save')}
        </Button>
      </div>
    </section>
  );
}
