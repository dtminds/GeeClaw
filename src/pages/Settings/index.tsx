/**
 * Settings Page
 * Application configuration
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  Palette,
  FolderOpen,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Terminal,
  ArrowLeft,
  ExternalLink,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CpuSettingsIcon,
  ReloadIcon,
  ShutDownIcon,
  File02Icon,
  AiSecurity02Icon,
  CheckmarkCircle02Icon,
  ChatLockIcon,
  FireIcon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useSettingsStore, type SecurityPolicy } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { useUpdateStore } from '@/stores/update';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import {
  getGatewayWsDiagnosticEnabled,
  invokeIpc,
  setGatewayWsDiagnosticEnabled,
  toUserMessage,
} from '@/lib/api-client';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  trackUiEvent,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModelsSettingsSection } from '@/components/settings/ModelsSettingsSection';
import {
  getSettingsModalPath,
  getSettingsModalState,
  isSettingsModalPath,
  resolveSettingsSection,
  type SettingsModalSection,
} from '@/lib/settings-modal';
import { COLOR_THEME_REGISTRY } from '@/theme/color-themes';
type ControlUiInfo = {
  url: string;
  token: string;
  port: number;
};

type OpenClawRuntimeInfo = {
  source: 'bundled';
  packageExists: boolean;
  dir: string;
  commandPath: string | null;
  version?: string;
  error?: string;
  displayName: string;
};

type SafetySettingsInfo = {
  configDir: string;
  workspaceOnly: boolean;
  securityPolicy: SecurityPolicy;
};

interface SettingsProps {
  embedded?: boolean;
}

function AppSettingsPanel({
  section = 'general',
  onOpenSessions,
}: {
  section?: 'gateway' | 'general';
  onOpenSessions?: () => void;
}) {
  const { t } = useTranslation('settings');
  const {
    gatewayAutoStart,
    setGatewayAutoStart,
    proxyEnabled,
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    setProxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    autoCheckUpdate,
    setAutoCheckUpdate,
    autoDownloadUpdate,
    setAutoDownloadUpdate,
    devModeUnlocked,
    setDevModeUnlocked,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway, stop: stopGateway } = useGatewayStore();
  const currentVersion = useUpdateStore((state) => state.currentVersion);
  const updateSetAutoDownload = useUpdateStore((state) => state.setAutoDownload);
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<OpenClawRuntimeInfo | null>(null);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
  const [showAdvancedProxy, setShowAdvancedProxy] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [wsDiagnosticEnabled, setWsDiagnosticEnabled] = useState(false);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);

  const isWindows = window.electron.platform === 'win32';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');

  const handleShowLogs = async () => {
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) {
        await invokeIpc('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };

  // Open developer console
  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        token?: string;
        port?: number;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
        trackUiEvent('settings.open_dev_console');
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const refreshControlUiInfo = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        token?: string;
        port?: number;
      }>('/api/gateway/control-ui');
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
      }
    } catch {
      // Ignore refresh errors
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.token) return;
    try {
      await navigator.clipboard.writeText(controlUiInfo.token);
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (!showCliTools) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await invokeIpc<{
          success: boolean;
          command?: string;
          error?: string;
        }>('openclaw:getCliCommand');
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || 'OpenClaw CLI unavailable');
        }
      } catch (error) {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      }
    })();

    return () => { cancelled = true; };
  }, [devModeUnlocked, showCliTools]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const status = await invokeIpc<OpenClawRuntimeInfo>('openclaw:status');
        if (!cancelled) {
          setRuntimeInfo(status);
        }
      } catch {
        if (!cancelled) {
          setRuntimeInfo(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [gatewayStatus.state]);

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(`Failed to copy command: ${String(error)}`);
    }
  };

  useEffect(() => {
    setWsDiagnosticEnabled(getGatewayWsDiagnosticEnabled());
  }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    const unsubscribe = subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    });
    return unsubscribe;
  }, [devModeUnlocked]);

  useEffect(() => {
    setProxyEnabledDraft(proxyEnabled);
  }, [proxyEnabled]);

  useEffect(() => {
    setProxyServerDraft(proxyServer);
  }, [proxyServer]);

  useEffect(() => {
    setProxyHttpServerDraft(proxyHttpServer);
  }, [proxyHttpServer]);

  useEffect(() => {
    setProxyHttpsServerDraft(proxyHttpsServer);
  }, [proxyHttpsServer]);

  useEffect(() => {
    setProxyAllServerDraft(proxyAllServer);
  }, [proxyAllServer]);

  useEffect(() => {
    setProxyBypassRulesDraft(proxyBypassRules);
  }, [proxyBypassRules]);

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();
      await invokeIpc('settings:setMany', {
        proxyEnabled: proxyEnabledDraft,
        proxyServer: normalizedProxyServer,
        proxyHttpServer: normalizedHttpServer,
        proxyHttpsServer: normalizedHttpsServer,
        proxyAllServer: normalizedAllServer,
        proxyBypassRules: normalizedBypassRules,
      });

      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxyEnabled(proxyEnabledDraft);

      toast.success(t('gateway.proxySaved'));
      trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
    } catch (error) {
      toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingProxy(false);
    }
  };

  const telemetryStats = useMemo(() => {
    let errorCount = 0;
    let slowCount = 0;
    for (const entry of telemetryEntries) {
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        errorCount += 1;
      }
      const durationMs = typeof entry.payload.durationMs === 'number'
        ? entry.payload.durationMs
        : Number.NaN;
      if (Number.isFinite(durationMs) && durationMs >= 800) {
        slowCount += 1;
      }
    }
    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<string, {
      event: string;
      count: number;
      errorCount: number;
      slowCount: number;
      totalDuration: number;
      timedCount: number;
      lastTs: string;
    }>();

    for (const entry of telemetryEntries) {
      const current = map.get(entry.event) ?? {
        event: entry.event,
        count: 0,
        errorCount: 0,
        slowCount: 0,
        totalDuration: 0,
        timedCount: 0,
        lastTs: entry.ts,
      };

      current.count += 1;
      current.lastTs = entry.ts;

      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        current.errorCount += 1;
      }

      const durationMs = typeof entry.payload.durationMs === 'number'
        ? entry.payload.durationMs
        : Number.NaN;
      if (Number.isFinite(durationMs)) {
        current.totalDuration += durationMs;
        current.timedCount += 1;
        if (durationMs >= 800) {
          current.slowCount += 1;
        }
      }

      map.set(entry.event, current);
    }

    return [...map.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [telemetryEntries]);

  const handleCopyTelemetry = async () => {
    try {
      const serialized = telemetryEntries.map((entry) => JSON.stringify(entry)).join('\n');
      await navigator.clipboard.writeText(serialized);
      toast.success(t('developer.telemetryCopied'));
    } catch (error) {
      toast.error(`${t('common:status.error')}: ${String(error)}`);
    }
  };

  const handleClearTelemetry = () => {
    clearUiTelemetry();
    setTelemetryEntries([]);
    toast.success(t('developer.telemetryCleared'));
  };

  const handleWsDiagnosticToggle = (enabled: boolean) => {
    setGatewayWsDiagnosticEnabled(enabled);
    setWsDiagnosticEnabled(enabled);
    toast.success(
      enabled
        ? t('developer.wsDiagnosticEnabled')
        : t('developer.wsDiagnosticDisabled'),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {section === 'gateway' && (
        <>
          <Card className="order-1">
            <CardHeader>
              <CardTitle>{t('gateway.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Badge
                    variant={
                      gatewayStatus.state === 'running'
                        ? 'success'
                        : gatewayStatus.state === 'error'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {gatewayStatus.state}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={stopGateway}>
                    <HugeiconsIcon icon={ShutDownIcon} className="h-4 w-4 mr-2" />
                    {t('common:actions.stop')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={restartGateway}>
                    <HugeiconsIcon icon={ReloadIcon} className="h-4 w-4 mr-2" />
                    {t('common:actions.restart')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleShowLogs}>
                    <HugeiconsIcon icon={File02Icon} className="h-4 w-4 mr-2" />
                    {t('gateway.logs')}
                  </Button>
                </div>
              </div>

              {showLogs && (
                <div className="mt-4 rounded-lg border border-border bg-black/10 p-4 dark:bg-black/40">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">{t('gateway.appLogs')}</p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleOpenLogDir}>
                        <ExternalLink className="h-3 w-3 mr-1" />
                        {t('gateway.openFolder')}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLogs(false)}>
                        {t('common:actions.close')}
                      </Button>
                    </div>
                  </div>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-3 font-mono text-xs text-muted-foreground">
                    {logContent || t('chat:noLogs')}
                  </pre>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <div>
                  <Label>{t('gateway.runtimeSource.label')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('gateway.runtimeSource.desc')}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground/50">
                  {runtimeInfo?.packageExists
                    ? t('gateway.runtimeSource.detected', {
                      runtime: runtimeInfo.displayName,
                      path: runtimeInfo.commandPath || runtimeInfo.dir,
                      version: runtimeInfo.version || 'unknown',
                    })
                    : (runtimeInfo?.error || t('gateway.runtimeSource.notDetected'))}
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('gateway.autoStart')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('gateway.autoStartDesc')}
                  </p>
                </div>
                <Switch
                  checked={gatewayAutoStart}
                  onCheckedChange={setGatewayAutoStart}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>{t('gateway.sessions.title')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('gateway.sessions.description')}
                  </p>
                </div>
                {onOpenSessions && (
                  <Button type="button" variant="outline" onClick={onOpenSessions}>
                    {t('gateway.sessions.openAll')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="order-2">
            <CardHeader>
              <CardTitle>{t('advanced.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('advanced.devMode')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('advanced.devModeDesc')}
                  </p>
                </div>
                <Switch
                  checked={devModeUnlocked}
                  onCheckedChange={setDevModeUnlocked}
                />
              </div>

              {devModeUnlocked && (
                <>
                  <Separator />
                  <div className="rounded-md border border-border/60 p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => setShowAdvancedProxy((prev) => !prev)}
                    >
                      {showAdvancedProxy ? (
                        <ChevronDown className="h-4 w-4 mr-2" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mr-2" />
                      )}
                      {showAdvancedProxy ? t('gateway.hideAdvancedProxy') : t('gateway.showAdvancedProxy')}
                    </Button>
                    {showAdvancedProxy && (
                      <div className="mt-3 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>{t('gateway.proxyTitle')}</Label>
                            <p className="text-sm text-muted-foreground">
                              {t('gateway.proxyDesc')}
                            </p>
                          </div>
                          <Switch
                            checked={proxyEnabledDraft}
                            onCheckedChange={setProxyEnabledDraft}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-server">{t('gateway.proxyServer')}</Label>
                          <Input
                            id="proxy-server"
                            value={proxyServerDraft}
                            onChange={(event) => setProxyServerDraft(event.target.value)}
                            placeholder="http://127.0.0.1:7890"
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('gateway.proxyServerHelp')}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-http-server">{t('gateway.proxyHttpServer')}</Label>
                          <Input
                            id="proxy-http-server"
                            value={proxyHttpServerDraft}
                            onChange={(event) => setProxyHttpServerDraft(event.target.value)}
                            placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('gateway.proxyHttpServerHelp')}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-https-server">{t('gateway.proxyHttpsServer')}</Label>
                          <Input
                            id="proxy-https-server"
                            value={proxyHttpsServerDraft}
                            onChange={(event) => setProxyHttpsServerDraft(event.target.value)}
                            placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('gateway.proxyHttpsServerHelp')}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-all-server">{t('gateway.proxyAllServer')}</Label>
                          <Input
                            id="proxy-all-server"
                            value={proxyAllServerDraft}
                            onChange={(event) => setProxyAllServerDraft(event.target.value)}
                            placeholder={proxyServerDraft || 'socks5://127.0.0.1:7891'}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('gateway.proxyAllServerHelp')}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-bypass">{t('gateway.proxyBypass')}</Label>
                          <Input
                            id="proxy-bypass"
                            value={proxyBypassRulesDraft}
                            onChange={(event) => setProxyBypassRulesDraft(event.target.value)}
                            placeholder="<local>;localhost;127.0.0.1;::1"
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('gateway.proxyBypassHelp')}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                          <p className="text-sm text-muted-foreground">
                            {t('gateway.proxyRestartNote')}
                          </p>
                          <Button
                            variant="outline"
                            onClick={handleSaveProxySettings}
                            disabled={savingProxy}
                          >
                            <RefreshCw className={`h-4 w-4 mr-2${savingProxy ? ' animate-spin' : ''}`} />
                            {savingProxy ? t('common:status.saving') : t('common:actions.save')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {devModeUnlocked && (
            <Card className="order-3">
              <CardHeader>
                <CardTitle>{t('developer.title')}</CardTitle>
                <CardDescription>{t('developer.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('developer.console')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('developer.consoleDesc')}
                  </p>
                  <Button variant="outline" onClick={openDevConsole}>
                    <Terminal className="h-4 w-4 mr-2" />
                    {t('developer.openConsole')}
                    <ExternalLink className="h-3 w-3 ml-2" />
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t('developer.consoleNote')}
                  </p>
                  <div className="space-y-2 pt-2">
                    <Label>{t('developer.gatewayToken')}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t('developer.gatewayTokenDesc')}
                    </p>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={controlUiInfo?.token || ''}
                        placeholder={t('developer.tokenUnavailable')}
                        className="font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refreshControlUiInfo}
                        disabled={!devModeUnlocked}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t('common:actions.load')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCopyGatewayToken}
                        disabled={!controlUiInfo?.token}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>
                </div>
                {showCliTools && (
                  <>
                    <div className="space-y-2">
                      <Label>{t('developer.cli')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('developer.cliDesc')}
                      </p>
                      {isWindows && (
                        <p className="text-xs text-muted-foreground">
                          {t('developer.cliPowershell')}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={openclawCliCommand}
                          placeholder={openclawCliError || t('developer.cmdUnavailable')}
                          className="font-mono"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyCliCommand}
                          disabled={!openclawCliCommand}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                    <div>
                      <Label>{t('developer.wsDiagnostic')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('developer.wsDiagnosticDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={wsDiagnosticEnabled}
                      onCheckedChange={handleWsDiagnosticToggle}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>{t('developer.telemetryViewer')}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t('developer.telemetryViewerDesc')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowTelemetryViewer((prev) => !prev)}
                    >
                      {showTelemetryViewer
                        ? t('common:actions.hide')
                        : t('common:actions.show')}
                    </Button>
                  </div>

                  {showTelemetryViewer && (
                    <div className="space-y-3 rounded-lg border border-border/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{t('developer.telemetryTotal')}: {telemetryStats.total}</Badge>
                        <Badge variant={telemetryStats.errorCount > 0 ? 'destructive' : 'secondary'}>
                          {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                        </Badge>
                        <Badge variant={telemetryStats.slowCount > 0 ? 'secondary' : 'outline'}>
                          {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                        </Badge>
                        <div className="ml-auto flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={handleCopyTelemetry}>
                            <Copy className="h-4 w-4 mr-2" />
                            {t('common:actions.copy')}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={handleClearTelemetry}>
                            {t('common:actions.clear')}
                          </Button>
                        </div>
                      </div>

                      <div className="max-h-72 overflow-auto rounded-md border border-border/50 bg-muted/20">
                        {telemetryByEvent.length > 0 && (
                          <div className="border-b border-border/50 bg-background/70 p-2">
                            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                              {t('developer.telemetryAggregated')}
                            </p>
                            <div className="space-y-1 text-[11px]">
                              {telemetryByEvent.map((item) => (
                                <div
                                  key={item.event}
                                  className="grid grid-cols-[minmax(0,1.6fr)_0.7fr_0.9fr_0.8fr_1fr] gap-2 rounded border border-border/40 px-2 py-1"
                                >
                                  <span className="truncate font-medium" title={item.event}>{item.event}</span>
                                  <span className="text-muted-foreground">n={item.count}</span>
                                  <span className="text-muted-foreground">
                                    avg={item.timedCount > 0 ? Math.round(item.totalDuration / item.timedCount) : 0}ms
                                  </span>
                                  <span className="text-muted-foreground">slow={item.slowCount}</span>
                                  <span className="text-muted-foreground">err={item.errorCount}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="space-y-1 p-2 font-mono text-xs">
                          {telemetryEntries.length === 0 ? (
                            <div className="text-muted-foreground">{t('developer.telemetryEmpty')}</div>
                          ) : (
                            telemetryEntries
                              .slice()
                              .reverse()
                              .map((entry) => (
                                <div key={entry.id} className="rounded border border-border/40 bg-background/60 p-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold">{entry.event}</span>
                                    <span className="text-muted-foreground">{entry.ts}</span>
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                                    {JSON.stringify({ count: entry.count, ...entry.payload }, null, 2)}
                                  </pre>
                                </div>
                              ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}

      {section === 'general' && (
        <>
          <Card className="order-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                {t('updates.title')}
              </CardTitle>
              <CardDescription>{t('updates.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <UpdateSettings />

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('updates.autoCheck')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('updates.autoCheckDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoCheckUpdate}
                  onCheckedChange={setAutoCheckUpdate}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('updates.autoDownload')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('updates.autoDownloadDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoDownloadUpdate}
                  onCheckedChange={(value) => {
                    setAutoDownloadUpdate(value);
                    updateSetAutoDownload(value);
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="order-2">
            <CardHeader>
              <CardTitle>{t('about.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>{t('about.appName')}</strong> - {t('about.tagline')}（{t('about.version', { version: currentVersion })}）
              </p>
              <p className="text-xs">{t('about.basedOn')}</p>
              <div className="flex gap-4 pt-2">
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => window.electron.openExternal('https://www.iyouke.com')}
                >
                  {t('about.docs')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function AppearanceSettingsPanel() {
  const { t } = useTranslation('settings');
  const {
    theme,
    setTheme,
    colorTheme,
    setColorTheme,
    language,
    setLanguage,
  } = useSettingsStore();

  // Determine effective mode for swatch display
  const effectiveTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  return (
    <div className="flex flex-col gap-6">
      {/* Appearance Mode */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">{t('appearance.mode')}</h3>
        <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1 gap-0.5">
          {([
            { key: 'light' as const, icon: <Sun className="h-4 w-4" />, label: t('appearance.light') },
            { key: 'dark' as const, icon: <Moon className="h-4 w-4" />, label: t('appearance.dark') },
            { key: 'system' as const, icon: <Monitor className="h-4 w-4" />, label: t('appearance.system') },
          ]).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTheme(item.key)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${
                theme === item.key
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color Theme */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('appearance.colorTheme.title')}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{t('appearance.colorTheme.description')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {COLOR_THEME_REGISTRY.map((ct) => {
            const isSelected = colorTheme === ct.id;
            const swatchPair = effectiveTheme === 'dark' ? ct.swatches.dark : ct.swatches.light;
            return (
              <button
                key={ct.id}
                type="button"
                id={`theme-card-${ct.id}`}
                onClick={() => setColorTheme(ct.id)}
                className={`relative flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                  isSelected
                      ? 'border-primary bg-accent/40'
                      : 'border-border bg-background hover:bg-accent/30'
                }`}
              >
                {/* Color swatches */}
                <div className="relative h-10 w-10 shrink-0">
                  <div
                    className="absolute left-0 top-0 h-7 w-7 rounded-full border border-black/8 dark:border-white/10"
                    style={{ backgroundColor: swatchPair[0] }}
                  />
                  <div
                    className="absolute bottom-0 right-0 h-7 w-7 rounded-full border border-black/8 dark:border-white/10"
                    style={{ backgroundColor: swatchPair[1] }}
                  />
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground truncate">
                    {t(`appearance.colorTheme.${ct.id}`)}
                  </p>
                  <p className="text-[12px] text-muted-foreground truncate leading-snug">
                    {t(`appearance.colorTheme.${ct.id}Desc`)}
                  </p>
                </div>

                {/* Checkmark */}
                {isSelected && (
                  <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-foreground">{t('appearance.language')}</h3>
        <div className="flex gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <Button
              key={lang.code}
              variant={language === lang.code ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage(lang.code)}
            >
              {lang.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SafetySettingsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const [safetySettings, setSafetySettings] = useState<SafetySettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSafety, setSavingSafety] = useState(false);
  const [openingDirectory, setOpeningDirectory] = useState(false);

  const policyOptions: Array<{
    value: SecurityPolicy;
    title: string;
    description: string;
    icon: typeof CheckmarkCircle02Icon;
  }> = [
    {
      value: 'moderate',
      title: t('safety.policy.options.moderate.title'),
      description: t('safety.policy.options.moderate.description'),
      icon: CheckmarkCircle02Icon,
    },
    {
      value: 'strict',
      title: t('safety.policy.options.strict.title'),
      description: t('safety.policy.options.strict.description'),
      icon: ChatLockIcon,
    },
    {
      value: 'fullAccess',
      title: t('safety.policy.options.fullAccess.title'),
      description: t('safety.policy.options.fullAccess.description'),
      icon: FireIcon,
    },
  ];

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await hostApiFetch<SafetySettingsInfo>('/api/settings/safety');
        if (!cancelled) {
          setSafetySettings(response);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`${t('safety.loadFailed')}: ${toUserMessage(error)}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [t]);

  const handleOpenWorkspaceDir = async () => {
    if (!safetySettings?.configDir) return;
    setOpeningDirectory(true);
    try {
      const result = await invokeIpc<string>('shell:openPath', safetySettings.configDir);
      if (typeof result === 'string' && result.trim()) {
        throw new Error(result);
      }
    } catch (error) {
      toast.error(`${t('safety.openDirFailed')}: ${toUserMessage(error)}`);
    } finally {
      setOpeningDirectory(false);
    }
  };

  const saveSafetyPatch = async (
    patch: Partial<Pick<SafetySettingsInfo, 'securityPolicy'>>,
    onSuccessMessage: string,
    rollbackState: SafetySettingsInfo,
  ) => {
    setSavingSafety(true);
    try {
      const response = await hostApiFetch<{ success: boolean; settings: SafetySettingsInfo }>('/api/settings/safety', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      setSafetySettings(response.settings);
      toast.success(onSuccessMessage);
    } catch (error) {
      setSafetySettings(rollbackState);
      toast.error(`${t('safety.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingSafety(false);
    }
  };

  const handleSecurityPolicyChange = async (nextValue: SecurityPolicy) => {
    if (!safetySettings || savingSafety || safetySettings.securityPolicy === nextValue) return;
    const nextState = { ...safetySettings, securityPolicy: nextValue };

    setSafetySettings(nextState);
    await saveSafetyPatch(
      { securityPolicy: nextValue },
      t('safety.policy.saved'),
      safetySettings,
    );
  };

  const configDir = safetySettings?.configDir ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('safety.title')}
        </h2>
        <p className="max-w-3xl text-base text-muted-foreground">
          {t('safety.description')}
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{t('safety.policy.title')}</CardTitle>
          <CardDescription>{t('safety.policy.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {policyOptions.map((option) => {
            const active = safetySettings?.securityPolicy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void handleSecurityPolicyChange(option.value)}
                disabled={loading || savingSafety}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  active
                    ? 'border-primary bg-accent/40'
                    : 'border-border/60 bg-background hover:bg-accent/20'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      active ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      <HugeiconsIcon icon={option.icon} size={18} strokeWidth={1.9} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{option.title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{option.description}</p>
                    </div>
                  </div>
                  <div className={`h-3 w-3 shrink-0 rounded-full ${active ? 'bg-primary' : 'bg-border'}`} />
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{t('safety.directory.title')}</CardTitle>
          <CardDescription>{t('safety.directory.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row">
            <Input
              readOnly
              value={loading ? t('common:status.loading') : configDir}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              className="md:min-w-28"
              onClick={handleOpenWorkspaceDir}
              disabled={loading || !configDir || openingDirectory}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {openingDirectory ? t('safety.directory.opening') : t('safety.directory.browse')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function Settings({ embedded = false }: SettingsProps) {
  const { t } = useTranslation(['settings', 'common']);
  const location = useLocation();
  const navigate = useNavigate();
  const section = resolveSettingsSection(location.pathname);
  const modalState = getSettingsModalState(location);
  const settingsGroups: Array<{ key: SettingsModalSection; title: string; icon: React.ReactNode }> = [
    { key: 'appearance', title: t('appearance.title'), icon: <Palette className="h-4 w-4" /> },
    { key: 'models', title: t('common:sidebar.models', 'Models'), icon: <HugeiconsIcon icon={CpuSettingsIcon} size={16} strokeWidth={1.9} /> },
    { key: 'safety', title: t('safety.navTitle'), icon: <HugeiconsIcon icon={AiSecurity02Icon} size={16} strokeWidth={1.9} /> },
    { key: 'gateway', title: t('nav.gateway'), icon: <Server className="h-4 w-4" /> },
    { key: 'general', title: t('nav.general'), icon: <SlidersHorizontal className="h-4 w-4" /> },
  ];
  const closeTarget = !modalState.backgroundLocation || isSettingsModalPath(modalState.backgroundLocation.pathname)
    ? '/'
    : modalState.backgroundLocation.pathname;

  const handleClose = () => {
    navigate(closeTarget, { replace: true });
  };

  const content = (
    <div className="grid h-[min(84vh,780px)] min-h-[620px] grid-cols-[172px_minmax(0,1fr)] overflow-hidden rounded-[12px] sm:grid-cols-[184px_minmax(0,1fr)] md:grid-cols-[196px_minmax(0,1fr)]">
      <aside className="app-sidebar relative flex flex-col border-r px-2 py-3 dark:border-white/8 sm:px-3">
        <nav className="space-y-1">
          {settingsGroups.map((group) => {
            const active = group.key === section;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => navigate(getSettingsModalPath(group.key), { state: modalState })}
                className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                  active
                    ? 'sidebar-item-active text-foreground'
                    : 'text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-white/6 dark:hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={active ? 'text-primary' : 'text-muted-foreground'}>{group.icon}</span>
                  <p className="truncate text-[13px] font-medium leading-5">
                    {group.title}
                  </p>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            className="w-full justify-start rounded-xl px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-white/6 dark:hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('common:actions.back')}
          </Button>
        </div>
      </aside>

      <section className="settings-modal-scroll app-canvas min-h-0 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <div className="mx-auto max-w-5xl">
          {section === 'appearance' && <AppearanceSettingsPanel />}
          {section === 'safety' && <SafetySettingsPanel />}
          {section === 'gateway' && (
            <AppSettingsPanel
              section="gateway"
              onOpenSessions={() => navigate('/gateway-sessions', { replace: true })}
            />
          )}
          {section === 'general' && <AppSettingsPanel section="general" />}
          {section === 'models' && <ModelsSettingsSection />}
        </div>
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  const activeGroup = settingsGroups.find((group) => group.key === section) ?? settingsGroups[0];

  return (
    <Dialog modal={false} open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent hideCloseButton className="p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{activeGroup.title}</DialogTitle>
          <DialogDescription>{activeGroup.title}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

export default Settings;
