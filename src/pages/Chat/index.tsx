/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AlertCircle, ArrowDown, Loader2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatInput, type FileAttachment } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { ChatSessionsPanel } from './ChatSessionsPanel';
import { ChatMessagesViewport } from './ChatMessagesViewport';
import { useAutoScroll } from './useAutoScroll';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BrandOrbLogo } from '@/components/branding/BrandOrbLogo';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import weixinIcon from '@/assets/channels/weixin.svg';
import qqIcon from '@/assets/channels/qq.svg';
import { buildChatItems } from './build-chat-items';
import { useSettingsStore } from '@/stores/settings';
import { CHANNEL_ICONS, CHANNEL_NAMES, getPrimaryChannels, type ChannelType } from '@/types/channel';

const CHANNEL_LOGO_SVGS: Partial<Record<ChannelType, string>> = {
  telegram: telegramIcon,
  discord: discordIcon,
  whatsapp: whatsappIcon,
  dingtalk: dingtalkIcon,
  feishu: feishuIcon,
  wecom: wecomIcon,
  'openclaw-weixin': weixinIcon,
  qqbot: qqIcon,
};

const CHANNEL_PRIORITY_ORDER: ChannelType[] = [
  'openclaw-weixin',
  'wecom',
  'feishu',
  'dingtalk',
  'qqbot',
];

const WELCOME_CHANNEL_TYPES = [...getPrimaryChannels()]
  .sort((left, right) => {
    const leftPriority = CHANNEL_PRIORITY_ORDER.indexOf(left);
    const rightPriority = CHANNEL_PRIORITY_ORDER.indexOf(right);

    if (leftPriority === -1 && rightPriority === -1) {
      return 0;
    }

    if (leftPriority === -1) {
      return 1;
    }

    if (rightPriority === -1) {
      return -1;
    }

    return leftPriority - rightPriority;
  })
  .slice(0, 8);

export function Chat() {
  const { t } = useTranslation('chat');
  const skipNextAutoLoadRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const requestedAgentId = (location.state as { requestedAgentId?: string } | null)?.requestedAgentId ?? '';
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const sessionsPanelCollapsed = useSettingsStore((s) => s.chatSessionsPanelCollapsed);

  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const showToolCalls = useChatStore((s) => s.showToolCalls);
  const streamingText = useChatStore((s) => s.streamingText);
  const streamingTextStartedAt = useChatStore((s) => s.streamingTextStartedAt);
  const streamSegments = useChatStore((s) => s.streamSegments);
  const toolMessages = useChatStore((s) => s.toolMessages);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const currentDesktopSessionId = useChatStore((s) => s.currentDesktopSessionId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentViewMode = useChatStore((s) => s.currentViewMode);
  const selectedCronRun = useChatStore((s) => s.selectedCronRun);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const openAgentMainSession = useChatStore((s) => s.openAgentMainSession);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const chatItems = buildChatItems({
    messages,
    toolMessages,
    streamSegments,
    streamingText,
    streamingTextStartedAt,
    sessionKey: currentSessionKey,
  });
  const hasLiveText = streamingText.trim().length > 0;
  const hasLiveItems = toolMessages.length > 0 || streamSegments.length > 0;
  const hasAnyStreamContent = hasLiveText || hasLiveItems;
  const isStreamingActive = sending || hasAnyStreamContent;
  const autoScrollSessionId = currentDesktopSessionId
    || (currentViewMode === 'cron' && selectedCronRun ? `cron:${selectedCronRun.jobId}:${selectedCronRun.id}` : currentSessionKey);
  const isComposerDisabled = !isGatewayRunning || (currentViewMode === 'cron' && !selectedCronRun?.sessionKey);
  const disabledPlaceholder = currentViewMode === 'cron' && !selectedCronRun?.sessionKey
    ? t('composer.cronFallbackPlaceholder')
    : undefined;

  // ── Auto-scroll behaviour ──────────────────────────────────────
  const {
    containerRef,
    innerRef,
    isAutoScrollEnabled,
    scrollToBottomAndFollow,
  } = useAutoScroll({
    sessionId: autoScrollSessionId,
    sending: isStreamingActive,
    pendingFinal,
    messagesLength: chatItems.length,
    loading,
  });

  const handleSend = useCallback((text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
    scrollToBottomAndFollow();
    sendMessage(text, attachments, targetAgentId);
  }, [scrollToBottomAndFollow, sendMessage]);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      if (skipNextAutoLoadRef.current && !requestedAgentId) {
        skipNextAutoLoadRef.current = false;
        return;
      }
      await fetchAgents();
      if (cancelled) return;
      if (requestedAgentId) {
        await openAgentMainSession(requestedAgentId);
        if (cancelled) return;
        skipNextAutoLoadRef.current = true;
        navigate(location.pathname, { replace: true });
        return;
      }
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [
    cleanupEmptySession,
    fetchAgents,
    isGatewayRunning,
    loadHistory,
    loadSessions,
    location.pathname,
    navigate,
    openAgentMainSession,
    requestedAgentId,
  ]);

  // Gateway not running
  if (!isGatewayRunning) {
    return (
      <div className="flex h-[calc(100vh-8rem)] flex-col items-center justify-center text-center p-8">
        <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('gatewayNotRunning')}</h2>
        <p className="text-muted-foreground max-w-md">
          {t('gatewayRequired')}
        </p>
      </div>
    );
  }

  const isEmpty = chatItems.length === 0 && !loading && !isStreamingActive;

  return (
    <div
      className={cn(
        'flex h-[calc(100%)] min-h-0 flex-col overflow-hidden transition-colors duration-500 dark:bg-background',
      )}
    >
      <div className="flex shrink-0 items-center border-b border-black/5 px-4 py-2 dark:border-white/6">
        <ChatToolbar />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'min-h-0 min-w-0 shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out',
            sessionsPanelCollapsed ? 'w-0 opacity-0' : 'w-[232px] opacity-100',
          )}
          aria-hidden={sessionsPanelCollapsed}
        >
          <ChatSessionsPanel />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Messages Area */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={containerRef}
              className="flex h-full min-h-0 overflow-y-auto px-4 py-4"
            >
              {loading && !isStreamingActive ? (
                <div ref={innerRef} className="max-w-4xl mx-auto w-full px-4">
                  <div className="flex h-[60vh] items-center justify-center">
                    <LoadingSpinner size="lg" />
                  </div>
                </div>
              ) : isEmpty ? (
                <div ref={innerRef} className="max-w-4xl mx-auto w-full px-4">
                  <WelcomeScreen />
                </div>
              ) : (
                <ChatMessagesViewport
                  items={chatItems}
                  containerRef={containerRef}
                  innerRef={innerRef}
                  showThinking={showThinking}
                  showToolCalls={showToolCalls}
                  footer={(
                    <>
                      {sending && pendingFinal && !hasLiveText && (
                        <ActivityIndicator phase="tool_processing" />
                      )}

                      {sending && !pendingFinal && !hasAnyStreamContent && (
                        <TypingIndicator />
                      )}

                      <div aria-hidden="true" className="h-4 shrink-0" />
                    </>
                  )}
                />
              )}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background via-background/92 to-transparent"
            />

            {!isEmpty && !isAutoScrollEnabled && (
              <button
                type="button"
                onClick={scrollToBottomAndFollow}
                className="absolute bottom-6 right-8 inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-background/95 text-foreground shadow-[0_18px_40px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 hover:bg-background dark:border-white/10"
                aria-label={t('common:actions.scrollToBottom', 'Scroll to bottom')}
                title={t('common:actions.scrollToBottom', 'Scroll to bottom')}
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Error bar */}
          {error && (
            <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2">
              <div className="mx-auto flex max-w-4xl items-center justify-between">
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </p>
                <button
                  onClick={clearError}
                  className="text-xs text-destructive/60 underline hover:text-destructive"
                >
                  {t('common:actions.dismiss')}
                </button>
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="shrink-0 px-4">
            <ChatInput
              onSend={handleSend}
              onStop={abortRun}
              disabled={isComposerDisabled}
              disabledPlaceholder={disabledPlaceholder}
              sending={sending}
              isEmpty={isEmpty}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

export function ChatWelcomeScreen() {
  const { t } = useTranslation('chat');

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <div className="flex h-48 w-48 items-center justify-center">
        <BrandOrbLogo size={192} orbTheme="auto" />
      </div>
      <p className="text-[18px] text-foreground/80 mb-8 font-medium">
        {t('welcome.subtitle')}
      </p>
      <div className="flex max-w-full flex-col items-center gap-4 mt-10">
        <p className="text-sm text-muted-foreground">
          {t('welcome.channelPrompt')}
        </p>
        <div className="flex max-w-full flex-nowrap items-start justify-center gap-5 overflow-x-auto px-2 pb-2">
          {WELCOME_CHANNEL_TYPES.map((type) => (
            <Link
              key={type}
              to="/channels"
              className="flex min-w-[56px] shrink-0 flex-col items-center gap-2 text-center text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2"
              aria-label={t('welcome.channelAriaLabel', { channel: CHANNEL_NAMES[type] })}
              title={CHANNEL_NAMES[type]}
            >
              <ChannelWelcomeIcon type={type} />
              <span className="text-[12px] leading-none text-muted-foreground">
                {CHANNEL_NAMES[type]}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen() {
  return <ChatWelcomeScreen />;
}

function ChannelWelcomeIcon({ type }: { type: ChannelType }) {
  const logo = CHANNEL_LOGO_SVGS[type];

  if (logo) {
    return <img src={logo} alt="" aria-hidden="true" className="h-6 w-6" />;
  }

  return (
    <span aria-hidden="true" className="text-[20px] leading-none">
      {CHANNEL_ICONS[type] || '💬'}
    </span>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="rounded-2xl py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="rounded-2xl py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>思考中</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
