import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc, toUserMessage } from '@/lib/api-client';
import { getSettingsModalPath } from '@/lib/settings-modal';

interface McporterBinaryStatus {
  exists: boolean;
  path: string | null;
  version: string | null;
  error?: string;
}

interface McporterStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  installGuideUrl: string;
  repositoryUrl: string;
  system: McporterBinaryStatus;
}

interface McpStatusResponse {
  mcporter: McporterStatus;
}

function StatusBadge({
  status,
  trueLabel,
  falseLabel,
  unknownLabel,
}: {
  status: boolean | null;
  trueLabel: string;
  falseLabel: string;
  unknownLabel: string;
}) {
  if (status === true) {
    return (
      <Badge className="gap-1 rounded-full border-0 bg-emerald-500/12 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {trueLabel}
      </Badge>
    );
  }

  if (status === false) {
    return (
      <Badge className="gap-1 rounded-full border-0 bg-rose-500/12 px-2.5 py-1 text-rose-700 dark:text-rose-300">
        <XCircle className="h-3.5 w-3.5" />
        {falseLabel}
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 rounded-full border-0 bg-black/6 px-2.5 py-1 text-foreground/70 dark:bg-white/10 dark:text-foreground/75">
      <Activity className="h-3.5 w-3.5" />
      {unknownLabel}
    </Badge>
  );
}

function ValueCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-black/8 bg-background/55 px-4 py-3 dark:border-white/10 dark:bg-black/10">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-2 break-all text-sm text-foreground ${mono ? 'font-mono' : 'font-medium'}`}>
        {value}
      </p>
    </div>
  );
}

export function McpSettingsSection() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const [status, setStatus] = useState<McporterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await hostApiFetch<McpStatusResponse>('/api/mcp/status');
      setStatus(response.mcporter);
    } catch (error) {
      toast.error(`${t('mcp.loadFailed')}: ${toUserMessage(error)}`);
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const systemInstalled = loading ? null : (status?.system?.exists ?? false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="modal-title">{t('mcp.title')}</h2>
          <p className="modal-description">{t('mcp.description')}</p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => void loadStatus(true)}
          disabled={loading || refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('mcp.refresh')}
        </Button>
      </div>

      <section className="modal-section-surface rounded-3xl border p-5">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('mcp.health.title')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('mcp.health.description')}</p>
          </div>

          <div className="grid gap-4">
            <div className="modal-field-surface rounded-2xl border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-base font-semibold text-foreground">{t('mcp.system.title')}</h4>
                <StatusBadge
                  status={systemInstalled}
                  trueLabel={t('mcp.system.present')}
                  falseLabel={t('mcp.system.missing')}
                  unknownLabel={t('opencli.status.checking')}
                />
              </div>

              <div className="mt-4 grid gap-3">
                <ValueCard
                  label={t('mcp.system.version')}
                  value={loading ? t('common:status.loading') : (status?.system.version || t('mcp.system.unknown'))}
                />
                <ValueCard
                  label={t('mcp.system.path')}
                  value={loading ? t('common:status.loading') : (status?.system.path || t('mcp.system.emptyPath'))}
                  mono
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {true && (
        <section className="modal-section-surface rounded-3xl border p-5">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">{t('mcp.install.title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('mcp.install.description')}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="rounded-full"
                onClick={() => navigate(getSettingsModalPath('cliMarketplace'))}
              >
                {t('mcp.install.marketplace')}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => invokeIpc('shell:openExternal', status?.installGuideUrl || 'https://github.com/steipete/mcporter#installation')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('mcp.install.guide')}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => invokeIpc('shell:openExternal', status?.repositoryUrl || 'https://github.com/steipete/mcporter')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('mcp.install.repo')}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default McpSettingsSection;
