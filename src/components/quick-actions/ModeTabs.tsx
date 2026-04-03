import type { QuickActionDefinition } from '@shared/quick-actions';

interface ModeTabsProps {
  actions: QuickActionDefinition[];
  activeActionId: string;
  onChange: (actionId: string) => void;
}

export function ModeTabs({ actions, activeActionId, onChange }: ModeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Quick action modes"
      className="modal-field-surface inline-flex rounded-2xl border p-1"
    >
      {actions.map((action) => {
        const active = action.id === activeActionId;
        return (
          <button
            key={action.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`rounded-[14px] px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onChange(action.id)}
          >
            {action.title}
          </button>
        );
      })}
    </div>
  );
}
