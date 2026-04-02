import { useEffect, useState } from 'react';
import type { QuickActionContext } from '@shared/quick-actions';
import { toast } from 'sonner';
import { QuickActionWindow } from '@/components/quick-actions/QuickActionWindow';
import {
  closeQuickActionWindow,
  copyQuickActionResult,
  getQuickActionLastContext,
  pasteQuickActionResult,
  runQuickAction,
  subscribeQuickActionInvoked,
} from '@/lib/quick-actions';
import { useSettingsStore } from '@/stores/settings';

function formatInvocationSource(source: QuickActionContext['source']): string {
  return source === 'shortcut' ? 'Triggered from shortcut' : 'Triggered from app';
}

export function QuickActionPage() {
  const [context, setContext] = useState<QuickActionContext | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const quickActionSettings = useSettingsStore((state) => state.quickActions);

  useEffect(() => {
    let cancelled = false;

    void getQuickActionLastContext().then((payload) => {
      if (!cancelled) {
        setContext(payload ?? null);
      }
    });

    const unsubscribe = subscribeQuickActionInvoked((payload) => {
      setContext(payload ?? null);
      setResult('');
      setError(null);
      setRunning(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void closeQuickActionWindow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const availableActions = quickActionSettings.actions.filter((action) => action.enabled);
  const windowActions = availableActions.some((action) => action.id === context?.action.id)
    ? availableActions
    : context
      ? [context.action, ...availableActions.filter((action) => action.id !== context.action.id)]
      : availableActions;
  const windowKey = context ? `${context.invokedAt}:${context.actionId}` : 'quick-action-idle';

  const handleRun = async (actionId: string) => {
    if (!context) return;

    setRunning(true);
    setError(null);

    try {
      const next = await runQuickAction(actionId, context.input);
      if (!next.success) {
        setResult('');
        setError(next.message ?? `Quick action failed: ${next.reason}`);
        return;
      }

      setResult(next.text);
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;

    await copyQuickActionResult(result);
    toast.success('Quick action result copied');
    if (quickActionSettings.closeOnCopy) {
      await closeQuickActionWindow();
    }
  };

  const handlePaste = async () => {
    if (!result) return;

    const pasteResult = await pasteQuickActionResult(result);
    toast.success(pasteResult.pasted ? 'Quick action result pasted' : 'Quick action result copied to clipboard');
    if (quickActionSettings.closeOnCopy) {
      await closeQuickActionWindow();
    }
  };

  return (
    <div className="min-h-screen bg-transparent p-3 text-foreground">
      <QuickActionWindow
        key={windowKey}
        actions={windowActions}
        initialActionId={context?.actionId ?? windowActions[0]?.id ?? 'translate'}
        input={context?.input ?? null}
        running={running}
        result={result}
        error={error}
        subtitle={context ? formatInvocationSource(context.source) : 'Waiting for a quick action to be invoked.'}
        onRun={(actionId) => {
          void handleRun(actionId);
        }}
        onCopy={() => {
          void handleCopy();
        }}
        onPaste={() => {
          void handlePaste();
        }}
        onClose={() => {
          void closeQuickActionWindow();
        }}
      />
    </div>
  );
}
