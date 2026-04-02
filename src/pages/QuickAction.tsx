import { useEffect, useState } from 'react';
import type { QuickActionContext } from '@shared/quick-actions';
import { closeQuickActionWindow, getQuickActionLastContext, subscribeQuickActionInvoked } from '@/lib/quick-actions';

function formatInvocationSource(source: QuickActionContext['source']): string {
  return source === 'shortcut' ? 'Triggered from shortcut' : 'Triggered from app';
}

export function QuickActionPage() {
  const [context, setContext] = useState<QuickActionContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getQuickActionLastContext().then((payload) => {
      if (!cancelled) {
        setContext(payload ?? null);
      }
    });

    const unsubscribe = subscribeQuickActionInvoked((payload) => {
      setContext(payload ?? null);
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

  return (
    <div className="min-h-screen bg-transparent p-3 text-foreground">
      <div className="modal-card-surface flex min-h-[calc(100vh-1.5rem)] flex-col rounded-[28px] border p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="modal-title text-[18px]">Quick Action</p>
            <p className="modal-description text-[13px]">
              {context ? formatInvocationSource(context.source) : 'Waiting for a quick action to be invoked.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close quick action window"
            className="modal-field-surface flex h-10 w-10 items-center justify-center rounded-full text-lg text-muted-foreground transition hover:text-foreground"
            onClick={() => {
              void closeQuickActionWindow();
            }}
          >
            ×
          </button>
        </div>

        <div className="mt-4 flex-1">
          {context ? (
            <div className="space-y-4">
              <div className="modal-field-surface rounded-2xl border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Action
                </p>
                <p className="mt-2 text-lg font-semibold text-foreground">{context.action.title}</p>
              </div>

              <div className="modal-field-surface rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Input
                  </p>
                  <span className="text-[11px] text-muted-foreground">{context.input.source}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                  {context.input.text}
                </p>
              </div>
            </div>
          ) : (
            <div className="modal-field-surface flex h-full min-h-[180px] items-center justify-center rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Copy text, then trigger a quick action to populate this window.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
