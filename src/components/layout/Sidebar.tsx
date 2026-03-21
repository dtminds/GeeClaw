/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  DashboardSpeed01Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Settings03Icon,
  ThreeDViewIcon,
  SmartPhone03Icon,
  AppleIntelligenceIcon,
  TimeScheduleIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useSessionStore } from '@/stores/session';
import { useBootstrapStore } from '@/stores/bootstrap';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import { useTranslation } from 'react-i18next';
import { getSettingsModalPath, getSettingsModalState, isSettingsModalPath } from '@/lib/settings-modal';
import { renderSkillMarkersAsPlainText } from '@/lib/chat-message-text';

const isMac = window.electron?.platform === 'darwin';
const SIDEBAR_TRANSITION_MS = 220;
const sidebarItemBaseClass = 'text-foreground/72 hover:bg-white/72 hover:text-foreground dark:text-foreground/70 dark:hover:bg-white/6 dark:hover:text-foreground';
const sidebarItemActiveClass = 'sidebar-item-active font-medium';
const sidebarSessionActiveClass = 'sidebar-item-active font-medium';

function SidebarGlyph({
  icon,
  className,
  size = 18,
  strokeWidth = 1.8,
}: {
  icon: IconSvgElement;
  className?: string;
  size?: number;
  strokeWidth?: number;
}) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} />;
}

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  trailing?: React.ReactNode;
  collapsed?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, trailing, collapsed, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-normal transition-all duration-200',
          sidebarItemBaseClass,
          isActive && !collapsed ? sidebarItemActiveClass : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-primary' : 'text-muted-foreground')}>
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
              {trailing}
              {badge && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

function isMainSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(':main');
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const [sidebarExpandedContentReady, setSidebarExpandedContentReady] = useState(!sidebarCollapsed);

  const desktopSessions = useChatStore((s) => s.desktopSessions);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const openAgentMainSession = useChatStore((s) => s.openAgentMainSession);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const channels = useChannelsStore((s) => s.channels);
  const fetchChannels = useChannelsStore((s) => s.fetchChannels);
  const sessionStatus = useSessionStore((s) => s.status);
  const sessionAccount = useSessionStore((s) => s.account);
  const logoutToLogin = useBootstrapStore((s) => s.logoutToLogin);

  const navigate = useNavigate();
  const location = useLocation();
  const isOnChat = location.pathname === '/';
  const settingsModalState = getSettingsModalState(location);

  const { t } = useTranslation(['common', 'chat']);

  useEffect(() => {
    if (!isMac) return;
    void invokeIpc('window:setButtonsVisible', !sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (sidebarCollapsed) return;

    const timer = window.setTimeout(() => {
      setSidebarExpandedContentReady(true);
    }, SIDEBAR_TRANSITION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (agents.length === 0) {
      void fetchAgents();
    }
  }, [agents.length, fetchAgents]);

  useEffect(() => {
    if (channels.length === 0) {
      void fetchChannels();
    }
  }, [channels.length, fetchChannels]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannels();
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannels]);

  const onlineChannelAccounts = channels.reduce(
    (count, channel) => count + channel.accounts.filter((account) => account.status === 'connected').length,
    0,
  );
  const channelsTrailing = onlineChannelAccounts > 0 ? (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[12px] text-foreground/72">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
      <span>{t('sidebar.onlineCount', { count: onlineChannelAccounts, defaultValue: '{{count}} online' })}</span>
    </span>
  ) : (
    <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
      {t('sidebar.offlineCount', { count: 0, defaultValue: '· {{count}} online' })}
    </span>
  );

  const sortedAgents = [...agents].sort(
    (left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name),
  );
  const agentMainSessions = desktopSessions.reduce((map, session) => {
    if (!isMainSessionKey(session.gatewaySessionKey)) {
      return map;
    }

    const agentId = getAgentIdFromSessionKey(session.gatewaySessionKey);
    const current = map.get(agentId);
    if (!current || session.updatedAt > current.updatedAt) {
      map.set(agentId, session);
    }
    return map;
  }, new Map<string, (typeof desktopSessions)[number]>());

  const navItems = [
    { to: '/dashboard', icon: <SidebarGlyph icon={DashboardSpeed01Icon} />, label: t('sidebar.dashboard') },
    { to: '/cron', icon: <SidebarGlyph icon={TimeScheduleIcon} />, label: t('sidebar.cronTasks') },
    { to: '/skills', icon: <SidebarGlyph icon={ThreeDViewIcon} />, label: t('sidebar.skills') },
    { to: '/channels', icon: <SidebarGlyph icon={SmartPhone03Icon} />, label: t('sidebar.channels'), trailing: channelsTrailing },
  ];
  const agentSectionHidden = !sidebarCollapsed && !sidebarExpandedContentReady;

  return (
    <aside
      className={cn(
        'app-sidebar flex shrink-0 flex-col border-r transition-all duration-300',
        sidebarCollapsed ? 'w-12' : 'w-56'
      )}
    >
      {/* Top Header Toggle */}
      <div
        className={cn(
          'drag-region flex h-12 items-center px-3',
          sidebarCollapsed ? 'justify-center' : 'justify-between',
          isMac && (sidebarCollapsed ? 'justify-center' : 'justify-end'),
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="no-drag h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-white/72 hover:text-foreground dark:hover:bg-white/6 dark:hover:text-foreground"
          onClick={() => {
            if (!sidebarCollapsed) {
              setSidebarExpandedContentReady(false);
            }
            setSidebarCollapsed(!sidebarCollapsed);
          }}
          title={sidebarCollapsed ? t('sidebar.expand', 'Expand sidebar') : t('sidebar.collapse', 'Collapse sidebar')}
        >
          {sidebarCollapsed ? (
            <SidebarGlyph icon={PanelLeftCloseIcon} />
          ) : (
            <SidebarGlyph icon={PanelLeftOpenIcon} />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-3">
        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Agent list */}
      {!agentSectionHidden && (
        <div className={cn('mt-4 flex min-h-0 flex-1 flex-col pb-3', sidebarCollapsed ? 'px-1' : 'px-3')}>
          {!sidebarCollapsed && (
            <div className="mb-1 flex items-center justify-between px-3 py-1">
              <h2 className="text-[13px] font-semibold text-foreground/88">
                {t('sidebar.agents', '智能体')}
              </h2>
              <button
                type="button"
                onClick={() => navigate('/agents')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-white/72 hover:text-foreground dark:hover:bg-white/6 dark:hover:text-foreground"
                title={t('sidebar.agents', '智能体')}
                aria-label={t('sidebar.agents', '智能体')}
              >
                <SidebarGlyph icon={AppleIntelligenceIcon} size={16} />
              </button>
            </div>
          )}

          <div className={cn(
            'scroll-fade-y scrollbar-hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
            sidebarCollapsed ? 'py-1' : 'py-2',
          )}>
            <div className={cn(sidebarCollapsed ? 'flex flex-col items-center gap-2' : 'space-y-1')}>
              {sortedAgents.map((agent) => {
                const mainSession = agentMainSessions.get(agent.id);
                const preview = renderSkillMarkersAsPlainText(mainSession?.lastMessagePreview || '').trim();
                const subtitle = preview || t('sidebar.agentMainSessionHint', '点击进入会话');
                const updatedAt = mainSession?.updatedAt ? formatShortDateTime(mainSession.updatedAt) : '';
                const isActiveAgent = isOnChat && currentAgentId === agent.id;

                if (sidebarCollapsed) {
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        void openAgentMainSession(agent.id);
                        navigate('/');
                      }}
                      className={cn(
                        'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
                        isActiveAgent
                          ? 'bg-gradient-to-br from-sky-400/65 to-fuchsia-400/65'
                          : 'bg-black/[0.08] text-foreground/56 dark:bg-white/[0.11] dark:text-foreground/58',
                      )}
                      aria-label={t('sidebar.switchToAgent', { defaultValue: '切换到 {{name}}', name: agent.name })}
                    >
                      {agent.name.slice(0, 1).toUpperCase()}
                    </button>
                  );
                }

                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      void openAgentMainSession(agent.id);
                      navigate('/');
                    }}
                    className={cn(
                      'w-full rounded-xl px-3 py-2 text-left transition-all duration-200',
                      sidebarItemBaseClass,
                      isActiveAgent ? sidebarSessionActiveClass : '',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400/65 to-fuchsia-400/65 text-[12px] font-semibold text-white">
                        {agent.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">{agent.name}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{updatedAt}</span>
                        </div>
                        <div className="mt-0.5">
                          <span className="block truncate text-[12px] text-muted-foreground">{subtitle}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto px-3 pb-3 pt-2">
        {sidebarCollapsed ? (
          <NavLink
            to={getSettingsModalPath('appearance')}
            state={settingsModalState}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-center rounded-xl px-0 py-2.5 text-[14px] font-medium transition-all duration-200',
                sidebarItemBaseClass,
                (isActive || isSettingsModalPath(location.pathname)) && sidebarItemActiveClass,
              )
            }
          >
            {({ isActive }) => (
              <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-primary' : 'text-muted-foreground')}>
                <SidebarGlyph icon={Settings03Icon} />
              </div>
            )}
          </NavLink>
        ) : (
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,rgba(36,93,124,0.16),rgba(36,93,124,0.06))] text-[12px] font-semibold text-primary dark:bg-[linear-gradient(135deg,rgba(96,165,250,0.18),rgba(96,165,250,0.06))]">
                {sessionStatus === 'authenticated' ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    {(sessionAccount?.displayName || sessionAccount?.nickName || 'G').slice(0, 1).toUpperCase()}
                  </span>
                ) : null}
                {sessionStatus === 'authenticated' && sessionAccount?.avatarUrl ? (
                  <img
                    src={sessionAccount.avatarUrl}
                    alt={sessionAccount.displayName || sessionAccount.nickName || 'avatar'}
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </div>
              <p className="truncate text-[13px] font-medium text-foreground">
                {sessionStatus === 'authenticated'
                  ? (sessionAccount?.nickName || sessionAccount?.displayName || t('sidebar.loggedIn'))
                  : t('sidebar.login', '登录')}
              </p>
            </div>

            {sessionStatus === 'authenticated' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 rounded-xl px-3 text-[12px]"
                onClick={() => {
                  void logoutToLogin().catch(() => {});
                }}
              >
                {t('sidebar.logout', 'Logout')}
              </Button>
            ) : null}

            <NavLink
              to={getSettingsModalPath('appearance')}
              state={settingsModalState}
              className={({ isActive }) =>
                cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200',
                  sidebarItemBaseClass,
                  (isActive || isSettingsModalPath(location.pathname)) && sidebarItemActiveClass,
                )
              }
              title={t('sidebar.settings')}
            >
              {({ isActive }) => (
                <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-primary' : 'text-muted-foreground')}>
                  <SidebarGlyph icon={Settings03Icon} />
                </div>
              )}
            </NavLink>
          </div>
        )}
      </div>
    </aside>
  );
}
