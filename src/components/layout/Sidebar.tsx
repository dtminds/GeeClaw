/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  LogoutSquare01Icon,
  Settings03Icon,
  ThreeDViewIcon,
  SmartPhone03Icon,
  TimeScheduleIcon,
  LayoutAlignLeftIcon,
  PanelLeftIcon,
  AiInnovation02Icon,
} from '@hugeicons/core-free-icons';
import { Plus } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { useSessionStore } from '@/stores/session';
import { useBootstrapStore } from '@/stores/bootstrap';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { invokeIpc } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { getSettingsModalPath, getSettingsModalState, isSettingsModalPath } from '@/lib/settings-modal';
import { renderSkillMarkersAsPlainText } from '@/lib/chat-message-text';
import { AddAgentDialog } from '@/pages/Chat/AddAgentDialog';

const isMac = window.electron?.platform === 'darwin';
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
  testId?: string;
  badge?: string;
  trailing?: React.ReactNode;
  collapsed?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, testId, badge, trailing, collapsed, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      data-testid={testId}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-normal transition-colors duration-200',
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

function getSessionUpdatedAtMs(session?: { updatedAt?: unknown }): number {
  const updatedAt = session?.updatedAt;
  if (typeof updatedAt === 'number') {
    return Number.isFinite(updatedAt) ? updatedAt : 0;
  }
  if (typeof updatedAt === 'string') {
    const parsed = Date.parse(updatedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);

  const desktopSessions = useChatStore((s) => s.desktopSessions);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const loadDesktopSessionSummaries = useChatStore((s) => s.loadDesktopSessionSummaries);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const channels = useChannelsStore((s) => s.channels);
  const fetchChannels = useChannelsStore((s) => s.fetchChannels);
  const isGatewayRunning = useGatewayStore((s) => s.status.state === 'running');
  const sessionStatus = useSessionStore((s) => s.status);
  const sessionAccount = useSessionStore((s) => s.account);
  const logoutToLogin = useBootstrapStore((s) => s.logoutToLogin);

  const navigate = useNavigate();
  const location = useLocation();
  const isOnChat = location.pathname === '/chat';
  const settingsModalState = getSettingsModalState(location);

  const { t } = useTranslation(['common', 'chat']);
  const settingsPath = getSettingsModalPath('appearance');
  const accountDisplayName = sessionAccount?.nickName || sessionAccount?.displayName || t('sidebar.loggedIn');

  useEffect(() => {
    if (!isMac) return;
    void invokeIpc('window:setButtonsVisible', !sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (agents.length === 0) {
      void fetchAgents();
    }
  }, [agents.length, fetchAgents]);

  useEffect(() => {
    if (isGatewayRunning) {
      void fetchChannels();
    }
  }, [fetchChannels, isGatewayRunning]);

  useEffect(() => {
    if (!isGatewayRunning || desktopSessions.length > 0) {
      return;
    }
    void loadDesktopSessionSummaries();
  }, [desktopSessions.length, isGatewayRunning, loadDesktopSessionSummaries]);

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

  const { agentMainSessions, sortedAgents } = useMemo(() => {
    const mainSessionKeyByAgentId = new Map(agents.map((agent) => [agent.id, agent.mainSessionKey]));
    const nextAgentMainSessions = desktopSessions.reduce((map, session) => {
      const agentId = getAgentIdFromSessionKey(session.gatewaySessionKey);
      const mainSessionKey = mainSessionKeyByAgentId.get(agentId) ?? `agent:${agentId}:geeclaw_main`;
      if (session.gatewaySessionKey !== mainSessionKey) {
        return map;
      }

      const current = map.get(agentId);
      if (!current || getSessionUpdatedAtMs(session) > getSessionUpdatedAtMs(current)) {
        map.set(agentId, session);
      }
      return map;
    }, new Map<string, (typeof desktopSessions)[number]>());
    const nextSortedAgents = [...agents].sort((left, right) => {
      const defaultSort = Number(right.isDefault) - Number(left.isDefault);
      if (defaultSort !== 0) {
        return defaultSort;
      }

      const updatedAtSort = getSessionUpdatedAtMs(nextAgentMainSessions.get(right.id))
        - getSessionUpdatedAtMs(nextAgentMainSessions.get(left.id));
      return updatedAtSort || left.name.localeCompare(right.name);
    });

    return {
      agentMainSessions: nextAgentMainSessions,
      sortedAgents: nextSortedAgents,
    };
  }, [agents, desktopSessions]);

  const navItems = [
    { to: '/dashboard', icon: <SidebarGlyph icon={AiInnovation02Icon} />, label: t('sidebar.dashboard'), testId: 'sidebar-nav-dashboard' },
    { to: '/cron', icon: <SidebarGlyph icon={TimeScheduleIcon} />, label: t('sidebar.cronTasks') },
    { to: '/skills', icon: <SidebarGlyph icon={ThreeDViewIcon} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/channels', icon: <SidebarGlyph icon={SmartPhone03Icon} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels', trailing: channelsTrailing },
  ];
  return (
    <aside
      className={cn(
        'app-sidebar flex h-full w-full shrink-0 flex-col'
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
            setSidebarCollapsed(!sidebarCollapsed);
          }}
          title={sidebarCollapsed ? t('sidebar.expand', 'Expand sidebar') : t('sidebar.collapse', 'Collapse sidebar')}
        >
          {sidebarCollapsed ? (
            <SidebarGlyph icon={PanelLeftIcon} />
          ) : (
            <SidebarGlyph icon={LayoutAlignLeftIcon} />
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
      <div className={cn('mt-4 flex min-h-0 flex-1 flex-col pb-3', sidebarCollapsed ? 'px-1' : 'px-3')}>
        {!sidebarCollapsed && (
          <div className="mb-1 flex items-center justify-between px-3 py-1">
            <h2 className="text-[13px] font-semibold text-foreground/88">
              {t('sidebar.agents', '智能体')}
            </h2>
            <button
              type="button"
              onClick={() => setAddAgentOpen(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/72 hover:text-foreground dark:hover:bg-white/6 dark:hover:text-foreground"
              title={t('sidebar.createAgent', 'Create agent')}
              aria-label={t('sidebar.createAgent', 'Create agent')}
            >
              <Plus className="h-4 w-4" />
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
                      navigate('/chat', { state: { requestedAgentId: agent.id } });
                    }}
                    title={agent.name}
                    className={cn(
                      'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform',
                      isActiveAgent && 'scale-[1.02]',
                    )}
                    aria-label={t('sidebar.switchToAgent', { defaultValue: '切换到 {{name}}', name: agent.name })}
                  >
                    <AgentAvatar
                      presetId={agent.avatarPresetId}
                      label={agent.name}
                      size="compact"
                      className="h-7 w-7"
                    />
                  </button>
                );
              }

              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    navigate('/chat', { state: { requestedAgentId: agent.id } });
                  }}
                  className={cn(
                    'w-full rounded-xl px-3 py-2 text-left transition-colors duration-200',
                    sidebarItemBaseClass,
                    isActiveAgent ? sidebarSessionActiveClass : '',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <AgentAvatar
                      presetId={agent.avatarPresetId}
                      label={agent.name}
                      size="full"
                      className="mt-0.5 shrink-0"
                    />
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

      {/* Footer */}
      <div className="mt-auto px-3 pb-3 pt-2">
        {sidebarCollapsed ? (
          <NavLink
            to={settingsPath}
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
            {sessionStatus === 'authenticated' ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors duration-200 hover:bg-white/72 dark:hover:bg-white/6">
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,rgba(36,93,124,0.16),rgba(36,93,124,0.06))] text-[12px] font-semibold text-primary dark:bg-[linear-gradient(135deg,rgba(96,165,250,0.18),rgba(96,165,250,0.06))]">
                  <span className="absolute inset-0 flex items-center justify-center">
                    {(sessionAccount?.displayName || sessionAccount?.nickName || 'G').slice(0, 1).toUpperCase()}
                  </span>
                  {sessionAccount?.avatarUrl ? (
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
                  {accountDisplayName}
                </p>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors duration-200 hover:bg-white/72 dark:hover:bg-white/6">
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,rgba(36,93,124,0.16),rgba(36,93,124,0.06))] text-[12px] font-semibold text-primary dark:bg-[linear-gradient(135deg,rgba(96,165,250,0.18),rgba(96,165,250,0.06))]">
                  <span className="absolute inset-0 flex items-center justify-center">G</span>
                </div>
                <p className="truncate text-[13px] font-medium text-foreground">
                  {t('sidebar.login', '登录')}
                </p>
              </div>
            )}
            {sessionStatus === 'authenticated' ? (
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
                      sidebarItemBaseClass,
                      isSettingsModalPath(location.pathname) && sidebarItemActiveClass,
                    )}
                    title={t('sidebar.settings')}
                  >
                    <div className={cn('flex shrink-0 items-center justify-center cursor-pointer', isSettingsModalPath(location.pathname) ? 'text-primary' : 'text-muted-foreground')}>
                      <SidebarGlyph icon={Settings03Icon} />
                    </div>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="top"
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-50 w-[220px] overflow-hidden rounded-xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none data-[side=top]:animate-in data-[side=top]:slide-in-from-bottom-2 dark:border-white/10 dark:bg-card"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                    }}
                  >
                    <DropdownMenu.Label className="mx-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-foreground">
                      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,rgba(36,93,124,0.16),rgba(36,93,124,0.06))] text-[10px] font-semibold text-primary dark:bg-[linear-gradient(135deg,rgba(96,165,250,0.18),rgba(96,165,250,0.06))]">
                        <span className="absolute inset-0 flex items-center justify-center">
                          {(sessionAccount?.displayName || sessionAccount?.nickName || 'G').slice(0, 1).toUpperCase()}
                        </span>
                        {sessionAccount?.avatarUrl ? (
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
                      <span className="truncate">{accountDisplayName}</span>
                    </DropdownMenu.Label>
                    <DropdownMenu.Separator className="mx-2 my-1 h-px bg-black/8 dark:bg-white/10" />
                    <DropdownMenu.Item
                      className="mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent/60"
                      onSelect={() => {
                        navigate(settingsPath, { state: settingsModalState });
                      }}
                    >
                      <SidebarGlyph icon={Settings03Icon} className="text-foreground/70" size={16} strokeWidth={1.8} />
                      <span>{t('sidebar.settings')}</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent/60"
                      onSelect={() => {
                        setLogoutConfirmOpen(true);
                      }}
                    >
                      <SidebarGlyph icon={LogoutSquare01Icon} className="text-foreground/70" size={16} strokeWidth={1.8} />
                      <span>{t('sidebar.logout', 'Logout')}</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : (
              <NavLink
                to={settingsPath}
                state={settingsModalState}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200',
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
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={logoutConfirmOpen}
        title={t('sidebar.logoutConfirmTitle', '退出登录？')}
        message={t('sidebar.logoutConfirmMessage', '确认后将退出当前账号，并返回登录页面。')}
        confirmLabel={t('sidebar.logout', '退出登录')}
        cancelLabel={t('actions.cancel', '取消')}
        variant="destructive"
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          void logoutToLogin().catch(() => {});
        }}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
      <AddAgentDialog open={addAgentOpen} onOpenChange={setAddAgentOpen} />
    </aside>
  );
}
