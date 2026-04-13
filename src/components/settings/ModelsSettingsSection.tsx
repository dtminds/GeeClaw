/**
 * Model configuration settings section.
 */
import {
  AiImageIcon,
  AiVideoIcon,
  AiVisionRecognitionIcon,
  ChatBotIcon,
  Pdf02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, RefreshCw, Save, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { trackUiEvent } from '@/lib/telemetry';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface AvailableProviderModelGroup {
  providerId: string;
  providerName: string;
  modelRefs: string[];
}

interface AgentModelSlotState {
  configured: boolean;
  primary: string | null;
  fallbacks: string[];
}

interface AgentDefaultModelSnapshot {
  success?: boolean;
  model: AgentModelSlotState;
  imageModel: AgentModelSlotState;
  pdfModel: AgentModelSlotState;
  imageGenerationModel: AgentModelSlotState;
  videoGenerationModel: AgentModelSlotState;
  availableModels: AvailableProviderModelGroup[];
}

type ModelSlotKey =
  | 'model'
  | 'imageModel'
  | 'pdfModel'
  | 'imageGenerationModel'
  | 'videoGenerationModel';

type ModelConfigDraft = Pick<
  AgentDefaultModelSnapshot,
  'model' | 'imageModel' | 'pdfModel' | 'imageGenerationModel' | 'videoGenerationModel'
>;

const SLOT_ORDER: ModelSlotKey[] = [
  'model',
  'imageModel',
  'pdfModel',
  'imageGenerationModel',
  'videoGenerationModel',
];

const MAX_FALLBACK_MODELS = 3;
const SLOT_ICONS = {
  model: ChatBotIcon,
  imageModel: AiVisionRecognitionIcon,
  pdfModel: Pdf02Icon,
  imageGenerationModel: AiImageIcon,
  videoGenerationModel: AiVideoIcon,
} satisfies Record<ModelSlotKey, Parameters<typeof HugeiconsIcon>[0]['icon']>;

function cloneDraft(snapshot: AgentDefaultModelSnapshot): ModelConfigDraft {
  return {
    model: { ...snapshot.model, fallbacks: [...snapshot.model.fallbacks] },
    imageModel: { ...snapshot.imageModel, fallbacks: [...snapshot.imageModel.fallbacks] },
    pdfModel: { ...snapshot.pdfModel, fallbacks: [...snapshot.pdfModel.fallbacks] },
    imageGenerationModel: { ...snapshot.imageGenerationModel, fallbacks: [...snapshot.imageGenerationModel.fallbacks] },
    videoGenerationModel: { ...snapshot.videoGenerationModel, fallbacks: [...snapshot.videoGenerationModel.fallbacks] },
  };
}

function slotsEqual(left: ModelConfigDraft, right: ModelConfigDraft): boolean {
  return SLOT_ORDER.every((key) => {
    const leftSlot = left[key];
    const rightSlot = right[key];
    return leftSlot.configured === rightSlot.configured
      && leftSlot.primary === rightSlot.primary
      && leftSlot.fallbacks.length === rightSlot.fallbacks.length
      && leftSlot.fallbacks.every((value, index) => value === rightSlot.fallbacks[index]);
  });
}

function buildAvailableModelRefs(groups: AvailableProviderModelGroup[]): string[] {
  return groups.flatMap((group) => group.modelRefs);
}

function ModelSlotEditor(props: {
  slotKey: ModelSlotKey;
  slot: AgentModelSlotState;
  availableModels: AvailableProviderModelGroup[];
  optional: boolean;
  onChange: (next: AgentModelSlotState) => void;
}) {
  const { t } = useTranslation('settings');
  const allModelRefs = useMemo(
    () => buildAvailableModelRefs(props.availableModels),
    [props.availableModels],
  );
  const fallbackCandidates = useMemo(
    () => allModelRefs.filter((modelRef) => modelRef !== props.slot.primary),
    [allModelRefs, props.slot.primary],
  );

  const toggleFallback = (modelRef: string) => {
    const selected = props.slot.fallbacks.includes(modelRef);
    if (!selected && props.slot.fallbacks.length >= MAX_FALLBACK_MODELS) {
      return;
    }
    const nextFallbacks = props.slot.fallbacks.includes(modelRef)
      ? props.slot.fallbacks.filter((ref) => ref !== modelRef)
      : [...props.slot.fallbacks, modelRef];
    props.onChange({
      ...props.slot,
      configured: true,
      fallbacks: nextFallbacks,
    });
  };

  const handlePrimaryChange = (value: string) => {
    const primary = value || null;
    const filteredFallbacks = primary
      ? props.slot.fallbacks.filter((ref) => ref !== primary)
      : [];
    props.onChange({
      ...props.slot,
      configured: props.optional ? true : Boolean(primary || filteredFallbacks.length > 0),
      primary,
      fallbacks: filteredFallbacks,
    });
  };

  const sectionTitle = t(`agentModels.sections.${props.slotKey}.title`);
  const sectionDescription = t(`agentModels.sections.${props.slotKey}.description`);
  const fallbackSummary = props.slot.fallbacks.length > 0
    ? props.slot.fallbacks.join(', ')
    : !props.slot.primary
      ? t('agentModels.selectPrimaryFirst')
    : t('agentModels.none');

  return (
    <div className="modal-section-surface rounded-3xl border p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-2 text-[18px] font-semibold text-foreground">
            <HugeiconsIcon
              icon={SLOT_ICONS[props.slotKey]}
              size={16}
              strokeWidth={1.8}
              data-testid={`model-slot-icon-${props.slotKey}`}
              className="shrink-0 text-muted-foreground"
            />
            <span>{sectionTitle}</span>
          </h3>
          <p className="text-[13px] leading-6 text-muted-foreground">{sectionDescription}</p>
        </div>
        {props.optional ? (
          <div className="w-full md:w-[220px]">
            <SegmentedControl
              ariaLabel={sectionTitle}
              value={props.slot.configured ? 'custom' : 'auto'}
              onValueChange={(nextMode) => {
                if (nextMode === 'auto') {
                  props.onChange({
                    configured: false,
                    primary: null,
                    fallbacks: [],
                  });
                  return;
                }

                props.onChange({
                  ...props.slot,
                  configured: true,
                });
              }}
              options={[
                { value: 'auto', label: t('agentModels.mode.auto') },
                { value: 'custom', label: t('agentModels.mode.custom') },
              ]}
              fullWidth
            />
          </div>
        ) : null}
      </div>

      {!props.optional || props.slot.configured ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-muted-foreground">
                {t('agentModels.primary')}
              </label>
              <div className="relative">
                <select
                  value={props.slot.primary ?? ''}
                  onChange={(event) => handlePrimaryChange(event.target.value)}
                  className="modal-field-surface h-[44px] w-full appearance-none rounded-xl border px-3 pr-10 text-[13px] text-foreground outline-none"
                >
                  <option value="" disabled hidden>{t('agentModels.selectPrimary')}</option>
                  {props.availableModels.map((group) => (
                    <optgroup key={group.providerId} label={group.providerName}>
                      {group.modelRefs.map((modelRef) => (
                        <option key={modelRef} value={modelRef}>{modelRef}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground">
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[13px] font-medium text-muted-foreground">
                {t('agentModels.fallbacks')}
              </label>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={t('agentModels.selectFallbacks')}
                    disabled={!props.slot.primary || fallbackCandidates.length === 0}
                    className="modal-field-surface relative h-[44px] w-full rounded-xl border px-3 pr-10 text-[13px] text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="block min-w-0 truncate text-left font-mono text-[12px] leading-[42px]">
                      {fallbackSummary}
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground">
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-[130] min-w-[320px] max-w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none data-[side=bottom]:animate-in data-[side=bottom]:slide-in-from-top-2 dark:border-white/10 dark:bg-card"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                    }}
                  >
                    <DropdownMenu.Label className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {t('agentModels.fallbackLimit')}
                    </DropdownMenu.Label>
                    <DropdownMenu.Separator className="mx-2 my-1 h-px bg-black/8 dark:bg-white/10" />
                    {fallbackCandidates.map((modelRef) => {
                      const selected = props.slot.fallbacks.includes(modelRef);
                      const disabled = !selected && props.slot.fallbacks.length >= MAX_FALLBACK_MODELS;
                      return (
                        <DropdownMenu.CheckboxItem
                          key={modelRef}
                          checked={selected}
                          disabled={disabled}
                          onSelect={(event) => {
                            event.preventDefault();
                          }}
                          onCheckedChange={() => toggleFallback(modelRef)}
                          className="relative mx-1 flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 pl-8 text-[13px] text-foreground outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent/60"
                        >
                          <DropdownMenu.ItemIndicator className="absolute left-3 inline-flex items-center justify-center">
                            <Check className="h-3.5 w-3.5" />
                          </DropdownMenu.ItemIndicator>
                          <span className="truncate font-mono text-[12px]">{modelRef}</span>
                        </DropdownMenu.CheckboxItem>
                      );
                    })}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ModelsSettingsSection() {
  const { t } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<AgentDefaultModelSnapshot | null>(null);
  const [draft, setDraft] = useState<ModelConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApiFetch<AgentDefaultModelSnapshot>('/api/agents/default-model');
      setSnapshot(result);
      setDraft(cloneDraft(result));
    } catch (error) {
      toast.error(`${t('agentModels.toast.failedLoad')}: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    trackUiEvent('model_config.page_viewed');
    void loadSnapshot();
  }, [loadSnapshot]);

  const availableModels = snapshot?.availableModels ?? [];
  const hasAvailableModels = availableModels.some((group) => group.modelRefs.length > 0);
  const hasPendingChanges = Boolean(snapshot && draft && !slotsEqual(cloneDraft(snapshot), draft));

  const updateSlot = (slotKey: ModelSlotKey, nextSlot: AgentModelSlotState) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        [slotKey]: nextSlot,
      };
    });
  };

  const handleSave = async () => {
    if (!draft) {
      return;
    }

    setSaving(true);
    try {
      const result = await hostApiFetch<AgentDefaultModelSnapshot>('/api/agents/default-model', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      setSnapshot(result);
      setDraft(cloneDraft(result));
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
        <CardHeader className="flex flex-row items-start justify-between gap-4 p-0 pb-3">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-2xl font-normal tracking-tight">
              <Settings2 className="h-5 w-5" />
              {t('agentModels.title')}
            </CardTitle>
            <CardDescription className="text-[13px] leading-6 text-muted-foreground">
              {t('agentModels.description')}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={() => void loadSnapshot()}
              disabled={loading}
              className="surface-hover rounded-full border-black/10 bg-transparent px-5 h-9 dark:border-white/10"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('agentModels.refresh')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={loading || saving || !draft || !hasPendingChanges || (!draft.model.primary && draft.model.configured)}
              className="rounded-full px-5 h-9 bg-black/90 hover:bg-black text-white dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('agentModels.save')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-0 pb-0">
          {loading || !snapshot || !draft ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !hasAvailableModels ? (
            <div className="rounded-3xl border border-dashed border-black/8 bg-black/[0.02] p-6 text-[14px] leading-6 text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
              {t('agentModels.emptyState')}
            </div>
          ) : (
            <div className="space-y-4">
              <ModelSlotEditor
                slotKey="model"
                slot={draft.model}
                availableModels={availableModels}
                optional={false}
                onChange={(nextSlot) => updateSlot('model', nextSlot)}
              />
              <ModelSlotEditor
                slotKey="imageModel"
                slot={draft.imageModel}
                availableModels={availableModels}
                optional
                onChange={(nextSlot) => updateSlot('imageModel', nextSlot)}
              />
              <ModelSlotEditor
                slotKey="pdfModel"
                slot={draft.pdfModel}
                availableModels={availableModels}
                optional
                onChange={(nextSlot) => updateSlot('pdfModel', nextSlot)}
              />
              <ModelSlotEditor
                slotKey="imageGenerationModel"
                slot={draft.imageGenerationModel}
                availableModels={availableModels}
                optional
                onChange={(nextSlot) => updateSlot('imageGenerationModel', nextSlot)}
              />
              <ModelSlotEditor
                slotKey="videoGenerationModel"
                slot={draft.videoGenerationModel}
                availableModels={availableModels}
                optional
                onChange={(nextSlot) => updateSlot('videoGenerationModel', nextSlot)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ModelsSettingsSection;
