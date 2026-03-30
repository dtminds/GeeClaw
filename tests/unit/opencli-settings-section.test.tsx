import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenCliSettingsSection } from '@/components/settings/OpenCliSettingsSection';

const hostApiFetchMock = vi.fn();
const navigateMock = vi.fn();
const invokeIpcMock = vi.fn();

const translations: Record<string, string> = {
  'opencli.title': 'OpenCLI',
  'opencli.description': '复用你的浏览器登录态，把任何网站变成能够让 AI 调用的命令行',
  'opencli.refresh': '刷新状态',
  'opencli.loadFailed': '加载 OpenCLI 状态失败',
  'opencli.runtime.title': '系统运行时',
  'opencli.runtime.description': 'GeeClaw 只检测系统 PATH 里的 opencli；通过 CLI 市场安装后，也会按同样方式识别。',
  'opencli.runtime.present': '已安装',
  'opencli.runtime.missing': '未安装',
  'opencli.runtime.version': '版本',
  'opencli.runtime.binaryPath': '路径',
  'opencli.runtime.emptyPath': '未检测到系统 PATH 中的 opencli',
  'opencli.runtime.unknown': '未知',
  'opencli.install.title': '安装引导',
  'opencli.install.description': '未检测到 opencli，请先前往 CLI 市场安装',
  'opencli.install.marketplace': '前往 CLI 市场安装',
  'opencli.doctor.daemon': '后台服务',
  'opencli.doctor.extension': 'Chrome浏览器插件',
  'opencli.doctor.issuesTitle': 'Doctor 报告的问题',
  'opencli.doctor.rawOutput': '查看原始 doctor 输出',
  'opencli.extension.title': 'Chrome浏览器插件',
  'opencli.extension.description': '如果插件还没有连通，请先下载最新扩展包，再按下面步骤安装到 Chrome',
  'opencli.extension.step1': '1. 点击上方按钮，下载最新的扩展安装包 `opencli-extension.zip`。',
  'opencli.extension.step2': '2. 解压后打开 Chrome，访问 chrome://extensions，并打开右上角的“开发者模式”。',
  'opencli.extension.step3': '3. 点击“加载已解压的扩展程序”，选择刚刚解压出来的扩展文件夹。',
  'opencli.extension.step4': '4. 等 Chrome 显示 OpenCLI 扩展已启用后，回到这里刷新状态。',
  'opencli.actions.downloadExtension': '下载插件安装包',
  'opencli.status.checking': '检测中',
  'opencli.status.connected': '已连接',
  'opencli.status.missing': '缺失',
  'opencli.status.unknown': '未知',
  'opencli.status.notConnected': '未连接',
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

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
  toUserMessage: (error: unknown) => String(error),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('OpenCliSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only system health and extension guidance when opencli is installed', async () => {
    hostApiFetchMock.mockResolvedValue({
      binaryExists: true,
      binaryPath: '/usr/local/bin/opencli',
      version: '1.5.5',
      command: '/usr/local/bin/opencli',
      releasesUrl: 'https://example.com/opencli/releases',
      readmeUrl: 'https://example.com/opencli/readme',
      doctor: {
        ok: true,
        daemonRunning: true,
        extensionConnected: true,
        connectivityOk: null,
        issues: [],
        output: 'ok',
        durationMs: 123,
      },
    });

    render(<OpenCliSettingsSection />);

    expect(await screen.findByText('系统运行时')).toBeInTheDocument();
    expect(screen.getAllByText('Chrome浏览器插件').length).toBeGreaterThan(0);
    expect(screen.queryByText('支持的站点与命令')).not.toBeInTheDocument();
    expect(screen.queryByText('安装引导')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/opencli/status');
    });
  });

  it('guides users to CLI Market when system opencli is missing', async () => {
    hostApiFetchMock.mockResolvedValue({
      binaryExists: false,
      binaryPath: null,
      version: null,
      command: null,
      releasesUrl: 'https://example.com/opencli/releases',
      readmeUrl: 'https://example.com/opencli/readme',
      doctor: null,
    });

    render(<OpenCliSettingsSection />);

    expect(await screen.findByText('安装引导')).toBeInTheDocument();
    expect(screen.getByTitle('未检测到系统 PATH 中的 opencli')).toBeInTheDocument();
    expect(screen.queryByText('支持的站点与命令')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '前往 CLI 市场安装' }));
    expect(navigateMock).toHaveBeenCalledWith('/settings/cli-marketplace');

    fireEvent.click(screen.getByRole('button', { name: '下载插件安装包' }));
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', 'https://example.com/opencli/releases');
  });
});
