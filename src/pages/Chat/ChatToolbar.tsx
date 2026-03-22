/**
 * Chat Toolbar
 * Left shows agent + session id, right shows visibility toggles and refresh.
 * Rendered inside the Chat page header.
 */
import { useMemo, useState } from 'react';
import { RefreshCw, Brain, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { PersonaDrawer } from './PersonaDrawer';
import { AiContentGenerator01Icon, Robot02Icon, UserAiIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

export function ChatToolbar() {
  const [personaOpen, setPersonaOpen] = useState(false);
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
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7 rounded-full',
                  showThinking && 'bg-primary/5 text-primary/80',
                )}
                onClick={toggleThinking}
              >
                <Brain className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7 rounded-full',
                  showToolCalls && 'bg-primary/5 text-primary/80',
                )}
                onClick={toggleToolCalls}
              >
                <Wrench className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{showToolCalls ? t('toolbar.hideToolCalls') : t('toolbar.showToolCalls')}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                onClick={() => refresh()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('toolbar.refresh')}</p>
            </TooltipContent>
          </Tooltip>

          <div className="h-3.5 w-px bg-foreground/10" />
          
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-3 text-[13px] font-medium text-foreground/78"
            onClick={() => setPersonaOpen(true)}
          >
            <HugeiconsIcon icon={UserAiIcon} className="mr-1.5 h-4 w-4 text-primary" />
            {t('toolbar.persona.button')}
          </Button>
        </div>
      </div>

      <PersonaDrawer
        open={personaOpen}
        onOpenChange={setPersonaOpen}
        agentId={currentAgentId}
      />
    </>
  );
}
