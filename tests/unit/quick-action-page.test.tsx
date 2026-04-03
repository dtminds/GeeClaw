import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUICK_ACTIONS } from '@shared/quick-actions';
import type { QuickActionContext } from '@shared/quick-actions';

const settingsState = {
  init: vi.fn(async () => undefined),
  theme: 'light' as const,
  colorTheme: 'blue',
  language: 'en',
  quickActions: structuredClone(DEFAULT_QUICK_ACTIONS),
};

const updateState = {
  init: vi.fn(async () => undefined),
};

const bootstrapState = {
  phase: 'ready' as const,
  init: vi.fn(async () => undefined),
};

const getQuickActionLastContextMock = vi.fn<() => Promise<QuickActionContext | null>>();
const subscribeQuickActionInvokedMock = vi.fn<(listener: (context: QuickActionContext) => void) => () => void>();
const closeQuickActionWindowMock = vi.fn<() => Promise<void>>();
const runQuickActionMock = vi.fn();
const copyQuickActionResultMock = vi.fn();
const pasteQuickActionResultMock = vi.fn();

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
  toast: {
    success: vi.fn(),
  },
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

vi.mock('../../src/lib/quick-actions', () => ({
  getQuickActionLastContext: () => getQuickActionLastContextMock(),
  subscribeQuickActionInvoked: (listener: (context: QuickActionContext) => void) => subscribeQuickActionInvokedMock(listener),
  closeQuickActionWindow: () => closeQuickActionWindowMock(),
  runQuickAction: (...args: unknown[]) => runQuickActionMock(...args),
  copyQuickActionResult: (...args: unknown[]) => copyQuickActionResultMock(...args),
  pasteQuickActionResult: (...args: unknown[]) => pasteQuickActionResultMock(...args),
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

function createContext(overrides?: Partial<QuickActionContext>): QuickActionContext {
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
    ...overrides,
  };
}

describe('Quick action page', () => {
  beforeEach(() => {
    settingsState.init.mockReset().mockResolvedValue(undefined);
    updateState.init.mockReset().mockResolvedValue(undefined);
    bootstrapState.init.mockReset().mockResolvedValue(undefined);
    getQuickActionLastContextMock.mockReset().mockResolvedValue(createContext());
    closeQuickActionWindowMock.mockReset().mockResolvedValue(undefined);
    subscribeQuickActionInvokedMock.mockReset().mockImplementation(() => vi.fn());
    runQuickActionMock.mockReset().mockResolvedValue({
      success: true,
      actionId: 'translate',
      text: 'translated text',
      prompt: 'prompt',
    });
    copyQuickActionResultMock.mockReset().mockResolvedValue({ success: true });
    pasteQuickActionResultMock.mockReset().mockResolvedValue({ success: true, pasted: false });

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
  });

  it('hydrates from the last context via the quick-action renderer api and updates on invocation events', async () => {
    let listener: ((context: QuickActionContext) => void) | null = null;
    subscribeQuickActionInvokedMock.mockImplementation((nextListener) => {
      listener = nextListener;
      return vi.fn();
    });

    const { default: App } = await import('@/App');

    render(
      <MemoryRouter initialEntries={['/quick-action']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('cold start clipboard')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Translate' })).toBeInTheDocument();
    expect(screen.queryByTestId('main-layout')).not.toBeInTheDocument();
    expect(getQuickActionLastContextMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      listener?.(createContext({
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
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('Reply')).toBeInTheDocument();
      expect(screen.getByText('live update text')).toBeInTheDocument();
    });
  });

  it('closes the floating window from the close button and Escape', async () => {
    const { default: App } = await import('@/App');

    render(
      <MemoryRouter initialEntries={['/quick-action']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('cold start clipboard')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Translate' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close quick action window' }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(closeQuickActionWindowMock).toHaveBeenCalledTimes(2);
  });

  it('runs, copies, and paste-copies quick action results from the floating window', async () => {
    const { default: App } = await import('@/App');

    render(
      <MemoryRouter initialEntries={['/quick-action']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('cold start clipboard')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Translate' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Translate' }));
    });

    expect(runQuickActionMock).toHaveBeenCalledWith('translate', {
      text: 'cold start clipboard',
      source: 'clipboard',
      obtainedAt: 1,
    });

    expect(await screen.findByText('translated text')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Paste result' }));
    });

    expect(copyQuickActionResultMock).toHaveBeenCalledWith('translated text');
    expect(pasteQuickActionResultMock).toHaveBeenCalledWith('translated text');
    expect(closeQuickActionWindowMock).toHaveBeenCalledTimes(2);
  });
});
