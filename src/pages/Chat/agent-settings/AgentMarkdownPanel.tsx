import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentMarkdownPanelProps {
  title: string;
  description?: string;
  value?: string;
  placeholder?: string;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  errorLabel?: string;
  children?: React.ReactNode;
}

export function AgentMarkdownPanel({
  title,
  description,
  value,
  placeholder,
  loading = false,
  loadingLabel,
  error,
  errorLabel,
  children,
}: AgentMarkdownPanelProps) {
  const shouldShowPlaceholder = !loading && !error && !children && !value;

  return (
    <section className="modal-section-surface flex h-full min-h-0 flex-col rounded-[24px] border p-5">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div
        data-testid="agent-settings-panel-body"
        className={cn(
          'modal-field-surface mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border p-4 text-sm text-foreground shadow-sm',
          shouldShowPlaceholder && 'items-center justify-center text-muted-foreground',
        )}
      >
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{loadingLabel || 'Loading...'}</span>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-2 text-destructive">
            <p className="text-sm font-semibold">{errorLabel || 'Failed to load.'}</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : children ? (
          children
        ) : value ? (
          <pre className="whitespace-pre-wrap text-sm leading-6 text-foreground">
            {value}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}
      </div>
    </section>
  );
}
