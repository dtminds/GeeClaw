// import { useTranslation } from 'react-i18next';
import { DashboardSettingsSection } from '@/components/settings/DashboardSettingsSection';
import { InspirationPlazaSection } from '@/components/dashboard';

export function Dashboard() {
  // const { t } = useTranslation(['dashboard', 'common']);

  return (
    <div className="flex flex-col dark:bg-background">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full px-10 pt-8">
        {/* <div className="mb-6 shrink-0">
          <h1 className="text-3xl text-foreground mb-1 font-bold tracking-tight">
            {t('common:sidebar.dashboard')}
          </h1>
          <p className="text-sm text-foreground/80 font-normal">
            {t('pageSubtitle')}
          </p>
        </div> */}

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          <DashboardSettingsSection className="max-w-6xl my-6" />
          <InspirationPlazaSection />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
