import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const openAgentMainSessionMock = vi.hoisted(() => vi.fn(async () => undefined));
const queueComposerSeedMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'inspirationPlaza.title': '灵感广场',
        'inspirationPlaza.all': '全部灵感',
        'inspirationPlaza.sceneTitle': '适用场景',
        'inspirationPlaza.promptTitle': 'Prompt',
        'inspirationPlaza.requiredSkillsTitle': '所需技能',
        'inspirationPlaza.requiredSkillsChecking': '正在检查所需技能',
        'inspirationPlaza.requiredSkillsReady': '所需技能已就绪',
        'inspirationPlaza.useNow': '立即使用',
        'inspirationPlaza.close': '关闭',
      };

      if (key === 'inspirationPlaza.requiredSkillsMissing') {
        return `缺少以下技能：${options?.skills}。建议先安装或启用后再使用该模板`;
      }

      if (key === 'inspirationPlaza.categories.productivity') {
        return '办公提效';
      }

      return translations[key] || key;
    },
  }),
}));

vi.mock('@/assets/inspiration/inspiration.json', () => ({
  default: {
    data: {
      resp: {
        data: {
          list: [
            {
              category: '办公提效',
              order: 1,
              title: '热点资讯自动汇总',
              subtitle: '每日自动整理资讯',
              prompt: '设置每日任务',
              scene: '适合通勤时快速浏览',
              required_skills: ['news-summary'],
              is_show: true,
            },
          ],
        },
      },
    },
  },
}));

const useAgentsStoreMock = vi.hoisted(() => {
  const agentsStoreState = {
    agents: [],
    defaultAgentId: 'main',
    fetchAgents: vi.fn(async () => undefined),
  };

  return Object.assign(
    (selector: (state: {
      agents: unknown[];
      defaultAgentId: string;
      fetchAgents: () => Promise<void>;
    }) => unknown) => selector(agentsStoreState),
    {
      getState: () => agentsStoreState,
    },
  );
});

vi.mock('@/stores/agents', () => ({
  useAgentsStore: useAgentsStoreMock,
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: {
    openAgentMainSession: typeof openAgentMainSessionMock;
    queueComposerSeed: typeof queueComposerSeedMock;
  }) => unknown) => selector({
    openAgentMainSession: openAgentMainSessionMock,
    queueComposerSeed: queueComposerSeedMock,
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: rpcMock,
    }),
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('InspirationPlazaSection', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    rpcMock.mockReset();
    openAgentMainSessionMock.mockReset();
    queueComposerSeedMock.mockReset();
  });

  it('shows missing required skills when the selected inspiration item needs unavailable skills', async () => {
    rpcMock.mockResolvedValue({
      skills: [],
    });

    const { InspirationPlazaSection } = await import('@/components/dashboard/InspirationPlazaSection');
    render(<InspirationPlazaSection />);

    fireEvent.click(screen.getByRole('button', { name: /热点资讯自动汇总/i }));

    expect(await screen.findByText('缺少以下技能：news-summary。建议先安装或启用后再使用该模板')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去管理技能' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即使用' })).toBeDisabled();
    expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'main' });
  });

  it('hides the required skills section when all required skills are already enabled', async () => {
    rpcMock.mockResolvedValue({
      skills: [
        {
          skillKey: 'news-summary',
          eligible: true,
          disabled: false,
        },
      ],
    });

    const { InspirationPlazaSection } = await import('@/components/dashboard/InspirationPlazaSection');
    render(<InspirationPlazaSection />);

    fireEvent.click(screen.getByRole('button', { name: /热点资讯自动汇总/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '立即使用' })).toBeEnabled();
    });
  });

  it('prefixes required skills when queuing the inspiration prompt', async () => {
    rpcMock.mockResolvedValue({
      skills: [
        {
          skillKey: 'news-summary',
          eligible: true,
          disabled: false,
        },
      ],
    });

    const { InspirationPlazaSection } = await import('@/components/dashboard/InspirationPlazaSection');
    render(<InspirationPlazaSection />);

    fireEvent.click(screen.getByRole('button', { name: /热点资讯自动汇总/i }));
    fireEvent.click(await screen.findByRole('button', { name: '立即使用' }));

    await waitFor(() => {
      expect(openAgentMainSessionMock).toHaveBeenCalledWith('main');
      expect(queueComposerSeedMock).toHaveBeenCalledWith('/news-summary 设置每日任务', ['news-summary']);
      expect(navigateMock).toHaveBeenCalledWith('/chat');
    });
  });
});
