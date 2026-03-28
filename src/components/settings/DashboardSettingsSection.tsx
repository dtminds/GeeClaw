/**
 * Dashboard settings section
 * Overview workspace embedded inside Settings.
 */
import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Activity } from 'lucide-react';
import {
  SmartPhone03Icon,
  Clock03Icon,
  ThreeDViewIcon,
} from '@hugeicons/core-free-icons';
// import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGatewayStore } from '@/stores/gateway';
import { useChannelsStore } from '@/stores/channels';
import { useSkillsStore } from '@/stores/skills';
// import { useSettingsStore } from '@/stores/settings';
import { StatusBadge } from '@/components/common/StatusBadge';
// import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
// import { getSettingsModalState } from '@/lib/settings-modal';
import { cn } from '@/lib/utils';

interface DashboardSettingsSectionProps {
  className?: string;
}

export function DashboardSettingsSection({ className }: DashboardSettingsSectionProps = {}) {
  const { t } = useTranslation('dashboard');
  // const location = useLocation();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const { channels, fetchChannels } = useChannelsStore();
  const { skills, fetchSkills } = useSkillsStore();
  // const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);

  const isGatewayRunning = gatewayStatus.state === 'running';
  // const settingsModalState = getSettingsModalState(location);
  const [uptime, setUptime] = useState(0);

  // Track page view on mount only.
  useEffect(() => {
    trackUiEvent('dashboard.page_viewed');
  }, []);

  // Fetch data only when gateway is running.
  useEffect(() => {
    if (isGatewayRunning) {
      fetchChannels();
      fetchSkills();
    }
  }, [fetchChannels, fetchSkills, isGatewayRunning]);

  // Calculate statistics safely
  const connectedChannels = Array.isArray(channels) ? channels.filter((c) => c.status === 'connected').length : 0;
  const enabledSkills = Array.isArray(skills) ? skills.filter((s) => s.enabled).length : 0;

  // Update uptime periodically
  useEffect(() => {
    const updateUptime = () => {
      if (gatewayStatus.connectedAt) {
        setUptime(Math.floor((Date.now() - gatewayStatus.connectedAt) / 1000));
      } else {
        setUptime(0);
      }
    };

    // Update immediately
    updateUptime();

    // Update every second
    const interval = setInterval(updateUptime, 1000);

    return () => clearInterval(interval);
  }, [gatewayStatus.connectedAt]);

  // const openDevConsole = async () => {
  //   try {
  //     const result = await hostApiFetch<{
  //       success: boolean;
  //       url?: string;
  //       error?: string;
  //     }>('/api/gateway/control-ui');
  //     if (result.success && result.url) {
  //       trackUiEvent('dashboard.quick_action', { action: 'dev_console' });
  //       window.electron.openExternal(result.url);
  //     } else {
  //       console.error('Failed to get Dev Console URL:', result.error);
  //     }
  //   } catch (err) {
  //     console.error('Error opening Dev Console:', err);
  //   }
  // };

  return (
    <div className={cn('mx-auto w-full max-w-5xl space-y-6 pb-4', className)}>
      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Gateway Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('gateway')}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mt-1 mb-2 ml-[-8px]">
              <StatusBadge status={gatewayStatus.state} />
            </div>
            {gatewayStatus.state === 'running' && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('port', { port: gatewayStatus.port })} | {t('pid', { pid: gatewayStatus.pid || 'N/A' })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Channels */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('channels')}</CardTitle>
            <HugeiconsIcon icon={SmartPhone03Icon} size={16} strokeWidth={1.8} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{connectedChannels}</div>
            <p className="text-xs text-muted-foreground">
              {t('connectedOf', { connected: connectedChannels, total: channels.length })}
            </p>
          </CardContent>
        </Card>

        {/* Skills */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('skills')}</CardTitle>
            <HugeiconsIcon icon={ThreeDViewIcon} size={16} strokeWidth={1.8} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enabledSkills}</div>
            <p className="text-xs text-muted-foreground">
              {t('enabledOf', { enabled: enabledSkills, total: skills.length })}
            </p>
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('uptime')}</CardTitle>
            <HugeiconsIcon icon={Clock03Icon} size={16} strokeWidth={1.8} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {uptime > 0 ? formatUptime(uptime) : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              {gatewayStatus.state === 'running' ? t('sinceRestart') : t('gatewayNotRunning')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      {/* <Card>
        <CardHeader>
          <CardTitle>{t('quickActions.title')}</CardTitle>
          <CardDescription>{t('quickActions.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${devModeUnlocked ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link
                to={getSettingsModalPath('models')}
                state={settingsModalState}
                onClick={() => trackUiEvent('dashboard.quick_action', { action: 'add_provider' })}
              >
                <HugeiconsIcon icon={CpuSettingsIcon} size={20} strokeWidth={1.8} />
                <span>{t('quickActions.addProvider')}</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link
                to="/channels"
                onClick={() => trackUiEvent('dashboard.quick_action', { action: 'add_channel' })}
              >
                <HugeiconsIcon icon={SmartPhone03Icon} size={20} strokeWidth={1.8} />
                <span>{t('quickActions.addChannel')}</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/cron" onClick={() => trackUiEvent('dashboard.quick_action', { action: 'create_cron' })}>
                <HugeiconsIcon icon={TimeScheduleIcon} size={20} strokeWidth={1.8} />
                <span>{t('quickActions.createCron')}</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/skills" onClick={() => trackUiEvent('dashboard.quick_action', { action: 'install_skill' })}>
                <HugeiconsIcon icon={ThreeDViewIcon} size={20} strokeWidth={1.8} />
                <span>{t('quickActions.installSkill')}</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto flex-col gap-2 py-4" asChild>
              <Link to="/chat" onClick={() => trackUiEvent('dashboard.quick_action', { action: 'open_chat' })}>
                <HugeiconsIcon icon={AddCircleIcon} size={20} strokeWidth={1.8} />
                <span>{t('quickActions.openChat')}</span>
              </Link>
            </Button>
            {devModeUnlocked && (
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                onClick={openDevConsole}
              >
                <HugeiconsIcon icon={ComputerTerminal01Icon} size={20} strokeWidth={1.8} />
                <span>{t('quickActions.devConsole')}</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card> */}

      {/* Recent Activity */}
      {/* <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('connectedChannels')}</CardTitle>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <FeedbackState
                state="empty"
                title={t('noChannels')}
                action={(
                  <Button variant="link" asChild className="mt-2">
                    <Link to="/channels">{t('addFirst')}</Link>
                  </Button>
                )}
              />
            ) : (
              <div className="space-y-3">
                {channels.slice(0, 5).map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {channel.type === 'whatsapp' && '📱'}
                        {channel.type === 'telegram' && '✈️'}
                        {channel.type === 'discord' && '🎮'}
                      </span>
                      <div>
                        <p className="font-medium">{channel.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {channel.type}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={channel.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('activeSkills')}</CardTitle>
          </CardHeader>
          <CardContent>
            {skills.filter((s) => s.enabled).length === 0 ? (
              <FeedbackState
                state="empty"
                title={t('noSkills')}
                action={(
                  <Button variant="link" asChild className="mt-2">
                    <Link to="/skills">{t('enableSome')}</Link>
                  </Button>
                )}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {skills
                  .filter((s) => s.enabled)
                  .slice(0, 12)
                  .map((skill) => (
                    <Badge key={skill.id} variant="secondary">
                      {skill.icon && <span className="mr-1">{skill.icon}</span>}
                      {skill.name}
                    </Badge>
                  ))}
                {skills.filter((s) => s.enabled).length > 12 && (
                  <Badge variant="outline">
                    {t('more', { count: skills.filter((s) => s.enabled).length - 12 })}
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div> */}
    </div>
  );
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export default DashboardSettingsSection;
