import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { toUserMessage } from '@/lib/api-client';

type CliMarketplaceActionLabel = 'install' | 'reinstall';

interface CliMarketplaceItem {
  id: string;
  title: string;
  description: string;
  homepage?: string;
  installed: boolean;
  actionLabel: CliMarketplaceActionLabel;
}

function InstallStatusBadge({
  installed,
  installedLabel,
  missingLabel,
}: {
  installed: boolean;
  installedLabel: string;
  missingLabel: string;
}) {
  if (installed) {
    return (
      <Badge className="gap-1 rounded-full border-0 bg-emerald-500/12 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {installedLabel}
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 rounded-full border-0 bg-rose-500/12 px-2.5 py-1 text-rose-700 dark:text-rose-300">
      <XCircle className="h-3.5 w-3.5" />
      {missingLabel}
    </Badge>
  );
}

export function CliMarketplaceSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const [items, setItems] = useState<CliMarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const loadCatalog = async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await hostApiFetch<CliMarketplaceItem[]>('/api/cli-marketplace/catalog');
      setItems(response);
    } catch (error) {
      toast.error(`${t('cliMarketplace.loadFailed')}: ${toUserMessage(error)}`);
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  const handleInstall = async (item: CliMarketplaceItem) => {
    setInstallingId(item.id);
    try {
      await hostApiFetch('/api/cli-marketplace/install', {
        method: 'POST',
        body: JSON.stringify({ id: item.id }),
      });
      await loadCatalog(true);
    } catch (error) {
      toast.error(`${t('cliMarketplace.installFailed')}: ${toUserMessage(error)}`);
    } finally {
      setInstallingId(null);
    }
  };

  const getActionLabel = (actionLabel: CliMarketplaceActionLabel): string => (
    actionLabel === 'reinstall'
      ? t('cliMarketplace.reinstall')
      : t('cliMarketplace.install')
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="modal-title">{t('cliMarketplace.title')}</h2>
          <p className="modal-description">{t('cliMarketplace.description')}</p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => void loadCatalog(true)}
          disabled={loading || refreshing || installingId !== null}
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('cliMarketplace.refresh')}
        </Button>
      </div>

      <section className="modal-section-surface">
        {loading ? (
          <div className="py-8 text-sm text-muted-foreground">{t('common:status.loading')}</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground">{t('cliMarketplace.empty')}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => {
              const pending = installingId === item.id;
              return (
                <div key={item.id} className="modal-field-surface rounded-2xl border p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                        <InstallStatusBadge
                          installed={item.installed}
                          installedLabel={t('cliMarketplace.installed')}
                          missingLabel={t('cliMarketplace.missing')}
                        />
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {item.description || item.homepage || item.id}
                      </p>
                    </div>

                    <Button
                      type="button"
                      className="rounded-full"
                      onClick={() => void handleInstall(item)}
                      disabled={pending || installingId !== null}
                    >
                      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {getActionLabel(item.actionLabel)}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default CliMarketplaceSettingsSection;
