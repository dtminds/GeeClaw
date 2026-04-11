import { act, render, screen } from '@testing-library/react';
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

type OpenClawSidecarStatus = {
  stage: 'idle' | 'extracting' | 'ready' | 'error';
  version?: string;
  previousVersion?: string;
  error?: string;
};

const bootstrapState: BootstrapState = {
  phase: 'preparing',
  error: null,
  loginAndContinue: vi.fn(),
  submitInviteCodeAndContinue: vi.fn(),
  skipInviteCodeAndContinue: vi.fn(),
  continueAfterProvider: vi.fn(),
  logoutToLogin: vi.fn(),
  retry: vi.fn(),
};

const settingsState = {
  setupComplete: false,
};

let sidecarStatusHandler: ((payload: OpenClawSidecarStatus) => void) | null = null;

const translations: Record<string, string> = {
  'startup.preparing.title': '正在准备 GeeClaw',
  'startup.preparing.caption': '第一次准备可能需要几分钟时间，请不要关闭窗口。',
  'startup.preparing.captionReturning': '正在启动所需服务，请稍候',
  'startup.preparing.openclawExtractingTitle': '正在准备 OpenClaw 运行时',
  'startup.preparing.openclawExtractingCaption': '首次启动需要解压运行时，请保持窗口打开。',
  'startup.preparing.openclawUpdatingTitle': '正在更新 OpenClaw 到 {{version}}',
  'startup.preparing.openclawUpdatingCaption': '正在替换内置运行时，请保持窗口打开。',
  'startup.status.default': '我们正在为您准备一个稳定、顺滑的 AI 使用体验。',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, string>) => {
        const template = translations[key] ?? key;
        if (!options) {
          return template;
        }
        return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => options[token] ?? '');
      },
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

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: vi.fn((eventName: string, handler: (payload: OpenClawSidecarStatus) => void) => {
    if (eventName === 'openclaw:sidecar-status') {
      sidecarStatusHandler = handler;
    }
    return () => {
      if (sidecarStatusHandler === handler) {
        sidecarStatusHandler = null;
      }
    };
  }),
}));

describe('Startup OpenClaw sidecar feedback', () => {
  beforeEach(() => {
    bootstrapState.phase = 'preparing';
    bootstrapState.error = null;
    settingsState.setupComplete = false;
    sidecarStatusHandler = null;
  });

  it('shows OpenClaw runtime preparation copy while the packaged sidecar is extracting', async () => {
    const { Startup } = await import('@/pages/Startup');
    render(<Startup />);

    await act(async () => {
      sidecarStatusHandler?.({ stage: 'extracting', version: '2026.4.10' });
    });

    expect(screen.getByText('正在准备 OpenClaw 运行时')).toBeInTheDocument();
    expect(screen.getByText('首次启动需要解压运行时，请保持窗口打开。')).toBeInTheDocument();
  });

  it('shows OpenClaw update copy when replacing an older packaged sidecar', async () => {
    const { Startup } = await import('@/pages/Startup');
    render(<Startup />);

    await act(async () => {
      sidecarStatusHandler?.({
        stage: 'extracting',
        version: '2026.4.10',
        previousVersion: '2026.4.9',
      });
    });

    expect(screen.getByText('正在更新 OpenClaw 到 2026.4.10')).toBeInTheDocument();
    expect(screen.getByText('正在替换内置运行时，请保持窗口打开。')).toBeInTheDocument();
  });
});
