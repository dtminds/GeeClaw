import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

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

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key,
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
    error: vi.fn(),
  },
}));

describe('CliMarketplaceSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          actionLabel: 'install',
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

  it('renders installed items with a more-actions menu and missing items with an install button', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'feishu',
            title: 'Feishu CLI',
            description: 'Docs',
            installed: true,
            actionLabel: 'reinstall',
          },
          {
            id: 'wecom',
            title: 'WeCom CLI',
            description: 'Docs',
            installed: false,
            actionLabel: 'install',
          },
        ];
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(await screen.findByText('Feishu CLI')).toBeInTheDocument();
    expect(screen.getByText('已安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByText('未安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装' })).toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cli-marketplace/catalog');
    });
  });

  it('opens the more-actions dropdown for installed items and runs reinstall', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'feishu',
            title: 'Feishu CLI',
            description: 'Docs',
            installed: true,
            actionLabel: 'reinstall',
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

  it('opens a job dialog and shows install logs for CLI and skills', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/cli-marketplace/catalog') {
        return [
          {
            id: 'feishu',
            title: 'Feishu CLI',
            description: 'Docs',
            installed: false,
            actionLabel: 'install',
          },
        ];
      }

      if (path === '/api/cli-marketplace/install') {
        expect(init?.method).toBe('POST');
        return {
          id: 'job-install-1',
          itemId: 'feishu',
          title: 'Feishu CLI',
          operation: 'install',
          status: 'running',
          logs: '$ npm install --global @larksuite/cli\n',
          startedAt: '2026-03-30T00:00:00.000Z',
          finishedAt: null,
        };
      }

      if (path === '/api/cli-marketplace/jobs/job-install-1') {
        return {
          id: 'job-install-1',
          itemId: 'feishu',
          title: 'Feishu CLI',
          operation: 'install',
          status: 'succeeded',
          logs: '$ npm install --global @larksuite/cli\n$ npx -y skills add larksuite/cli -y -g\n',
          startedAt: '2026-03-30T00:00:00.000Z',
          finishedAt: '2026-03-30T00:00:10.000Z',
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: '安装' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('安装 CLI')).toBeInTheDocument();
    expect(await screen.findByText(/\$ npm install --global @larksuite\/cli/)).toBeInTheDocument();
    expect(await screen.findByText(/\$ npx -y skills add larksuite\/cli -y -g/)).toBeInTheDocument();
  });
});
