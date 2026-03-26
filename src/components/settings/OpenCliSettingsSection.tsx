import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc, toUserMessage } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface OpenCliDoctorStatus {
  ok: boolean;
  daemonRunning: boolean | null;
  extensionConnected: boolean | null;
  connectivityOk: boolean | null;
  issues: string[];
  output: string;
  error?: string;
  durationMs: number;
}

interface OpenCliStatus {
  binaryExists: boolean;
  binaryPath: string | null;
  wrapperPath: string | null;
  entryPath: string | null;
  runtimeDir: string | null;
  extensionDir: string | null;
  extensionDirExists: boolean;
  version: string | null;
  command: string | null;
  releasesUrl: string;
  readmeUrl: string;
  doctor: OpenCliDoctorStatus | null;
}

interface OpenCliCatalogCommand {
  command: string;
  name: string;
  description: string;
}

interface OpenCliCatalogSite {
  site: string;
  commands: OpenCliCatalogCommand[];
}

interface OpenCliCatalog {
  totalSites: number;
  totalCommands: number;
  sites: OpenCliCatalogSite[];
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

function MetricCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="modal-field-surface rounded-2xl border p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function OpenCliSettingsSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<OpenCliStatus | null>(null);
  const [catalog, setCatalog] = useState<OpenCliCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await hostApiFetch<OpenCliStatus>('/api/opencli/status');
      setStatus(response);
    } catch (error) {
      toast.error(`${t('opencli.loadFailed')}: ${toUserMessage(error)}`);
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [t]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const response = await hostApiFetch<OpenCliCatalog>('/api/opencli/catalog');
      setCatalog(response);
    } catch (error) {
      setCatalogError(`${t('opencli.catalog.loadFailed')}: ${toUserMessage(error)}`);
    } finally {
      setCatalogLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const normalizedCatalogSearch = catalogSearch.trim().toLowerCase();
  const filteredSites = catalog?.sites.filter((site) => (
    !normalizedCatalogSearch || site.site.toLowerCase().includes(normalizedCatalogSearch)
  )) ?? [];
  const filteredCommandCount = filteredSites.reduce((count, site) => count + site.commands.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="modal-title">{t('opencli.title')}</h2>
          <p className="modal-description">{t('opencli.description')}</p>
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
          {t('opencli.refresh')}
        </Button>
      </div>

      <section className="modal-section-surface rounded-3xl border p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">{t('opencli.runtime.title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('opencli.runtime.description')}</p>
            </div>
            <StatusBadge
              status={loading ? null : status?.binaryExists ?? false}
              trueLabel={t('opencli.runtime.present')}
              falseLabel={t('opencli.runtime.missing')}
              unknownLabel={t('opencli.status.checking')}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <MetricCard label={t('opencli.runtime.version')}>
              <p className="text-sm font-medium text-foreground">
                {loading ? t('common:status.loading') : (status?.version || t('opencli.runtime.unknown'))}
              </p>
            </MetricCard>

            <MetricCard label={t('opencli.doctor.daemon')}>
              <StatusBadge
                status={loading ? null : (status?.doctor?.daemonRunning ?? null)}
                trueLabel={t('opencli.status.connected')}
                falseLabel={t('opencli.status.missing')}
                unknownLabel={loading ? t('opencli.status.checking') : t('opencli.status.unknown')}
              />
            </MetricCard>

            <MetricCard label={t('opencli.doctor.extension')}>
              <StatusBadge
                status={loading ? null : (status?.doctor?.extensionConnected ?? null)}
                trueLabel={t('opencli.status.connected')}
                falseLabel={t('opencli.status.notConnected')}
                unknownLabel={loading ? t('opencli.status.checking') : t('opencli.status.unknown')}
              />
            </MetricCard>
          </div>

          {status?.doctor?.error && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {status.doctor.error}
            </div>
          )}

          {status?.doctor?.issues && status.doctor.issues.length > 0 && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-4">
              <p className="text-sm font-semibold text-foreground">{t('opencli.doctor.issuesTitle')}</p>
              <div className="mt-3 space-y-3">
                {status.doctor.issues.map((issue) => (
                  <div key={issue} className="text-sm leading-6 text-muted-foreground whitespace-pre-line">
                    {issue}
                  </div>
                ))}
              </div>
            </div>
          )}

          {status?.doctor?.output && (
            <details className="rounded-2xl border border-black/8 bg-background/55 px-4 py-3 dark:border-white/10 dark:bg-black/10">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                {t('opencli.doctor.rawOutput')}
              </summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                {status.doctor.output}
              </pre>
            </details>
          )}
        </div>
      </section>

      <section className="modal-section-surface rounded-3xl border p-5">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">{t('opencli.extension.title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('opencli.extension.description')}</p>
            </div>
            <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => invokeIpc('shell:openExternal', status?.releasesUrl || 'https://github.com/jackwener/opencli/releases')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('opencli.actions.downloadExtension')}
              </Button>
            </div>

            <div className="rounded-2xl border border-dashed border-black/12 bg-background/45 px-4 py-4 text-sm leading-7 text-muted-foreground dark:border-white/12 dark:bg-black/10">
              <p>{t('opencli.extension.step1')}</p>
              <p>{t('opencli.extension.step2')}</p>
              <p>{t('opencli.extension.step3')}</p>
              <p>{t('opencli.extension.step4')}</p>
            </div>
          </div>
        </details>
      </section>

      <section className="modal-section-surface overflow-hidden rounded-3xl border">
        <div className="flex flex-col gap-4 border-b border-black/8 px-5 py-5 dark:border-white/10">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('opencli.catalog.title')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('opencli.catalog.description')}</p>
          </div>

          {catalog && catalog.sites.length > 0 && (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                  placeholder={t('opencli.catalog.searchPlaceholder')}
                  aria-label={t('opencli.catalog.searchAriaLabel')}
                  className="h-10 rounded-full border-black/10 bg-background pl-9 pr-3 dark:border-white/10"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full border-0 bg-black/6 px-2.5 py-1 text-foreground/75 dark:bg-white/10 dark:text-foreground/80">
                  {t('opencli.catalog.summarySites', { count: filteredSites.length })}
                </Badge>
                <Badge className="rounded-full border-0 bg-black/6 px-2.5 py-1 text-foreground/75 dark:bg-white/10 dark:text-foreground/80">
                  {t('opencli.catalog.summaryCommands', { count: filteredCommandCount })}
                </Badge>
              </div>
            </div>
          )}

          {catalogSearch && catalog && catalog.sites.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {t('opencli.catalog.searchResults', { query: catalogSearch.trim() })}
            </div>
          )}
        </div>

        {catalogLoading ? (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('opencli.catalog.loading')}
          </div>
        ) : catalogError ? (
          <div className="px-5 py-5">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {catalogError}
            </div>
          </div>
        ) : catalog && filteredSites.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-black/8 dark:border-white/10">
                  <th className="w-52 px-5 py-3 text-left text-sm font-semibold text-foreground">
                    {t('opencli.catalog.site')}
                  </th>
                  <th className="px-5 py-3 text-left text-sm font-semibold text-foreground">
                    {t('opencli.catalog.commands')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSites.map((site) => (
                  <tr
                    key={site.site}
                    className="align-top border-b border-black/8 last:border-b-0 dark:border-white/10"
                  >
                    <td className="w-52 px-5 py-4 align-top">
                      <div className="space-y-1">
                        <p className="text-base font-semibold text-foreground">{site.site}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('opencli.catalog.commandCount', { count: site.commands.length })}
                        </p>
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="divide-y divide-black/6 dark:divide-white/8">
                        {site.commands.map((command) => (
                          <div
                            key={command.command}
                            className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0"
                            title={command.description ? `${command.command} - ${command.description}` : command.command}
                          >
                            <span className="shrink-0 font-mono text-[13px] font-bold text-foreground">
                              {command.name}
                            </span>
                            <span className="shrink-0 text-muted-foreground/40">-</span>
                            <span className="min-w-0 truncate text-sm text-muted-foreground">
                              {command.description || t('opencli.catalog.noDescription')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : catalogSearch && catalog && catalog.sites.length > 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            {t('opencli.catalog.emptySearch')}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            {t('opencli.catalog.empty')}
          </div>
        )}
      </section>
    </div>
  );
}

export default OpenCliSettingsSection;
