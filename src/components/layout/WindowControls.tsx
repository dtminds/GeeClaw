import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const isMac = window.electron?.platform === 'darwin';

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (isMac) return;
    void invokeIpc('window:isMaximized').then((value) => {
      setMaximized(Boolean(value));
    });
  }, []);

  if (isMac) return null;

  const syncMaximized = () => {
    void invokeIpc('window:isMaximized').then((value) => {
      setMaximized(Boolean(value));
    });
  };

  return (
    <div className="no-drag flex items-center gap-1.5 rounded-full border border-black/6 bg-white/88 p-1 shadow-[0_16px_30px_-24px_rgba(20,37,44,0.55)] supports-[backdrop-filter]:bg-white/74 supports-[backdrop-filter]:backdrop-blur">
      <WindowControlButton
        label="Minimize"
        onClick={() => {
          void invokeIpc('window:minimize');
        }}
      >
        <Minus className="h-3.5 w-3.5" />
      </WindowControlButton>
      <WindowControlButton
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => {
          void invokeIpc('window:maximize').then(syncMaximized);
        }}
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </WindowControlButton>
      <WindowControlButton
        label="Hide Window"
        tone="danger"
        onClick={() => {
          void invokeIpc('window:close');
        }}
      >
        <X className="h-3.5 w-3.5" />
      </WindowControlButton>
    </div>
  );
}

function WindowControlButton({
  children,
  label,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-all duration-200',
        'hover:-translate-y-px',
        tone === 'danger'
          ? 'hover:bg-red-500 hover:text-white'
          : 'hover:bg-black/5 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
