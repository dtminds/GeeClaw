import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSettingsSection } from '@/components/settings/McpSettingsSection';

const hostApiFetchMock = vi.fn();

const translations: Record<string, string> = {
  'mcp.title': 'MCP',
  'mcp.description': '检查 mcporter 运行环境是否就绪',
  'mcp.refresh': '刷新状态',
  'mcp.loadFailed': '加载 MCP 状态失败',
  'mcp.health.title': 'mcporter健康检测',
  'mcp.health.description': 'GeeClaw 会优先识别系统 PATH 里的 mcporter，如未安装将使用内置的环境',
  'mcp.system.title': '系统',
  'mcp.system.present': '已安装',
  'mcp.system.missing': '未安装',
  'mcp.system.version': '版本',
  'mcp.system.path': '路径',
  'mcp.system.emptyPath': '未检测到系统 PATH 中的 mcporter',
  'mcp.system.unknown': '未知',
  'mcp.bundled.title': 'GeeClaw预置',
  'mcp.bundled.present': '可用',
  'mcp.bundled.missing': '缺失',
  'mcp.bundled.version': '版本',
  'mcp.install.title': '安装引导',
  'mcp.install.description': '当前系统 PATH 里还没有 mcporter。按下面方式安装后，GeeClaw 和终端都可以直接使用它。',
  'mcp.install.step1': '1. 想先试用时，可以在终端运行：',
  'mcp.install.step2': '2. 想把它作为当前项目依赖，可以运行：',
  'mcp.install.step3': '3. 想让系统命令行里直接可用，请打开官方安装说明，按你的平台选择合适方式。',
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

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
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

  it('renders the merged health section with system and bundled columns', async () => {
    hostApiFetchMock.mockResolvedValue({
      mcporter: {
        installed: true,
        binaryPath: '/usr/local/bin/mcporter',
        version: '0.2.0',
        installGuideUrl: 'https://example.com/install',
        repositoryUrl: 'https://example.com/repo',
        quickStartCommand: 'npx mcporter list',
        projectInstallCommand: 'pnpm add mcporter',
        system: {
          exists: true,
          path: '/usr/local/bin/mcporter',
          version: '0.2.0',
        },
        bundled: {
          exists: true,
          path: '/Applications/GeeClaw.app/Contents/Resources/mcporter/dist/cli.js',
          version: '0.2.0',
          wrapperPath: '/Applications/GeeClaw.app/Contents/Resources/managed-bin/mcporter',
          runtimeDir: '/Applications/GeeClaw.app/Contents/Resources/mcporter',
        },
      },
    });

    render(<McpSettingsSection />);

    expect(await screen.findByText('mcporter健康检测')).toBeInTheDocument();
    expect(screen.getByText('系统')).toBeInTheDocument();
    expect(screen.getByText('GeeClaw预置')).toBeInTheDocument();
    expect(screen.getAllByText('版本')).toHaveLength(2);
    expect(screen.getAllByText('路径')).toHaveLength(1);
    expect(screen.queryByText('安装引导')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/mcp/status');
    });
  });

  it('shows the install guide only when system mcporter is missing', async () => {
    hostApiFetchMock.mockResolvedValue({
      mcporter: {
        installed: false,
        binaryPath: null,
        version: null,
        installGuideUrl: 'https://example.com/install',
        repositoryUrl: 'https://example.com/repo',
        quickStartCommand: 'npx mcporter list',
        projectInstallCommand: 'pnpm add mcporter',
        system: {
          exists: false,
          path: null,
          version: null,
          error: 'missing',
        },
        bundled: {
          exists: true,
          path: '/Applications/GeeClaw.app/Contents/Resources/mcporter/dist/cli.js',
          version: '0.2.0',
          wrapperPath: '/Applications/GeeClaw.app/Contents/Resources/managed-bin/mcporter',
          runtimeDir: '/Applications/GeeClaw.app/Contents/Resources/mcporter',
        },
      },
    });

    render(<McpSettingsSection />);

    expect(await screen.findByText('安装引导')).toBeInTheDocument();
    expect(screen.getByText('未检测到系统 PATH 中的 mcporter')).toBeInTheDocument();
  });
});
