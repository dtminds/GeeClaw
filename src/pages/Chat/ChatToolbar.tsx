/**
 * Chat Toolbar
 * Left shows agent + session id, right shows visibility toggles and refresh.
 * Rendered inside the Chat page header.
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useMemo, useState } from 'react';
import { RefreshCw, Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { AgentSettingsDialog } from '@/pages/Chat/AgentSettingsDialog';
import { AiContentGenerator01Icon, Robot02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

export function ChatToolbar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const showToolCalls = useChatStore((s) => s.showToolCalls);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const toggleToolCalls = useChatStore((s) => s.toggleToolCalls);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionsPanelCollapsed = useSettingsStore((s) => s.chatSessionsPanelCollapsed);
  const setSessionsPanelCollapsed = useSettingsStore((s) => s.setChatSessionsPanelCollapsed);
  const agents = useAgentsStore((s) => s.agents);
  const { t } = useTranslation('chat');
  const currentAgentName = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );

  return (
    <>
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 min-w-0 items-center gap-2 text-[12px] text-foreground/70">
          <HugeiconsIcon icon={Robot02Icon} className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground/85">{currentAgentName}</span>
          <span className="shrink-0 text-foreground/35">/</span>
          <span
            className="inline-block max-w-[min(52vw,32rem)] truncate align-bottom font-mono text-foreground/55"
            title={`${t('toolbar.sessionId')}: ${currentSessionKey || '-'}`}
          >
            {currentSessionKey || '-'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 rounded-full px-3 text-[13px] font-medium text-foreground/78',
                  !sessionsPanelCollapsed && 'bg-black/[0.04] text-foreground dark:bg-white/[0.06]',
                )}
                onClick={() => setSessionsPanelCollapsed(!sessionsPanelCollapsed)}
                aria-label={sessionsPanelCollapsed ? t('sessionPanel.expand') : t('sessionPanel.collapse')}
                title={sessionsPanelCollapsed ? t('sessionPanel.expand') : t('sessionPanel.collapse')}
              >
                <HugeiconsIcon icon={AiContentGenerator01Icon} className="mr-1.5 h-4 w-4 text-primary" />
                {t('sessionPanel.title')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{sessionsPanelCollapsed ? t('sessionPanel.expand') : t('sessionPanel.collapse')}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-foreground/78"
                    aria-label={t('toolbar.visibilityOptions')}
                    title={t('toolbar.visibilityOptions')}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <ChevronDown className="ml-1 h-3 w-3 opacity-45" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="bottom"
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-50 min-w-[180px] overflow-hidden rounded-xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none data-[side=bottom]:animate-in data-[side=bottom]:slide-in-from-top-2 dark:border-white/10 dark:bg-card"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                    }}
                  >
                    <DropdownMenu.CheckboxItem
                      checked={showThinking}
                      onCheckedChange={() => toggleThinking()}
                      className="relative mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 pl-8 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent/60"
                    >
                      <DropdownMenu.ItemIndicator className="absolute left-3 inline-flex items-center justify-center">
                        <Check className="h-3.5 w-3.5" />
                      </DropdownMenu.ItemIndicator>
                      <span>{t('toolbar.showThinking')}</span>
                    </DropdownMenu.CheckboxItem>

                    <DropdownMenu.CheckboxItem
                      checked={showToolCalls}
                      onCheckedChange={() => toggleToolCalls()}
                      className="relative mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 pl-8 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent/60"
                    >
                      <DropdownMenu.ItemIndicator className="absolute left-3 inline-flex items-center justify-center">
                        <Check className="h-3.5 w-3.5" />
                      </DropdownMenu.ItemIndicator>
                      <span>{t('toolbar.showToolCalls')}</span>
                    </DropdownMenu.CheckboxItem>

                    <DropdownMenu.Separator className="mx-2 my-1 h-px bg-black/8 dark:bg-white/10" />

                    <DropdownMenu.Item
                      disabled={loading}
                      onSelect={() => refresh()}
                      className="mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent/60"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5 text-foreground/70', loading && 'animate-spin')} />
                      <span>{t('toolbar.refresh')}</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('toolbar.visibilityOptions')}</p>
            </TooltipContent>
          </Tooltip>

          <div className="h-3.5 w-px bg-foreground/10" />
          
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-3 text-[13px] font-medium text-foreground/78"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('toolbar.agentSettings.open')}
            title={t('toolbar.agentSettings.open')}
          >
            <HugeiconsIcon icon={Robot02Icon} className="mr-1.5 h-4 w-4 text-primary" />
            {t('agentSettingsDialog.title')}
          </Button>
        </div>
      </div>

      <AgentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        agentId={currentAgentId}
      />
    </>
  );
}
