import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = {
  init: vi.fn(async () => undefined),
  theme: 'light' as const,
  colorTheme: 'blue',
  language: 'en',
};

const updateState = {
  init: vi.fn(async () => undefined),
};

const bootstrapState = {
  phase: 'ready' as const,
  init: vi.fn(async () => undefined),
};

vi.mock('../../src/i18n', () => ({
  default: {
    language: 'en',
    changeLanguage: vi.fn(),
  },
}));

vi.mock('../../src/components/layout/MainLayout', () => ({
  MainLayout: () => <Outlet />,
}));

vi.mock('../../src/pages/Chat', () => ({
  Chat: () => <div>Chat Page</div>,
}));

vi.mock('../../src/pages/Dashboard', () => ({
  Dashboard: () => <div>Dashboard Page</div>,
}));

vi.mock('../../src/pages/Channels', () => ({
  Channels: () => <div>Channels Page</div>,
}));

vi.mock('../../src/pages/Skills', () => ({
  Skills: () => <div>Skills Page</div>,
}));

vi.mock('../../src/pages/Cron', () => ({
  Cron: () => <div>Cron Page</div>,
}));

vi.mock('../../src/pages/Cron/RunHistoryPage', () => ({
  CronRunHistoryPage: () => <div>Cron Run History Page</div>,
}));

vi.mock('../../src/pages/Settings', () => ({
  Settings: () => <div>Settings Page</div>,
}));

vi.mock('../../src/pages/Setup', () => ({
  Setup: () => <div>Setup Page</div>,
}));

vi.mock('../../src/pages/Startup', () => ({
  Startup: () => <div>Startup Page</div>,
}));

vi.mock('../../src/pages/GatewaySessions', () => ({
  GatewaySessions: () => <div>Gateway Sessions Page</div>,
}));

vi.mock('@/components/gateway/GatewayRecoveryOverlay', () => ({
  GatewayRecoveryOverlay: () => null,
}));

vi.mock('@/components/update/UpdateAnnouncementDialog', () => ({
  UpdateAnnouncementDialog: () => null,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('sonner', () => ({
  Toaster: () => null,
}));

vi.mock('../../src/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('../../src/stores/update', () => ({
  useUpdateStore: Object.assign(
    (selector: (state: typeof updateState) => unknown) => selector(updateState),
    { setState: vi.fn() },
  ),
}));

vi.mock('../../src/stores/bootstrap', () => ({
  useBootstrapStore: (selector: (state: typeof bootstrapState) => unknown) => selector(bootstrapState),
}));

vi.mock('../../src/lib/api-client', () => ({
  applyGatewayTransportPreference: vi.fn(),
}));

vi.mock('../../src/lib/settings-modal', () => ({
  isSettingsModalPath: () => false,
}));

vi.mock('@/theme/color-themes', () => ({
  applyColorTheme: vi.fn(),
}));

vi.mock('../../src/lib/update-debug', () => ({
  getDevDebugUpdateScenario: () => null,
}));

describe('App routes', () => {
  beforeEach(() => {
    settingsState.init.mockReset().mockResolvedValue(undefined);
    updateState.init.mockReset().mockResolvedValue(undefined);
    bootstrapState.init.mockReset().mockResolvedValue(undefined);

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });

    const electron = window.electron ?? {};
    Object.assign(electron, {
      ipcRenderer: {
        ...(electron.ipcRenderer ?? {}),
        on: vi.fn(() => vi.fn()),
      },
    });
    (window as typeof window & { electron: typeof electron }).electron = electron;
  });

  it('redirects the removed agents route to dashboard', async () => {
    const { default: App } = await import('@/App');

    render(
      <MemoryRouter initialEntries={['/agents']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText('Agents Page')).not.toBeInTheDocument();
  });
});
