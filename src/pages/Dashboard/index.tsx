import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardSettingsSection } from '@/components/settings/DashboardSettingsSection';
import { InspirationPlazaSection, PresetAgentsPlazaSection } from '@/components/dashboard';
import { cn } from '@/lib/utils';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiIdeaIcon, UserAiIcon } from '@hugeicons/core-free-icons';

export function Dashboard() {
  const { t } = useTranslation(['dashboard', 'common']);
  const [activeTab, setActiveTab] = useState<'agents' | 'inspiration'>('agents');

  return (
    <div data-testid="dashboard-page" className="flex flex-col dark:bg-background">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full px-10 pt-8">
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          <section className="my-6">
            <DashboardSettingsSection className="max-w-6xl" />
          </section>

          <section className="space-y-5">
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div
                role="tablist"
                aria-label={t('common:sidebar.dashboard')}
                className="inline-flex w-fit min-w-max items-center gap-0.5 rounded-full border border-border/60 bg-muted/40 p-1"
              >
                {([
                  { key: 'agents', label: t('plaza.tabs.agents'), icon: <HugeiconsIcon icon={UserAiIcon} className="w-4.5 h-4.5" /> },
                  { key: 'inspiration', label: t('plaza.tabs.inspiration'),  icon: <HugeiconsIcon icon={AiIdeaIcon} className="w-4.5 h-4.5" /> },
                ] as const).map((tab) => {
                  const active = activeTab === tab.key;

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(tab.key)}
                      className={cn(
                        'flex gap-1 items-center cursor-pointer rounded-full px-6 py-2 text-[16px] font-medium tracking-[-0.01em] transition-all',
                        active
                          ? 'bg-foreground text-background shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTab === 'agents' ? <PresetAgentsPlazaSection /> : <InspirationPlazaSection />}
          </section>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
