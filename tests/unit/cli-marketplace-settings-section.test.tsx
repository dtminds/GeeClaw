import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const clipboardWriteTextMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

const translations: Record<string, string> = {
  'cliMarketplace.title': 'CLI 市场',
  'cliMarketplace.description': '安装 GeeClaw 预置的命令行工具',
  'cliMarketplace.refresh': '刷新状态',
  'cliMarketplace.loadFailed': '加载 CLI 市场失败',
  'cliMarketplace.installFailed': '安装 CLI 失败',
  'cliMarketplace.empty': '当前还没有可安装的 CLI',
  'cliMarketplace.installed': '已安装',
  'cliMarketplace.missing': '未安装',
  'cliMarketplace.install': '安装',
  'cliMarketplace.copyInstallCommand': '复制安装命令',
  'cliMarketplace.reinstall': '重新安装',
  'cliMarketplace.uninstall': '卸载',
  'cliMarketplace.moreActions': '更多操作',
  'cliMarketplace.job.title.install': '安装 CLI',
  'cliMarketplace.job.title.uninstall': '卸载 CLI',
  'cliMarketplace.job.running': '执行中',
  'cliMarketplace.job.succeeded': '已完成',
  'cliMarketplace.job.failed': '失败',
  'cliMarketplace.job.close': '关闭',
  'common:status.loading': '加载中',
};

const translate = (key: string, options?: { defaultValue?: string } | string) => {
  if (translations[key]) {
    return translations[key];
  }
  if (typeof options === 'string') {
    return options;
  }
  if (options && typeof options.defaultValue === 'string') {
    return options.defaultValue;
  }
  return key;
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
    }),
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/api-client', () => ({
  toUserMessage: (error: unknown) => String(error),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

describe('CliMarketplaceSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  it('renders 安装 for source=none with available managed-npm method', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'wecom',
            title: 'WeCom CLI',
            description: 'Docs',
            installed: false,
            source: 'none',
            installMethods: [
              {
                type: 'managed-npm',
                label: 'managed-npm',
                available: true,
                managed: true,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(await screen.findByText('WeCom CLI')).toBeInTheDocument();
    expect(screen.getByText('未安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装' })).toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cli-marketplace/catalog');
    });
  });

  it('renders 复制安装命令 and copies the command for source=none manual-only brew', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'foo',
            title: 'Foo CLI',
            description: 'Docs',
            installed: false,
            source: 'none',
            installMethods: [
              {
                type: 'manual',
                label: 'brew',
                command: 'brew install foo',
                available: true,
                managed: false,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '复制安装命令' }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('brew install foo');
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('keeps managed install primary while exposing manual fallback in overflow menu', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'bar',
            title: 'Bar CLI',
            description: 'Docs',
            installed: false,
            source: 'none',
            installMethods: [
              {
                type: 'managed-npm',
                label: 'managed-npm',
                available: true,
                managed: true,
              },
              {
                type: 'manual',
                label: 'brew',
                command: 'brew install bar',
                available: true,
                managed: false,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(await screen.findByRole('button', { name: '安装' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    const menu = await screen.findByRole('menu');
    const copyFallbackItem = within(menu).getByRole('menuitem', { name: /Copy via/i });
    expect(copyFallbackItem).toBeEnabled();
    fireEvent.click(copyFallbackItem);

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('brew install bar');
    });
  });

  it('shows a visible disabled runtime-missing action surface for managed-only entries', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'runtime-missing',
            title: 'Runtime Missing CLI',
            description: 'Docs',
            installed: false,
            source: 'none',
            installMethods: [
              {
                type: 'managed-npm',
                label: 'managed-npm',
                available: false,
                unavailableReason: 'runtime-missing',
                managed: true,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));

    const menu = await screen.findByRole('menu');
    const runtimeMissingItem = within(menu).getByRole('menuitem', { name: /runtime/i });
    expect(runtimeMissingItem).toBeDisabled();
  });

  it('shows error toast when copying manual install command fails', async () => {
    clipboardWriteTextMock.mockRejectedValueOnce(new Error('clipboard denied'));
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'copy-failure',
            title: 'Copy Failure CLI',
            description: 'Docs',
            installed: false,
            source: 'none',
            installMethods: [
              {
                type: 'manual',
                label: 'brew',
                command: 'brew install copy-failure',
                available: true,
                managed: false,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '复制安装命令' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining('Failed to copy install command'));
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('does not render 卸载 for source=system entries', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'foo',
            title: 'Foo CLI',
            description: 'Docs',
            installed: true,
            source: 'system',
            installMethods: [
              {
                type: 'manual',
                label: 'brew',
                command: 'brew install foo',
                available: true,
                managed: false,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('卸载')).not.toBeInTheDocument();
  });

  it('shows disabled Need Homebrew text for unavailable brew manual method', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'foo',
            title: 'Foo CLI',
            description: 'Docs',
            installed: false,
            source: 'none',
            installMethods: [
              {
                type: 'manual',
                label: 'brew',
                command: 'brew install foo',
                available: false,
                unavailableReason: 'missing-command',
                missingCommands: ['brew'],
                managed: false,
              },
            ],
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));

    const menu = await screen.findByRole('menu');
    const disabledManualMethod = within(menu).getByRole('menuitem', { name: 'Need Homebrew' });
    expect(disabledManualMethod).toBeDisabled();
  });

  it('opens reinstall/uninstall menu for source=geeclaw and starts reinstall job', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'feishu',
            title: 'Feishu CLI',
            description: 'Docs',
            installed: true,
            source: 'geeclaw',
            installMethods: [
              {
                type: 'managed-npm',
                label: 'managed-npm',
                available: true,
                managed: true,
              },
            ],
          },
        ];
      }

      if (path === '/api/cli-marketplace/install') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ id: 'feishu' }));
        return {
          id: 'job-install-2',
          itemId: 'feishu',
          title: 'Feishu CLI',
          operation: 'install',
          status: 'running',
          logs: '$ npm install --global @larksuite/cli\n',
          startedAt: '2026-03-30T00:00:00.000Z',
          finishedAt: null,
        };
      }

      if (path === '/api/cli-marketplace/jobs/job-install-2') {
        return {
          id: 'job-install-2',
          itemId: 'feishu',
          title: 'Feishu CLI',
          operation: 'install',
          status: 'succeeded',
          logs: '$ npm install --global @larksuite/cli\n',
          startedAt: '2026-03-30T00:00:00.000Z',
          finishedAt: '2026-03-30T00:00:10.000Z',
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('重新安装')).toBeInTheDocument();
    expect(within(menu).getByText('卸载')).toBeInTheDocument();
    fireEvent.click(within(menu).getByText('重新安装'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith(
        '/api/cli-marketplace/install',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: 'feishu' }),
        }),
      );
    });
  });
});
