import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { hydrateHistoryMessagesForDisplay, type GatewaySessionSummary, type RawMessage } from '@/stores/chat';

function normalizeGatewaySessions(payload: Record<string, unknown>): GatewaySessionSummary[] {
  const rawSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  return rawSessions.map((session) => ({
    key: String((session as Record<string, unknown>).key || ''),
    label: typeof (session as Record<string, unknown>).label === 'string'
      ? String((session as Record<string, unknown>).label)
      : undefined,
    displayName: typeof (session as Record<string, unknown>).displayName === 'string'
      ? String((session as Record<string, unknown>).displayName)
      : undefined,
    thinkingLevel: typeof (session as Record<string, unknown>).thinkingLevel === 'string'
      ? String((session as Record<string, unknown>).thinkingLevel)
      : undefined,
    model: typeof (session as Record<string, unknown>).model === 'string'
      ? String((session as Record<string, unknown>).model)
      : undefined,
  })).filter((session) => session.key);
}

function getGatewaySessionLabel(session: GatewaySessionSummary): string {
  return session.displayName || session.label || session.key;
}

export function GatewaySessions() {
  const { t } = useTranslation('gatewaySessions');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayRpc = useGatewayStore((state) => state.rpc);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const [sessions, setSessions] = useState<GatewaySessionSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [messages, setMessages] = useState<RawMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    if (!isGatewayRunning) return;
    setLoadingSessions(true);
    setError(null);
    try {
      const data = await gatewayRpc<Record<string, unknown>>('sessions.list', {});
      const nextSessions = normalizeGatewaySessions(data);
      setSessions(nextSessions);
      setSelectedKey((current) => (
        current && nextSessions.some((session) => session.key === current)
          ? current
          : (nextSessions[0]?.key ?? '')
      ));
    } catch (err) {
      setError(String(err));
      setSessions([]);
      setSelectedKey('');
    } finally {
      setLoadingSessions(false);
    }
  }, [gatewayRpc, isGatewayRunning]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!isGatewayRunning || !selectedKey) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);
    setError(null);
    gatewayRpc<Record<string, unknown>>('chat.history', { sessionKey: selectedKey, limit: 200 })
      .then((data) => {
        if (cancelled) return;
        const rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
        return hydrateHistoryMessagesForDisplay(rawMessages);
      })
      .then((preparedMessages) => {
        if (cancelled || !preparedMessages) return;
        setMessages(preparedMessages);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gatewayRpc, isGatewayRunning, selectedKey]);

  if (!isGatewayRunning) {
    return (
      <div className="flex h-[calc(100vh-8rem)] flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="h-12 w-12 text-yellow-500" />
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="max-w-md text-muted-foreground">{t('gatewayRequired')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-normal tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sessions.length ? t('sessionCount', { count: sessions.length }) : t('emptyDescription')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshSessions()} disabled={loadingSessions}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loadingSessions && 'animate-spin')} />
          {t('refresh')}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="min-h-0 border-none bg-transparent shadow-none">
          <CardContent className="min-h-0 p-0">
            {loadingSessions ? (
              <div className="flex h-48 items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{t('empty')}</p>
                <p className="mt-1">{t('emptyDescription')}</p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-8rem)] space-y-2 overflow-y-auto pr-2">
                {sessions.map((session) => (
                  <button
                    key={session.key}
                    onClick={() => setSelectedKey(session.key)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                      selectedKey === session.key
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-background hover:bg-muted/60',
                    )}
                  >
                    <div className="truncate text-sm font-medium">{getGatewaySessionLabel(session)}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{session.key}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader>
            <CardDescription>{selectedKey ? selectedKey : t('previewDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 pr-1">
            {loadingHistory ? (
              <div className="flex h-48 items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {t('historyError')}: {error}
              </div>
            ) : !selectedKey ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                {t('previewDescription')}
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                {t('historyEmpty')}
              </div>
            ) : (
              <div className="max-h-[calc(100vh-16rem)] space-y-4 overflow-y-auto pr-3">
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id || `${selectedKey}-${index}`}
                    message={message}
                    showThinking
                    showToolCalls
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
