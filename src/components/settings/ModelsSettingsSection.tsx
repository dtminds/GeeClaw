/**
 * Models settings section
 * Lives inside the settings modal workspace.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { trackUiEvent } from '@/lib/telemetry';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface AvailableProviderModelGroup {
  providerId: string;
  providerName: string;
  modelRefs: string[];
}

interface AgentDefaultModelSnapshot {
  success?: boolean;
  primary: string | null;
  fallbacks: string[];
  availableModels: AvailableProviderModelGroup[];
}

function normalizeModelRefs(value: string): string[] {
  return Array.from(new Set(
    value
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function AgentFallbackDialog(props: {
  snapshot: AgentDefaultModelSnapshot;
  saving: boolean;
  onClose: () => void;
  onSave: (fallbacks: string[]) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [fallbacksText, setFallbacksText] = useState(() => props.snapshot.fallbacks.join('\n'));

  const normalizedFallbacks = useMemo(
    () => normalizeModelRefs(fallbacksText),
    [fallbacksText],
  );

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
      <Card className="modal-card-surface w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden">
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="modal-title">{t('agentModels.dialog.title')}</CardTitle>
          <CardDescription className="modal-description">
            {t('agentModels.dialog.desc')}
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="modal-close-button absolute right-4 top-4 -mr-2 -mt-2"
            onClick={props.onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="modal-section-surface rounded-2xl border p-4">
            <p className="text-[13px] font-medium text-muted-foreground">{t('agentModels.primary')}</p>
            <p className="mt-1 font-mono text-[13px] text-foreground break-all">
              {props.snapshot.primary || t('agentModels.none')}
            </p>
          </div>

          <div className="modal-section-surface space-y-2 rounded-2xl border p-4">
            <Label htmlFor="agent-fallbacks" className="text-[14px] font-bold text-foreground/80">
              {t('agentModels.dialog.fallbacksLabel')}
            </Label>
            <textarea
              id="agent-fallbacks"
              value={fallbacksText}
              onChange={(event) => setFallbacksText(event.target.value)}
              placeholder={t('agentModels.dialog.fallbacksPlaceholder')}
              className="modal-field-surface min-h-32 w-full rounded-xl border px-3 py-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm"
            />
            <p className="text-[12px] text-muted-foreground">
              {t('agentModels.dialog.fallbacksHelp')}
            </p>
          </div>

          <div className="modal-section-surface space-y-3 rounded-2xl border p-4">
            <div>
              <p className="text-[14px] font-bold text-foreground/80">{t('agentModels.dialog.available')}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{t('agentModels.dialog.availableHelp')}</p>
            </div>
            <div className="space-y-3">
              {props.snapshot.availableModels.map((provider) => (
                <div key={provider.providerId} className="modal-field-surface rounded-xl border p-3 shadow-sm">
                  <p className="text-[13px] font-semibold text-foreground">{provider.providerName}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {provider.modelRefs.map((modelRef) => (
                      <code
                        key={modelRef}
                        className="rounded-lg bg-black/5 px-2.5 py-1 text-[12px] text-foreground dark:bg-white/5"
                      >
                        {modelRef}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <Button
              onClick={() => void props.onSave(normalizedFallbacks)}
              className="modal-primary-button px-8"
              disabled={props.saving}
            >
              {props.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('agentModels.dialog.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}

export function ModelsSettingsSection() {
  const { t } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<AgentDefaultModelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFallbackDialog, setShowFallbackDialog] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApiFetch<AgentDefaultModelSnapshot>('/api/agents/default-model');
      setSnapshot(result);
    } catch (error) {
      toast.error(`${t('agentModels.toast.failedLoad')}: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
    void loadSnapshot();
  }, [loadSnapshot]);

  const handleSaveFallbacks = async (fallbacks: string[]) => {
    setSaving(true);
    try {
      const result = await hostApiFetch<AgentDefaultModelSnapshot>('/api/agents/default-model', {
        method: 'PUT',
        body: JSON.stringify({ fallbacks }),
      });
      setSnapshot(result);
      setShowFallbackDialog(false);
      toast.success(t('agentModels.toast.saved'));
    } catch (error) {
      toast.error(`${t('agentModels.toast.failedSave')}: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-8">
      <Card className="bg-black/5 dark:bg-white/5 border border-transparent rounded-3xl shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-2xl font-normal tracking-tight">
            <Settings2 className="h-5 w-5" />
            {t('agentModels.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !snapshot ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19]">
                  <p className="text-[13px] font-medium text-muted-foreground">{t('agentModels.primary')}</p>
                  <p className="mt-2 font-mono text-[13px] text-foreground break-all">
                    {snapshot.primary || t('agentModels.none')}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19]">
                  <p className="text-[13px] font-medium text-muted-foreground">{t('agentModels.fallbacks')}</p>
                  <p className="mt-2 font-mono text-[13px] text-foreground break-all">
                    {snapshot.fallbacks.length > 0 ? snapshot.fallbacks.join(', ') : t('agentModels.none')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => setShowFallbackDialog(true)}
                  className="rounded-full px-5 h-9 bg-black/90 hover:bg-black text-white dark:bg-white dark:text-black dark:hover:bg-white/90"
                >
                  {t('agentModels.configureFallbacks')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void loadSnapshot()}
                  className="rounded-full px-5 h-9 border-black/10 bg-transparent hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  {t('agentModels.refresh')}
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('agentModels.primaryHelp')}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <ProvidersSettings />

      {snapshot && showFallbackDialog && (
        <AgentFallbackDialog
          snapshot={snapshot}
          saving={saving}
          onClose={() => setShowFallbackDialog(false)}
          onSave={handleSaveFallbacks}
        />
      )}
    </div>
  );
}

export default ModelsSettingsSection;
