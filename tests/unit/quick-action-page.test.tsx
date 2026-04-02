import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  MainLayout: () => <div data-testid="main-layout">Main Layout</div>,
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
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

describe('Quick action page', () => {
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

    vi.mocked(window.electron.ipcRenderer.invoke).mockReset().mockImplementation(async (channel: string) => {
      if (channel === 'quickAction:getLastContext') {
        return {
          actionId: 'translate',
          action: {
            id: 'translate',
            kind: 'translate',
            title: 'Translate',
            shortcut: 'CommandOrControl+Shift+1',
            enabled: true,
            outputMode: 'copy',
          },
          input: {
            text: 'cold start clipboard',
            source: 'clipboard',
            obtainedAt: 1,
          },
          invokedAt: 2,
          source: 'shortcut',
        };
      }

      return null;
    });
    vi.mocked(window.electron.ipcRenderer.on).mockReset().mockImplementation(() => vi.fn());
  });

  it('hydrates from the last context on the dedicated quick-action route', async () => {
    const subscriptions = new Map<string, (...args: unknown[]) => void>();
    vi.mocked(window.electron.ipcRenderer.on).mockImplementation((channel, callback) => {
      subscriptions.set(channel, callback);
      return vi.fn();
    });

    const { default: App } = await import('@/App');

    render(
      <MemoryRouter initialEntries={['/quick-action']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Translate')).toBeInTheDocument();
    expect(screen.getByText('cold start clipboard')).toBeInTheDocument();
    expect(screen.queryByTestId('main-layout')).not.toBeInTheDocument();

    await act(async () => {
      subscriptions.get('quickAction:invoked')?.({
        actionId: 'reply',
        action: {
          id: 'reply',
          kind: 'reply',
          title: 'Reply',
          shortcut: 'CommandOrControl+Shift+2',
          enabled: true,
          outputMode: 'copy',
        },
        input: {
          text: 'live update text',
          source: 'clipboard',
          obtainedAt: 3,
        },
        invokedAt: 4,
        source: 'ipc',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Reply')).toBeInTheDocument();
      expect(screen.getByText('live update text')).toBeInTheDocument();
    });
  });
});
