import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSettingsSection } from '@/components/settings/McpSettingsSection';

const hostApiFetchMock = vi.fn();
const navigateMock = vi.fn();
const invokeIpcMock = vi.fn();

const translations: Record<string, string> = {
  'mcp.title': 'MCP',
  'mcp.description': '检查 mcporter 运行环境是否就绪',
  'mcp.refresh': '刷新状态',
  'mcp.loadFailed': '加载 MCP 状态失败',
  'mcp.health.title': 'mcporter健康检测',
  'mcp.health.description': 'GeeClaw 仅检测系统 PATH 里的 mcporter，CLI Market 安装后也会按同样方式识别。',
  'mcp.system.title': '系统',
  'mcp.system.present': '已安装',
  'mcp.system.missing': '未安装',
  'mcp.system.version': '版本',
  'mcp.system.path': '路径',
  'mcp.system.emptyPath': '未检测到系统 PATH 中的 mcporter',
  'mcp.system.unknown': '未知',
  'mcp.install.title': '安装引导',
  'mcp.install.description': '当前系统 PATH 里还没有 mcporter。建议先去 CLI 市场安装，安装完成后 GeeClaw 和终端都会按系统命令直接使用它。',
  'mcp.install.marketplace': '前往 CLI 市场安装',
  'mcp.install.guide': '打开官方安装说明',
  'mcp.install.repo': '打开项目主页',
  'opencli.status.checking': '检查中',
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

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
  toUserMessage: (error: unknown) => String(error),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('McpSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the system health section only when mcporter is installed', async () => {
    hostApiFetchMock.mockResolvedValue({
      mcporter: {
        installed: true,
        binaryPath: '/usr/local/bin/mcporter',
        version: '0.2.0',
        system: {
          exists: true,
          path: '/usr/local/bin/mcporter',
          version: '0.2.0',
        },
      },
    });

    render(<McpSettingsSection />);

    expect(await screen.findByText('mcporter健康检测')).toBeInTheDocument();
    expect(screen.getByText('系统')).toBeInTheDocument();
    expect(screen.getAllByText('版本')).toHaveLength(1);
    expect(screen.getAllByText('路径')).toHaveLength(1);
    expect(screen.queryByText('GeeClaw预置')).not.toBeInTheDocument();
    expect(screen.queryByText('安装引导')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/mcp/status');
    });
  });

  it('guides users to CLI Market when system mcporter is missing', async () => {
    hostApiFetchMock.mockResolvedValue({
      mcporter: {
        installed: false,
        binaryPath: null,
        version: null,
        installGuideUrl: 'https://example.com/install',
        repositoryUrl: 'https://example.com/repo',
        system: {
          exists: false,
          path: null,
          version: null,
          error: 'missing',
        },
      },
    });

    render(<McpSettingsSection />);

    expect(await screen.findByText('安装引导')).toBeInTheDocument();
    expect(screen.getByText('未检测到系统 PATH 中的 mcporter')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '前往 CLI 市场安装' }));
    expect(navigateMock).toHaveBeenCalledWith('/settings/cli-marketplace');

    fireEvent.click(screen.getByRole('button', { name: '打开官方安装说明' }));
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', 'https://example.com/install');
  });
});
