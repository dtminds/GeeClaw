/**
 * Main Layout Component
 * Sidebar + content with platform-aware window chrome.
 */
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { WindowControls } from './WindowControls';
import { useSettingsStore } from '@/stores/settings';

const isMac = window.electron?.platform === 'darwin';
const COLLAPSED_SIDEBAR_WIDTH = 48;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 360;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

export function MainLayout() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const [dragState, setDragState] = useState<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!dragState || sidebarCollapsed) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = clampSidebarWidth(dragState.startWidth + event.clientX - dragState.startX);
      setSidebarWidth(nextWidth);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      setDragState(null);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [dragState, setSidebarWidth, sidebarCollapsed]);

  const effectiveSidebarWidth = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : clampSidebarWidth(sidebarWidth);

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <div
        data-testid="sidebar-layout-pane"
        className="relative h-full shrink-0"
        style={{ width: `${effectiveSidebarWidth}px` }}
      >
        <Sidebar />
        {!sidebarCollapsed && (
          <div
            data-testid="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            className="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none"
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              setDragState({
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: effectiveSidebarWidth,
              });
            }}
          />
        )}
      </div>
      <main className="app-canvas relative flex flex-1 min-h-0 flex-col overflow-hidden">
        {isMac ? (
          <div className="drag-region absolute inset-x-0 top-0 z-10 h-4" />
        ) : (
          <header className="app-titlebar drag-region relative z-20 flex h-8 shrink-0 items-center justify-end">
            <WindowControls />
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
