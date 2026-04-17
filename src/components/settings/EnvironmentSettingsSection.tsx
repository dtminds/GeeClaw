import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApiFetch } from '@/lib/host-api';
import { toUserMessage } from '@/lib/api-client';
import { validateEnvironmentEntries } from '@/lib/environment-entry-validation';

interface ManagedAppEnvironmentEntry {
  key: string;
  value: string;
}

interface EditableManagedAppEnvironmentEntry extends ManagedAppEnvironmentEntry {
  id: string;
}

interface ManagedAppEnvironmentResponse {
  entries: ManagedAppEnvironmentEntry[];
}

let nextEnvironmentEntryId = 0;

function createEditableEntry(entry?: Partial<ManagedAppEnvironmentEntry>): EditableManagedAppEnvironmentEntry {
  return {
    id: `managed-env-${nextEnvironmentEntryId++}`,
    key: entry?.key ?? '',
    value: entry?.value ?? '',
  };
}

function buildValidationMessages(
  entries: EditableManagedAppEnvironmentEntry[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const { emptyRows, incompleteRows, duplicateKeys } = validateEnvironmentEntries(entries);

  return [
    ...emptyRows.map((row) => t('environment.validation.empty', { row })),
    ...incompleteRows.map((row) => t('environment.validation.incomplete', { row })),
    ...duplicateKeys.map((key) => t('environment.validation.duplicate', { key })),
  ];
}

export function EnvironmentSettingsSection() {
  const { t } = useTranslation('settings');
  const [entries, setEntries] = useState<EditableManagedAppEnvironmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const showInitialLoading = loading && entries.length === 0;
  const loadFailedLabel = t('environment.toast.loadFailed');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const response = await hostApiFetch<ManagedAppEnvironmentResponse>('/api/settings/environment');
        if (!cancelled) {
          setEntries(Array.isArray(response.entries)
            ? response.entries.map((entry) => createEditableEntry(entry))
            : []);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`${loadFailedLabel}: ${toUserMessage(error)}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadFailedLabel]);

  const handleAddEntry = () => {
    setValidationMessages([]);
    setEntries((current) => [...current, createEditableEntry()]);
  };

  const handleUpdateEntry = (
    index: number,
    field: keyof ManagedAppEnvironmentEntry,
    value: string,
  ) => {
    setValidationMessages([]);
    setEntries((current) => current.map((entry, entryIndex) => (
      entryIndex === index
        ? { ...entry, [field]: value }
        : entry
    )));
  };

  const handleRemoveEntry = (index: number) => {
    setValidationMessages([]);
    setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  };

  const handleSave = async () => {
    const nextValidationMessages = buildValidationMessages(entries, t);
    if (nextValidationMessages.length > 0) {
      setValidationMessages(nextValidationMessages);
      return;
    }

    setSaving(true);
    try {
      const nextEntries = entries
        .map((entry) => ({
          id: entry.id,
          key: entry.key.trim(),
          value: entry.value,
        }))
        .filter((entry) => entry.key && entry.value.trim());

      await hostApiFetch('/api/settings/environment', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entries: nextEntries.map(({ key, value }) => ({ key, value })),
        }),
      });

      setValidationMessages([]);
      setEntries(nextEntries);
      toast.success(t('environment.toast.saved'));
    } catch (error) {
      toast.error(`${t('environment.toast.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h2 className="modal-title">{t('environment.title')}</h2>
        <p className="modal-description">{t('environment.description')}</p>
      </div>

      <section className="modal-section-surface rounded-3xl border p-5">
        <div className="flex flex-col gap-5">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">{t('environment.runtime.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('environment.runtime.description')}</p>
            <p className="text-sm text-muted-foreground">{t('environment.runtime.restartHint')}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => setShowValues((current) => !current)}
            >
              {showValues ? (
                <EyeOff className="mr-2 h-4 w-4" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              {showValues ? t('environment.list.hideValues') : t('environment.list.showValues')}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={handleAddEntry}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('environment.list.add')}
            </Button>
          </div>

          <div className="space-y-3">
            {showInitialLoading ? (
              <div className="modal-field-surface rounded-2xl border px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : null}

            {!showInitialLoading && entries.length === 0 ? (
              <div className="modal-field-surface rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                {t('environment.list.empty')}
              </div>
            ) : null}

            {entries.map((entry, index) => (
              <div key={entry.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  value={entry.key}
                  onChange={(event) => handleUpdateEntry(index, 'key', event.target.value)}
                  className="modal-field-surface h-11 flex-1 font-mono text-[13px]"
                  placeholder={t('environment.list.keyPlaceholder')}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Input
                  value={entry.value}
                  onChange={(event) => handleUpdateEntry(index, 'value', event.target.value)}
                  className="modal-field-surface h-11 flex-1 font-mono text-[13px]"
                  placeholder={t('environment.list.valuePlaceholder')}
                  type={showValues ? 'text' : 'password'}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-2xl text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleRemoveEntry(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {validationMessages.length > 0 ? (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-4 text-sm text-amber-950 dark:text-amber-100">
              <p className="font-medium">{t('environment.validation.title')}</p>
              <ul className="mt-2 space-y-1 text-sm leading-6">
                {validationMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              className="rounded-full"
              onClick={() => void handleSave()}
              disabled={loading || saving}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('environment.list.save')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default EnvironmentSettingsSection;
