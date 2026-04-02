import { useMemo, useState } from 'react';
import type { QuickActionDefinition, QuickActionInput } from '@shared/quick-actions';
import { ModeTabs } from './ModeTabs';
import { InputPanel } from './InputPanel';
import { ResultPanel } from './ResultPanel';

interface QuickActionWindowProps {
  actions: QuickActionDefinition[];
  initialActionId: string;
  input: QuickActionInput | null;
  running?: boolean;
  result?: string;
  error?: string | null;
  subtitle?: string;
  onRun: (actionId: string) => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onClose?: () => void;
}

export function QuickActionWindow({
  actions,
  initialActionId,
  input,
  running = false,
  result,
  error,
  subtitle,
  onRun,
  onCopy,
  onPaste,
  onClose,
}: QuickActionWindowProps) {
  const firstActionId = actions[0]?.id ?? initialActionId;
  const [activeActionId, setActiveActionId] = useState(initialActionId || firstActionId);

  const activeAction = useMemo(
    () => actions.find((action) => action.id === activeActionId) ?? actions[0],
    [actions, activeActionId],
  );

  return (
    <div className="modal-card-surface flex min-h-[calc(100vh-1.5rem)] flex-col rounded-[28px] border p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="modal-title text-[18px]">Quick Actions</p>
          <p className="modal-description text-[13px]">
            {subtitle ?? 'Run a quick action against the current selection.'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close quick action window"
          className="modal-field-surface flex h-10 w-10 items-center justify-center rounded-full text-lg text-muted-foreground transition hover:text-foreground"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        {actions.length > 0 && (
          <ModeTabs actions={actions} activeActionId={activeAction?.id ?? activeActionId} onChange={setActiveActionId} />
        )}
        <InputPanel input={input} />
        <ResultPanel
          title={activeAction?.title ?? 'Action'}
          running={running}
          result={result}
          error={error}
          onRun={() => onRun(activeAction?.id ?? activeActionId)}
          onCopy={onCopy}
          onPaste={onPaste}
        />
      </div>
    </div>
  );
}
