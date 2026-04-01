import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentSettingsSection } from '@/components/settings/EnvironmentSettingsSection';

const hostApiFetchMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

const translations: Record<string, string> = {
  'environment.title': '环境变量',
  'environment.description': '管理注入到 GeeClaw 运行时的全局环境变量。',
  'environment.runtime.title': '全局注入',
  'environment.runtime.description': '这些变量会注入到 GeeClaw 管理的 Gateway / Agent 运行时，并用于依赖检查。',
  'environment.runtime.restartHint': '保存后会自动重启 Gateway 使变更生效。',
  'environment.list.empty': '还没有配置环境变量。',
  'environment.list.add': '添加变量',
  'environment.list.showValues': '显示值',
  'environment.list.hideValues': '隐藏值',
  'environment.list.keyPlaceholder': '变量名',
  'environment.list.valuePlaceholder': '变量值',
  'environment.list.save': '保存环境变量',
  'environment.toast.loadFailed': '加载环境变量失败',
  'environment.toast.saved': '环境变量已保存',
  'environment.toast.saveFailed': '保存环境变量失败',
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

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('@/lib/api-client', () => ({
  toUserMessage: (error: unknown) => String(error),
}));

describe('EnvironmentSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads, edits, and saves managed app environment entries', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/environment') {
        if (!init || init.method === undefined) {
          return {
            entries: [{ key: 'NOTION_API_KEY', value: 'secret-notion' }],
          };
        }
        return { success: true };
      }
      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<EnvironmentSettingsSection />);

    expect(await screen.findByText('全局注入')).toBeInTheDocument();
    expect(screen.getByDisplayValue('NOTION_API_KEY')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示值' }));
    expect(screen.getByDisplayValue('secret-notion')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添加变量' }));
    const keyInputs = screen.getAllByPlaceholderText('变量名');
    const valueInputs = screen.getAllByPlaceholderText('变量值');

    fireEvent.change(keyInputs[1], { target: { value: 'TAVILY_API_KEY' } });
    fireEvent.change(valueInputs[1], { target: { value: 'secret-tavily' } });
    fireEvent.click(screen.getByRole('button', { name: '保存环境变量' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/environment', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entries: [
            { key: 'NOTION_API_KEY', value: 'secret-notion' },
            { key: 'TAVILY_API_KEY', value: 'secret-tavily' },
          ],
        }),
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('环境变量已保存');
  });
});
