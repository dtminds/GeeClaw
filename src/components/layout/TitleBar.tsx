/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows/Linux: icon + app name on left, minimize/maximize/close on right.
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import logoSvg from '@/assets/logo.svg';
import { invokeIpc } from '@/lib/api-client';

const isMac = window.electron?.platform === 'darwin';

export function TitleBar() {
  if (isMac) {
    // macOS: just a drag region, traffic lights are native
    return <div className="app-titlebar drag-region h-10 shrink-0 border-b" />;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  return (
    <div className="app-titlebar drag-region flex h-10 shrink-0 items-center justify-between border-b">
      {/* Left: Icon + App Name */}
      <div className="no-drag flex items-center gap-2.5 pl-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 shadow-[0_1px_2px_rgba(18,38,45,0.06)] ring-1 ring-black/5">
          <img src={logoSvg} alt="GeeClaw" className="h-4 w-auto" />
        </div>
        <span className="select-none text-xs font-semibold tracking-[0.18em] text-foreground/45 uppercase">
          GeeClaw
        </span>
      </div>

      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-black/4"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-black/4"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
