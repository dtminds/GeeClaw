import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

type BootstrapState = {
  phase: string;
  error: string | null;
  loginAndContinue: ReturnType<typeof vi.fn>;
  submitInviteCodeAndContinue: ReturnType<typeof vi.fn>;
  skipInviteCodeAndContinue: ReturnType<typeof vi.fn>;
  continueAfterProvider: ReturnType<typeof vi.fn>;
  logoutToLogin: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
};

const bootstrapState: BootstrapState = {
  phase: 'needs_invite_code',
  error: null,
  loginAndContinue: vi.fn(),
  submitInviteCodeAndContinue: vi.fn(),
  skipInviteCodeAndContinue: vi.fn(),
  continueAfterProvider: vi.fn(),
  logoutToLogin: vi.fn(),
  retry: vi.fn(),
};

const sessionState = {
  account: null,
};

const settingsState = {
  setupComplete: false,
};

const translations: Record<string, string> = {
  'startup.needsInvite.title': '请输入邀请码',
  'startup.needsInvite.placeholder': '输入邀请码',
  'startup.needsInvite.action': '确认',
  'startup.needsInvite.submitting': '校验中',
  'startup.needsInvite.skip': '跳过',
  'startup.needsInvite.switchAccount': '切换账号',
  'startup.status.invite': '该账号尚未开通，请先输入邀请码继续。',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key,
    }),
  };
});

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => {
      const MotionPrimitive = ({
        children,
        initial: _initial,
        animate: _animate,
        transition: _transition,
        ...props
      }: {
        children?: ReactNode;
        initial?: unknown;
        animate?: unknown;
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

vi.mock('@/pages/Setup', () => ({
  ProviderContent: () => <div data-testid="provider-content" />,
}));

vi.mock('@/stores/bootstrap', () => ({
  useBootstrapStore: (selector: (state: BootstrapState) => unknown) => selector(bootstrapState),
}));

vi.mock('@/stores/session', () => ({
  useSessionStore: (selector: (state: typeof sessionState) => unknown) => selector(sessionState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

describe('Startup invite code gate', () => {
  beforeEach(() => {
    bootstrapState.phase = 'needs_invite_code';
    bootstrapState.error = null;
    bootstrapState.loginAndContinue.mockReset();
    bootstrapState.submitInviteCodeAndContinue.mockReset().mockResolvedValue(undefined);
    bootstrapState.skipInviteCodeAndContinue.mockReset().mockResolvedValue(undefined);
    bootstrapState.continueAfterProvider.mockReset();
    bootstrapState.logoutToLogin.mockReset().mockResolvedValue(undefined);
    bootstrapState.retry.mockReset();
  });

  it('renders the invite code form and submits the entered code', async () => {
    const { Startup } = await import('@/pages/Startup');
    render(<Startup />);

    const inviteInput = screen.getByPlaceholderText('输入邀请码');
    const confirmButton = screen.getByRole('button', { name: '确认' });
    expect(confirmButton).toBeDisabled();

    fireEvent.input(inviteInput, {
      target: { value: 'invite-123' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(bootstrapState.submitInviteCodeAndContinue).toHaveBeenCalledWith('invite-123');
    });
  });

  it('lets the user switch accounts from the invite screen', async () => {
    const { Startup } = await import('@/pages/Startup');
    render(<Startup />);

    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));

    await waitFor(() => {
      expect(bootstrapState.logoutToLogin).toHaveBeenCalledTimes(1);
    });
  });

  it('lets the user skip invite binding from the invite screen', async () => {
    const { Startup } = await import('@/pages/Startup');
    render(<Startup />);

    fireEvent.click(screen.getByRole('button', { name: '跳过' }));

    await waitFor(() => {
      expect(bootstrapState.skipInviteCodeAndContinue).toHaveBeenCalledTimes(1);
    });
  });

  it('uses a vertical scroll container for the provider setup phase', async () => {
    bootstrapState.phase = 'needs_provider';

    const { Startup } = await import('@/pages/Startup');
    render(<Startup />);

    const scrollContainer = screen.getByTestId('startup-content-scroll-container');
    expect(scrollContainer).toHaveClass('min-h-0');
    expect(scrollContainer).toHaveClass('overflow-y-auto');
    expect(scrollContainer).not.toHaveClass('justify-center');
  });
});
