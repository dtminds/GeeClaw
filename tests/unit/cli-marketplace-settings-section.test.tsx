import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const clipboardWriteTextMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const invokeIpcMock = vi.fn();

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
  'cliMarketplace.docs': '文档',
  'cliMarketplace.manualDialog.title': '安装命令',
  'cliMarketplace.manualDialog.description': '复制下面的命令，然后到终端里执行。',
  'cliMarketplace.manualDialog.copy': '复制命令',
  'cliMarketplace.manualDialog.close': '关闭',
  'cliMarketplace.manual.installMethod': '通过 {{method}} 安装',
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
  'updates.action.retry': '重试',
};

const translate = (key: string, options?: { defaultValue?: string } | string) => {
  if (translations[key]) {
    if (options && typeof options === 'object') {
      return Object.entries(options).reduce((result, [optionKey, optionValue]) => (
        typeof optionValue === 'string'
          ? result.replace(`{{${optionKey}}}`, optionValue)
          : result
      ), translations[key]);
    }
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
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
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

  it('shows inline loading feedback while the initial catalog request is pending', async () => {
    hostApiFetchMock.mockReturnValue(new Promise(() => {}));

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(screen.getByText('加载中')).toBeInTheDocument();
  });

  it('shows empty feedback when the catalog has no items', async () => {
    hostApiFetchMock.mockResolvedValue([]);

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(await screen.findByText('当前还没有可安装的 CLI')).toBeInTheDocument();
  });

  it('shows inline error feedback and retries the initial catalog request', async () => {
    hostApiFetchMock
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce([
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
      ]);

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(await screen.findByText('加载 CLI 市场失败')).toBeInTheDocument();
    expect(screen.getByText('Error: catalog unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('WeCom CLI')).toBeInTheDocument();
    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows 安装 inside the actions menu for source=none with available managed-npm method', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: '安装' })).toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cli-marketplace/catalog');
    });
  });

  it('shows 安装 inside the actions menu for source=none manual-only brew and opens the install dialog', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '安装' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('复制下面的命令，然后到终端里执行。')).toBeInTheDocument();
    expect(screen.getByText('brew install foo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制命令' }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith('brew install foo');
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('opens the CLI docs link when docsUrl is provided', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'foo',
            title: 'Foo CLI',
            description: 'Docs',
            docsUrl: 'https://example.com/foo-docs',
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

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '文档' }));

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', 'https://example.com/foo-docs');
    });
  });

  it('shows managed install and manual fallback inside the overflow menu', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: '安装' })).toBeInTheDocument();
    const installFallbackItem = within(menu).getByRole('menuitem', { name: '通过 Homebrew 安装' });
    expect(installFallbackItem).toBeEnabled();
    fireEvent.click(installFallbackItem);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制命令' }));

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

    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '安装' }));
    fireEvent.click(await screen.findByRole('button', { name: '复制命令' }));

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

    const title = await screen.findByText('Foo CLI');
    const headingRow = title.closest('div');
    expect(headingRow).not.toBeNull();
    expect(within(headingRow as HTMLElement).getByText('System')).toBeInTheDocument();
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

    await screen.findByText('Feishu CLI');
    expect(screen.queryByText('GeeClaw')).not.toBeInTheDocument();
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
