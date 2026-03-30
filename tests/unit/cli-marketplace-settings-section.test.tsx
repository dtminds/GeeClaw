import { render, screen, waitFor } from '@testing-library/react';
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
  'common:status.loading': '加载中',
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

  it('renders installed and missing CLI entries with the correct action labels', async () => {
    hostApiFetchMock.mockResolvedValue([
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
    ]);

    const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

    render(<CliMarketplaceSettingsSection />);

    expect(await screen.findByText('Feishu CLI')).toBeInTheDocument();
    expect(screen.getByText('已安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新安装' })).toBeInTheDocument();
    expect(screen.getByText('未安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装' })).toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cli-marketplace/catalog');
    });
  });
});
