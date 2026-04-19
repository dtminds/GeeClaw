import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Lock, Package2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { fetchAgentScopedSkills } from '@/pages/Chat/slash-picker';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';

interface AgentSkillsPanelProps {
  agentId: string;
  title: string;
  description?: string;
}

export function AgentSkillsPanel({ agentId, title, description }: AgentSkillsPanelProps) {
  const { t } = useTranslation(['chat', 'skills']);
  const agent = useAgentsStore((state) => state.agents.find((entry) => entry.id === agentId));
  const gatewayState = useGatewayStore((state) => state.status.state);
  const gatewayRpc = useGatewayStore((state) => state.rpc);
  const [runtimeEnabledSkills, setRuntimeEnabledSkills] = useState<string[] | null>(null);

  const manualSkills = agent?.manualSkills
    ?? (agent?.skillScope.mode === 'specified' ? agent.skillScope.skills : []);
  const presetSkills = agent?.presetSkills ?? [];

  useEffect(() => {
    let cancelled = false;

    if (gatewayState !== 'running') {
      setRuntimeEnabledSkills(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchAgentScopedSkills(agentId, gatewayRpc)
      .then((skills) => {
        if (cancelled) {
          return;
        }
        const enabled = skills
          .filter((skill) => skill.enabled)
          .map((skill) => skill.id)
          .sort((left, right) => left.localeCompare(right));
        setRuntimeEnabledSkills(enabled);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error('Failed to load agent-scoped skills for settings panel:', error);
        setRuntimeEnabledSkills(null);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, gatewayRpc, gatewayState]);

  const fallbackEnabledSkills = useMemo(() => {
    const result = new Set<string>();
    for (const skillId of manualSkills) {
      result.add(skillId);
    }
    for (const skillId of presetSkills) {
      result.add(skillId);
    }
    return [...result].sort((left, right) => left.localeCompare(right));
  }, [manualSkills, presetSkills]);

  const enabledSkills = useMemo(() => {
    if (!runtimeEnabledSkills) {
      return fallbackEnabledSkills;
    }

    return [...new Set([
      ...runtimeEnabledSkills,
      ...presetSkills,
    ])].sort((left, right) => left.localeCompare(right));
  }, [fallbackEnabledSkills, presetSkills, runtimeEnabledSkills]);

  const showWarning = enabledSkills.length > 20;

  return (
    <section className="flex h-full min-h-0 flex-col px-1">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <div className="rounded-2xl border border-black/8 p-4 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {t('agentSettingsDialog.skillsSummary.count', {
                  count: enabledSkills.length,
                  defaultValue: `${enabledSkills.length} enabled skills`,
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('agentSettingsDialog.skillsSummary.description', {
                  defaultValue: 'Manage this agent’s skills from the Installed Skills page.',
                })}
              </p>
            </div>

            <Button asChild type="button" variant="outline" className="h-9 rounded-full px-4 text-[13px]">
              <a href={`#/skills?agentId=${encodeURIComponent(agentId)}`}>
                {t('agentSettingsDialog.skillsSummary.manage', { defaultValue: 'Manage in Skills' })}
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        {showWarning ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="text-sm leading-6 text-amber-800 dark:text-amber-100">
                {t('agentSettingsDialog.skillsSummary.warning', {
                  defaultValue: 'Loading more than 20 skills can significantly degrade model focus and output quality.',
                })}
              </p>
            </div>
          </div>
        ) : null}

        {presetSkills.length > 0 ? (
          <div className="rounded-2xl border border-black/8 p-4 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {t('agentSettingsDialog.skillsSummary.lockedTitle', {
                  count: presetSkills.length,
                  defaultValue: `${presetSkills.length} preset-locked skills`,
                })}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {presetSkills.map((skillId) => (
                <span
                  key={skillId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary"
                >
                  <Lock className="h-3 w-3" />
                  {skillId}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-black/8 p-4 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Package2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {t('agentSettingsDialog.skillsSummary.enabledTitle', {
                defaultValue: 'Current enabled skills',
              })}
            </p>
          </div>
          {enabledSkills.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {enabledSkills.map((skillId) => {
                const locked = presetSkills.includes(skillId);
                return (
                  <span
                    key={skillId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-[12px] font-medium text-foreground/80 dark:bg-white/[0.08]"
                  >
                    {locked ? <Lock className="h-3 w-3" /> : null}
                    {skillId}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('agentSettingsDialog.skillsSummary.empty', {
                defaultValue: 'No skills have been explicitly enabled for this agent yet.',
              })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
