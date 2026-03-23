/**
 * Main Layout Component
 * Sidebar + content with platform-aware window chrome.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { WindowControls } from './WindowControls';

const isMac = window.electron?.platform === 'darwin';

export function MainLayout() {
  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <Sidebar />
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
