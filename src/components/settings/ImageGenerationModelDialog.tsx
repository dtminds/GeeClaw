import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ImageGenerationProviderGroup {
  providerId: string;
  providerName: string;
  authConfigured: boolean;
  defaultModelRef: string | null;
  modelRefs: string[];
  capabilities: {
    generate: {
      maxCount?: number;
      supportsSize?: boolean;
      supportsAspectRatio?: boolean;
      supportsResolution?: boolean;
    };
    edit: {
      enabled: boolean;
      maxCount?: number;
      maxInputImages?: number;
      supportsSize?: boolean;
      supportsAspectRatio?: boolean;
      supportsResolution?: boolean;
    };
    geometry?: {
      sizes?: string[];
      aspectRatios?: string[];
      resolutions?: Array<'1K' | '2K' | '4K'>;
    };
  };
}

export interface ImageGenerationModelSnapshot {
  mode: 'auto' | 'manual';
  primary: string | null;
  fallbacks: string[];
  effective: {
    source: 'manual' | 'inferred' | 'none';
    primary: string | null;
  };
  availableProviders: ImageGenerationProviderGroup[];
}

export interface ImageGenerationModelSaveInput {
  mode: 'auto' | 'manual';
  primary: string | null;
  fallbacks: string[];
}

export function ImageGenerationModelDialog(props: {
  open: boolean;
  snapshot: ImageGenerationModelSnapshot | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: ImageGenerationModelSaveInput) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [primary, setPrimary] = useState<string | null>(null);
  const [fallbacks, setFallbacks] = useState<string[]>([]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setMode(props.snapshot?.mode ?? 'auto');
    setPrimary(props.snapshot?.primary ?? null);
    setFallbacks(props.snapshot?.fallbacks ?? []);
  }, [props.open, props.snapshot]);

  const availableModels = props.snapshot?.availableProviders.flatMap((provider) => provider.modelRefs) ?? [];
  const fallbackCandidates = availableModels.filter((modelRef) => modelRef !== primary);

  const toggleFallback = (modelRef: string) => {
    setFallbacks((current) => (
      current.includes(modelRef)
        ? current.filter((entry) => entry !== modelRef)
        : [...current, modelRef]
    ));
  };

  const handleSave = async () => {
    await props.onSave({
      mode,
      primary: mode === 'manual' ? primary : null,
      fallbacks: mode === 'manual' ? fallbacks : [],
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="modal-card-surface w-[min(860px,calc(100vw-2rem))] max-w-[860px] overflow-hidden rounded-[28px] border p-0">
        <div className="flex flex-col gap-0">
          <div className="border-b border-black/6 px-6 py-5 dark:border-white/10">
            <DialogHeader className="pr-10">
              <DialogTitle className="modal-title">
                {t('imageGenerationModel.dialog.title')}
              </DialogTitle>
              <DialogDescription className="modal-description mt-2">
                {t('imageGenerationModel.dialog.description')}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="modal-section-surface rounded-2xl border p-4">
              <p className="text-[13px] font-medium text-muted-foreground">
                {t('imageGenerationModel.dialog.currentMode')}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="modal-field-surface flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3">
                  <input
                    type="radio"
                    name="image-generation-mode"
                    checked={mode === 'auto'}
                    onChange={() => setMode('auto')}
                    aria-label={t('imageGenerationModel.dialog.modeAuto')}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {t('imageGenerationModel.dialog.modeAuto')}
                  </span>
                </label>
                <label className="modal-field-surface flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3">
                  <input
                    type="radio"
                    name="image-generation-mode"
                    checked={mode === 'manual'}
                    onChange={() => setMode('manual')}
                    aria-label={t('imageGenerationModel.dialog.modeManual')}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {t('imageGenerationModel.dialog.modeManual')}
                  </span>
                </label>
              </div>
            </div>

            {mode === 'manual' && (
              <>
                <div className="modal-section-surface rounded-2xl border p-4">
                  <p className="text-[13px] font-medium text-muted-foreground">
                    {t('imageGenerationModel.dialog.primary')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(primary ? [primary] : availableModels).map((modelRef) => {
                      const selected = primary === modelRef;
                      return (
                        <Button
                          key={modelRef}
                          type="button"
                          variant={selected ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => {
                            setPrimary(modelRef);
                            setFallbacks((current) => current.filter((entry) => entry !== modelRef));
                          }}
                          className="rounded-full font-mono text-[12px]"
                        >
                          {modelRef}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {primary && fallbackCandidates.length > 0 && (
                  <div className="modal-section-surface rounded-2xl border p-4">
                    <p className="text-[13px] font-medium text-muted-foreground">
                      {t('imageGenerationModel.dialog.fallbacks')}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {fallbackCandidates.map((modelRef) => {
                        const selected = fallbacks.includes(modelRef);
                        return (
                          <Button
                            key={modelRef}
                            type="button"
                            variant={selected ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => toggleFallback(modelRef)}
                            className="rounded-full font-mono text-[12px]"
                          >
                            {modelRef}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="modal-footer px-0 pb-0">
              <Button
                type="button"
                onClick={() => void handleSave()}
                className="modal-primary-button"
                disabled={props.saving || (mode === 'manual' && !primary)}
              >
                {t('imageGenerationModel.dialog.save')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ImageGenerationModelDialog;
