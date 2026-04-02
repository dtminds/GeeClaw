import type { QuickActionInput } from '@shared/quick-actions';

interface InputPanelProps {
  input: QuickActionInput | null;
}

export function InputPanel({ input }: InputPanelProps) {
  if (!input) {
    return (
      <div className="modal-field-surface flex min-h-[132px] items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Copy text, then trigger a quick action to populate this window.
      </div>
    );
  }

  return (
    <div className="modal-field-surface rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Input
        </p>
        <span className="text-[11px] text-muted-foreground">{input.source}</span>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {input.text}
      </p>
    </div>
  );
}
