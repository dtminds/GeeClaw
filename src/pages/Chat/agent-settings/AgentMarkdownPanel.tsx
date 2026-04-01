import { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface AgentMarkdownPanelProps {
  title: string;
  fileLabel: string;
  helperText?: string;
  value: string;
  placeholder?: string;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  errorLabel?: string;
  exists?: boolean;
  lockedMessage?: string | null;
  readOnly?: boolean;
  saving?: boolean;
  canSave?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  fieldId?: string;
}

export function AgentMarkdownPanel({
  title,
  fileLabel,
  helperText,
  value,
  placeholder,
  loading = false,
  loadingLabel,
  error,
  errorLabel,
  exists = true,
  lockedMessage,
  readOnly = false,
  saving = false,
  canSave = false,
  onChange,
  onSave,
  fieldId,
}: AgentMarkdownPanelProps) {
  const { t } = useTranslation(['chat', 'common']);
  const generatedTextareaId = useId();
  const textareaId = fieldId ?? generatedTextareaId;
  const showLoading = Boolean(loading);
  const showError = Boolean(error);
  const showCreateBadge = !exists;
  const inputDisabled = readOnly || saving || showLoading;
  const saveDisabled = !onSave || !canSave || saving || readOnly || showLoading;

  return (
    <section className="flex h-full min-h-0 flex-col px-1">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {helperText ? (
          <p className="text-xs text-muted-foreground">{helperText}</p>
        ) : null}
      </header>

      {lockedMessage ? (
        <div className="modal-section-surface mt-3 rounded-[20px] px-4 py-3 text-sm text-muted-foreground">
          {lockedMessage}
        </div>
      ) : null}

      <div
        data-testid="agent-settings-panel-body"
        className={cn(
          'modal-field-surface mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border p-4 text-sm text-foreground',
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
                {fileLabel}
              </Label>
              {showCreateBadge ? (
                <span className="rounded-full border border-black/10 px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {t('toolbar.persona.createOnSave')}
                </span>
              ) : null}
            </div>
            <Textarea
              id={textareaId}
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              placeholder={placeholder}
              disabled={inputDisabled}
              className={cn(
                'min-h-[260px] flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-foreground shadow-none outline-none ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                inputDisabled && 'text-muted-foreground',
              )}
            />
          </div>
        )}
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
