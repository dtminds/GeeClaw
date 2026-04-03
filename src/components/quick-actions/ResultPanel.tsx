import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ResultPanelProps {
  title: string;
  running?: boolean;
  result?: string;
  error?: string | null;
  onRun: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
}

export function ResultPanel({
  title,
  running = false,
  result,
  error,
  onRun,
  onCopy,
  onPaste,
}: ResultPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="modal-field-surface min-h-[156px] flex-1 rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Result
          </p>
          {running && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running
            </span>
          )}
        </div>
        {error ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-destructive">
            {error}
          </p>
        ) : result ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {result}
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Run this action to generate a result for the current selection.
          </p>
        )}
      </div>

      <div className="modal-footer mt-0 flex-wrap justify-start gap-2 p-0">
        <Button type="button" className="rounded-full" onClick={onRun} disabled={running}>
          {running ? 'Running…' : `Run ${title}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={onCopy}
          disabled={!result || running}
        >
          Copy result
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={onPaste}
          disabled={!result || running}
        >
          Paste result
        </Button>
      </div>
    </div>
  );
}
