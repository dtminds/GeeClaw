import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translations: Record<string, string> = {
  'startup.gatewayRecovery.recovering.eyebrow': '网关恢复中',
  'startup.gatewayRecovery.recovering.title': '正在重启 OpenClaw',
  'startup.gatewayRecovery.recovering.body': '部分功能暂时不可用 我们会在网关恢复后自动继续',
  'startup.gatewayRecovery.recovering.caption': '这通常只需要十几秒 请保持窗口打开',
  'startup.gatewayRecovery.error.title': 'OpenClaw 网关未能恢复',
  'startup.gatewayRecovery.error.body': '我们尝试重新连接 OpenClaw 网关，但这次没有成功。您可以直接重试，或查看下面的详情。',
  'startup.gatewayRecovery.error.retry': '重试',
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

describe('GatewayRecoveryOverlay', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { useGatewayStore } = await import('@/stores/gateway');
    useGatewayStore.setState({
      status: { state: 'running', port: 28788 },
      lastError: null,
      restart: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('shows a blocking recovery dialog while the gateway is starting', async () => {
    const { GatewayRecoveryOverlay } = await import('@/components/gateway/GatewayRecoveryOverlay');
    const { useGatewayStore } = await import('@/stores/gateway');
    render(<GatewayRecoveryOverlay />);

    act(() => {
      useGatewayStore.setState({
        status: { state: 'starting', port: 28788 },
      });
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('正在重启 OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('这通常只需要十几秒 请保持窗口打开')).toBeInTheDocument();
  });

  it('shows the recovery failure page and retries from there', async () => {
    const { GatewayRecoveryOverlay } = await import('@/components/gateway/GatewayRecoveryOverlay');
    const { useGatewayStore } = await import('@/stores/gateway');
    const restartMock = vi.fn().mockResolvedValue(undefined);
    useGatewayStore.setState({ restart: restartMock });

    render(<GatewayRecoveryOverlay />);

    act(() => {
      useGatewayStore.setState({
        status: { state: 'reconnecting', port: 28788, reconnectAttempts: 2 },
      });
    });

    act(() => {
      useGatewayStore.setState({
        status: { state: 'error', port: 28788, error: 'Gateway failed to restart' },
      });
    });

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw 网关未能恢复')).toBeInTheDocument();
    expect(screen.getByText('Gateway failed to restart')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(restartMock).toHaveBeenCalledTimes(1);
    });
  });
});
