import { useId } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { SoulTemplate, SoulTemplateId } from '@/pages/Chat/agent-settings/useAgentPersona';

interface AgentSoulPanelProps {
  title: string;
  description?: string;
  templates: SoulTemplate[];
  templateId: SoulTemplateId;
  value: string;
  placeholder?: string;
  helperText?: string;
  exists?: boolean;
  lockedMessage?: string | null;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  errorLabel?: string;
  saving?: boolean;
  canSave?: boolean;
  isEditable?: boolean;
  isLocked?: boolean;
  onTemplateChange: (templateId: SoulTemplateId) => void;
  onChange: (value: string) => void;
  onSave?: () => void;
  fieldId?: string;
}

export function AgentSoulPanel({
  title,
  description,
  templates,
  templateId,
  value,
  placeholder,
  helperText,
  exists = true,
  lockedMessage,
  loading = false,
  loadingLabel,
  error,
  errorLabel,
  saving = false,
  canSave = false,
  isEditable = true,
  isLocked = false,
  onTemplateChange,
  onChange,
  onSave,
  fieldId,
}: AgentSoulPanelProps) {
  const { t } = useTranslation(['chat', 'common']);
  const generatedTextareaId = useId();
  const textareaId = fieldId ?? generatedTextareaId;
  const showLoading = Boolean(loading);
  const showError = Boolean(error);
  const showCreateBadge = !exists;
  const templateDisabled = !isEditable || isLocked || showLoading || saving;
  const isCustom = templateId === 'custom';
  const readOnly = !isCustom || isLocked || !isEditable || saving;
  const inputDisabled = isLocked || !isEditable || showLoading || saving;
  const saveDisabled = !onSave || !canSave || saving || isLocked || !isEditable || showLoading;

  return (
    <section className="modal-section-surface flex h-full min-h-0 flex-col rounded-[24px] border p-5">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>

      {lockedMessage ? (
        <div className="modal-section-surface mt-3 rounded-[20px] px-4 py-3 text-sm text-muted-foreground">
          {lockedMessage}
        </div>
      ) : null}

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {templates.map((template) => {
            const selected = templateId === template.id;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onTemplateChange(template.id)}
                disabled={templateDisabled}
                aria-pressed={selected}
                aria-label={template.name}
                className={cn(
                  'group relative flex min-h-[86px] flex-col gap-2 rounded-2xl border px-3 py-2 text-left transition',
                  selected
                    ? 'border-primary bg-primary/10 text-foreground shadow-[0_14px_36px_-28px_rgba(15,23,42,0.25)]'
                    : 'border-black/10 text-foreground/80 hover:border-black/20 hover:bg-black/[0.02] dark:border-white/10 dark:hover:border-white/20',
                  templateDisabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="text-lg leading-none">{template.emoji}</span>
                <div className="space-y-1">
                  <p className={cn('text-sm font-semibold', selected ? 'text-foreground' : 'text-foreground/90')}>
                    {template.name}
                  </p>
                  <p className={cn('text-[11px] leading-4', selected ? 'text-foreground/70' : 'text-foreground/60')}>
                    {template.description}
                  </p>
                </div>
                {selected ? (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          data-testid="agent-settings-panel-body"
          className={cn(
            'modal-field-surface flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border p-4 text-sm text-foreground shadow-sm',
            (showLoading || showError) && 'items-center justify-center',
          )}
        >
          {showLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{loadingLabel || 'Loading...'}</span>
            </div>
          ) : showError ? (
            <div className="flex flex-1 flex-col items-start justify-center gap-2 text-destructive">
              <p className="text-sm font-semibold">{errorLabel || 'Failed to load.'}</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={textareaId} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                  SOUL.md
                </Label>
                {showCreateBadge ? (
                  <span className="rounded-full border border-black/10 px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {t('toolbar.persona.createOnSave')}
                  </span>
                ) : null}
              </div>
              {helperText ? (
                <p className="text-xs text-muted-foreground">{helperText}</p>
              ) : null}
              <Textarea
                id={textareaId}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                readOnly={readOnly}
                disabled={inputDisabled}
                className={cn(
                  'min-h-[220px] flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground shadow-none outline-none ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                  (readOnly || inputDisabled) && 'text-muted-foreground',
                )}
              />
            </div>
          )}
        </div>
      </div>

      {!showLoading && !showError ? (
        <div className="mt-4 flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onSave}
            disabled={saveDisabled}
            className="modal-field-surface surface-hover h-9 rounded-full px-4 text-[13px] font-semibold text-foreground/80 shadow-none"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('toolbar.persona.saving')}
              </>
            ) : (
              t('common:actions.save')
            )}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
