import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common:sidebar.dashboard': '广场',
        pageSubtitle: '发现预设智能体和灵感模板',
        'plaza.tabs.agents': '智能体广场',
        'plaza.tabs.inspiration': '灵感广场',
      };
      return translations[key] || key;
    },
  }),
}));

vi.mock('@/components/settings/DashboardSettingsSection', () => ({
  DashboardSettingsSection: ({ className }: { className?: string }) => (
    <div className={className}>运行状态卡片</div>
  ),
}));

vi.mock('@/components/dashboard', () => ({
  PresetAgentsPlazaSection: () => <div>智能体广场内容</div>,
  InspirationPlazaSection: () => <div>灵感广场内容</div>,
}));

describe('Dashboard plaza shell', () => {
  it('renders running status first and defaults to the preset agent plaza tab', async () => {
    const { Dashboard } = await import('@/pages/Dashboard');
    render(<Dashboard />);

    expect(screen.getByText('运行状态卡片')).toBeInTheDocument();
    expect(screen.queryByText('运行状态')).not.toBeInTheDocument();
    expect(screen.queryByText('查看 OpenClaw、频道连接与常用快捷操作。')).not.toBeInTheDocument();

    const agentsTab = screen.getByRole('tab', { name: '智能体广场' });
    const inspirationTab = screen.getByRole('tab', { name: '灵感广场' });
    const tablist = screen.getByRole('tablist', { name: '广场' });

    expect(tablist.className).toContain('rounded-full');
    expect(tablist.className).toContain('bg-muted/40');
    expect(agentsTab.className).toContain('rounded-full');
    expect(agentsTab.className).toContain('bg-foreground');
    expect(agentsTab).toHaveAttribute('aria-selected', 'true');
    expect(inspirationTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('智能体广场内容')).toBeInTheDocument();
    expect(screen.queryByText('灵感广场内容')).not.toBeInTheDocument();
  });

  it('switches between preset agent plaza and inspiration plaza tabs', async () => {
    const { Dashboard } = await import('@/pages/Dashboard');
    render(<Dashboard />);

    fireEvent.click(screen.getByRole('tab', { name: '灵感广场' }));

    expect(screen.getByRole('tab', { name: '灵感广场' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('智能体广场内容')).not.toBeInTheDocument();
    expect(screen.getByText('灵感广场内容')).toBeInTheDocument();
  });
});
