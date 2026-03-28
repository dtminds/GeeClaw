/**
 * Models settings section
 * Lives inside the settings modal workspace.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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

function AgentFallbackDialog(props: {
  snapshot: AgentDefaultModelSnapshot;
  saving: boolean;
  onClose: () => void;
  onSave: (fallbacks: string[]) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [fallbacks, setFallbacks] = useState<string[]>(() => [...props.snapshot.fallbacks]);

  const toggleModel = (modelRef: string) => {
    setFallbacks((prev) =>
      prev.includes(modelRef) ? prev.filter((m) => m !== modelRef) : [...prev, modelRef],
    );
  };

  return createPortal(
    <div className="overlay-backdrop fixed inset-0 z-[140] flex items-center justify-center p-4">
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

          {/* Selected fallback tags */}
          <div className="modal-section-surface space-y-3 rounded-2xl border p-4">
            <p className="text-[14px] font-bold text-foreground/80">{t('agentModels.dialog.fallbacksLabel')}</p>
            <div className="min-h-10 flex flex-wrap gap-2">
              {fallbacks.length === 0 ? (
                <p className="text-[12px] text-muted-foreground self-center">{t('agentModels.dialog.fallbacksEmpty')}</p>
              ) : (
                fallbacks.map((modelRef) => (
                  <span
                    key={modelRef}
                    className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-black/5 pl-3 pr-1.5 py-1 font-mono text-[12px] text-foreground dark:border-white/10 dark:bg-white/10"
                  >
                    {modelRef}
                    <button
                      type="button"
                      onClick={() => toggleModel(modelRef)}
                      className="flex items-center justify-center rounded-full w-4 h-4 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                      aria-label={`Remove ${modelRef}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Available models — click to add */}
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
                    {provider.modelRefs.map((modelRef) => {
                      const selected = fallbacks.includes(modelRef);
                      return (
                        <button
                          key={modelRef}
                          type="button"
                          onClick={() => toggleModel(modelRef)}
                          className={[
                            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[12px] transition-colors',
                            selected
                              ? 'bg-black/90 text-white dark:bg-white dark:text-black'
                              : 'surface-muted text-foreground hover:bg-black/10 dark:hover:bg-white/10',
                          ].join(' ')}
                          aria-pressed={selected}
                        >
                          {selected && <Check className="h-3 w-3 shrink-0" />}
                          {modelRef}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <Button
              onClick={() => void props.onSave(fallbacks)}
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
    <div className="flex min-h-0 flex-col gap-4">
      <Card className="surface-muted rounded-3xl border border-transparent shadow-none">
        <CardHeader className="p-0 pb-3 flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-2xl font-normal tracking-tight">
            <Settings2 className="h-5 w-5" />
            {t('agentModels.title')}
          </CardTitle>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              onClick={() => setShowFallbackDialog(true)}
              disabled={loading || !snapshot}
              className="rounded-full px-5 h-9 bg-black/90 hover:bg-black text-white dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {t('agentModels.configureFallbacks')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void loadSnapshot()}
              disabled={loading}
              className="surface-hover rounded-full border-black/10 bg-transparent px-5 h-9 dark:border-white/10"
            >
              {t('agentModels.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-0 pb-0">
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
