import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar-content" className="h-full w-full" />,
}));

vi.mock('@/components/layout/WindowControls', () => ({
  WindowControls: () => null,
}));

describe('MainLayout sidebar resizing', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      sidebarCollapsed: false,
      sidebarWidth: 224,
    });
  });

  it('shows the saved expanded width and a resize handle', async () => {
    const { MainLayout } = await import('@/components/layout/MainLayout');

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<div data-testid="main-content">Main</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-layout-pane')).toHaveStyle({ width: '224px' });
    expect(screen.getByTestId('sidebar-resize-handle')).toBeInTheDocument();
  });

  it('clamps dragging to the configured min and max width', async () => {
    const { MainLayout } = await import('@/components/layout/MainLayout');

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<div data-testid="main-content">Main</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const handle = screen.getByTestId('sidebar-resize-handle');
    const pane = screen.getByTestId('sidebar-layout-pane');

    fireEvent.pointerDown(handle, { button: 0, clientX: 224, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 180, pointerId: 1 });
    expect(pane).toHaveStyle({ width: '224px' });

    fireEvent.pointerMove(window, { clientX: 420, pointerId: 1 });
    expect(pane).toHaveStyle({ width: '360px' });

    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it('disables resizing when the sidebar is collapsed', async () => {
    useSettingsStore.setState({
      sidebarCollapsed: true,
      sidebarWidth: 320,
    });

    const { MainLayout } = await import('@/components/layout/MainLayout');

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<div data-testid="main-content">Main</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-layout-pane')).toHaveStyle({ width: '48px' });
    expect(screen.queryByTestId('sidebar-resize-handle')).not.toBeInTheDocument();
  });
});
