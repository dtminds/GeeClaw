import { DEFAULT_QUICK_ACTIONS, type QuickActionDefinition, type QuickActionKind } from '@shared/quick-actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';

const BUILTIN_ACTION_IDS = new Set(DEFAULT_QUICK_ACTIONS.actions.map((action) => action.id));

function createCustomAction(index: number): QuickActionDefinition {
  return {
    id: `custom-${Date.now()}-${index}`,
    title: `Custom ${index + 1}`,
    kind: 'customPrompt',
    shortcut: '',
    enabled: true,
    outputMode: 'copy',
    promptTemplate: 'Rewrite the following text for the intended use case. Return only the final answer:\n\n{{input}}',
  };
}

export function QuickActionsSettingsSection() {
  const { t } = useTranslation('settings');
  const quickActions = useSettingsStore((state) => state.quickActions);
  const setQuickActions = useSettingsStore((state) => state.setQuickActions);

  const updateAction = (actionId: string, patch: Partial<QuickActionDefinition>) => {
    setQuickActions({
      ...quickActions,
      actions: quickActions.actions.map((action) => (
        action.id === actionId ? { ...action, ...patch } : action
      )),
    });
  };

  const removeAction = (actionId: string) => {
    setQuickActions({
      ...quickActions,
      actions: quickActions.actions.filter((action) => action.id !== actionId),
    });
  };

  const addCustomAction = () => {
    setQuickActions({
      ...quickActions,
      actions: [...quickActions.actions, createCustomAction(quickActions.actions.length)],
    });
  };

  const kindOptions: Array<{ value: QuickActionKind; label: string }> = [
    { value: 'translate', label: t('quickActions.kinds.translate') },
    { value: 'reply', label: t('quickActions.kinds.reply') },
    { value: 'lookup', label: t('quickActions.kinds.lookup') },
    { value: 'customPrompt', label: t('quickActions.kinds.customPrompt') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
          {t('quickActions.title')}
        </h2>
        <p className="max-w-3xl text-base text-muted-foreground">
          {t('quickActions.description')}
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{t('quickActions.preferencesTitle')}</CardTitle>
          <CardDescription>{t('quickActions.preferencesDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="modal-section-surface flex items-center justify-between rounded-2xl border p-4">
            <div className="space-y-1">
              <Label>{t('quickActions.closeOnCopy')}</Label>
              <p className="text-sm text-muted-foreground">{t('quickActions.closeOnCopyDescription')}</p>
            </div>
            <Switch
              checked={quickActions.closeOnCopy}
              onCheckedChange={(value) => setQuickActions({ ...quickActions, closeOnCopy: value })}
            />
          </div>

          <div className="modal-section-surface flex items-center justify-between rounded-2xl border p-4">
            <div className="space-y-1">
              <Label>{t('quickActions.preferClipboardFallback')}</Label>
              <p className="text-sm text-muted-foreground">{t('quickActions.preferClipboardFallbackDescription')}</p>
            </div>
            <Switch
              checked={quickActions.preferClipboardFallback}
              onCheckedChange={(value) => setQuickActions({ ...quickActions, preferClipboardFallback: value })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t('quickActions.actionsTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('quickActions.actionsDescription')}</p>
        </div>
        <Button type="button" variant="outline" className="rounded-full" onClick={addCustomAction}>
          {t('quickActions.addCustom')}
        </Button>
      </div>

      <div className="space-y-4">
        {quickActions.actions.map((action) => (
          <Card key={action.id}>
            <CardContent className="grid gap-4 pt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{action.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {action.shortcut || t('quickActions.noShortcut')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={action.enabled} onCheckedChange={(value) => updateAction(action.id, { enabled: value })} />
                  {!BUILTIN_ACTION_IDS.has(action.id) && (
                    <Button type="button" variant="ghost" className="rounded-full" onClick={() => removeAction(action.id)}>
                      {t('quickActions.remove')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`quick-action-title-${action.id}`}>{t('quickActions.fields.title')}</Label>
                  <Input
                    id={`quick-action-title-${action.id}`}
                    value={action.title}
                    onChange={(event) => updateAction(action.id, { title: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quick-action-shortcut-${action.id}`}>{t('quickActions.fields.shortcut')}</Label>
                  <Input
                    id={`quick-action-shortcut-${action.id}`}
                    value={action.shortcut}
                    onChange={(event) => updateAction(action.id, { shortcut: event.target.value })}
                    placeholder="CommandOrControl+Shift+1"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quick-action-kind-${action.id}`}>{t('quickActions.fields.kind')}</Label>
                  <Select
                    id={`quick-action-kind-${action.id}`}
                    value={action.kind}
                    onChange={(event) => updateAction(action.id, { kind: event.target.value as QuickActionKind })}
                  >
                    {kindOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`quick-action-output-${action.id}`}>{t('quickActions.fields.outputMode')}</Label>
                  <Select
                    id={`quick-action-output-${action.id}`}
                    value={action.outputMode}
                    onChange={(event) => updateAction(action.id, { outputMode: event.target.value as QuickActionDefinition['outputMode'] })}
                  >
                    <option value="copy">{t('quickActions.outputModes.copy')}</option>
                    <option value="paste">{t('quickActions.outputModes.paste')}</option>
                  </Select>
                </div>
              </div>

              {action.kind === 'customPrompt' && (
                <div className="space-y-2">
                  <Label htmlFor={`quick-action-prompt-${action.id}`}>{t('quickActions.fields.promptTemplate')}</Label>
                  <Textarea
                    id={`quick-action-prompt-${action.id}`}
                    value={action.promptTemplate ?? ''}
                    onChange={(event) => updateAction(action.id, { promptTemplate: event.target.value })}
                    className="min-h-[132px]"
                    placeholder="Use {{input}} where the selected text should be inserted."
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
