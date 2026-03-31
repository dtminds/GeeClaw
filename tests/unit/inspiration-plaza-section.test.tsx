import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'inspirationPlaza.title': '灵感广场',
        'inspirationPlaza.description': '从灵感模板里挑一个方向。',
        'inspirationPlaza.all': '全部灵感',
        'inspirationPlaza.categories.productivity': '办公提效',
        'inspirationPlaza.categories.study': '研究学习',
        'inspirationPlaza.categories.fun': '娱乐游戏',
        'inspirationPlaza.categories.life': '自律生活',
        'inspirationPlaza.close': '关闭',
      };
      return translations[key] || key;
    },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      agents: [],
      defaultAgentId: 'main',
      fetchAgents: vi.fn(async () => undefined),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      openAgentMainSession: vi.fn(async () => undefined),
      queueComposerSeed: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

describe('InspirationPlazaSection', () => {
  it('uses fixed card text clamps so titles and descriptions align vertically', async () => {
    const { InspirationPlazaSection } = await import('@/components/dashboard/InspirationPlazaSection');
    const { container } = render(<InspirationPlazaSection />);

    const firstTitle = container.querySelector('h3');
    const firstDescription = container.querySelector('h3 + p');

    expect(firstTitle?.className).toContain('line-clamp-1');
    expect(firstTitle?.className).toContain('min-h');
    expect(firstDescription?.className).toContain('line-clamp-2');
    expect(firstDescription?.className).toContain('min-h');
  });
});
