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
    <div className="no-drag flex h-full items-stretch">
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
        label="Close Window"
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
        'flex h-full w-12 items-center justify-center text-muted-foreground/80 transition-colors duration-150',
        tone === 'danger'
          ? 'hover:bg-[#e81123] hover:text-white'
          : 'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8',
      )}
    >
      {children}
    </button>
  );
}
