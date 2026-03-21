/**
 * Main Layout Component
 * Sidebar + content with immersive custom window chrome.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { WindowControls } from './WindowControls';

export function MainLayout() {
  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <Sidebar />
      <main className="app-canvas relative flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="drag-region absolute inset-x-0 top-0 z-10 h-4" />
        <div className="absolute right-4 top-3 z-30 md:right-5">
          <WindowControls />
        </div>
        <div className="h-full min-h-0 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
