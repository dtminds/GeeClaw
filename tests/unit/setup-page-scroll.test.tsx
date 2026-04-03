import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = {
  language: 'en',
  devModeUnlocked: true,
  setLanguage: vi.fn(),
  markSetupComplete: vi.fn(),
};

const translations: Record<string, string> = {
  'welcome.title': 'Welcome',
  'welcome.description': 'Welcome description',
  'welcome.features.noCommand': 'No command line',
  'welcome.features.modernUI': 'Modern UI',
  'welcome.features.bundles': 'Bundles included',
  'welcome.features.crossPlatform': 'Cross platform',
  'nav.next': 'Next',
  'nav.skipSetup': 'Skip setup',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => {
      const MotionPrimitive = ({
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...props
      }: {
        children?: ReactNode;
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
        [key: string]: unknown;
      }) => <div {...props}>{children}</div>;

      return MotionPrimitive;
    },
  }),
}));

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="title-bar" />,
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector?: (state: typeof settingsState) => unknown) => (
    selector ? selector(settingsState) : settingsState
  ),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: Object.assign(
    (selector: (state: { status: { state: 'stopped'; port?: number }; start: typeof vi.fn }) => unknown) => selector({
      status: { state: 'stopped' },
      start: vi.fn(),
    }),
    {
      getState: () => ({
        status: { state: 'stopped' as const },
        start: vi.fn(),
      }),
    },
  ),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: () => () => undefined,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/i18n', () => ({
  SUPPORTED_LANGUAGES: [{ code: 'en', label: 'English' }],
}));

describe('Setup page scroll layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.setLanguage.mockReset();
    settingsState.markSetupComplete.mockReset();
  });

  it('keeps the main setup content in a shrinkable vertical scroll container', async () => {
    const { Setup } = await import('@/pages/Setup');

    render(
      <MemoryRouter>
        <Setup />
      </MemoryRouter>,
    );

    const scrollContainer = screen.getByTestId('setup-scroll-container');
    expect(scrollContainer).toHaveClass('min-h-0');
    expect(scrollContainer).toHaveClass('overflow-y-auto');
  });
});
