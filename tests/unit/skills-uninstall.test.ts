import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: (...args: unknown[]) => rpcMock(...args),
    }),
  },
}));

describe('skills store uninstall', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('sends skill metadata when uninstalling from the installed skills list', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    rpcMock.mockResolvedValueOnce({ skills: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().uninstallSkill({
      slug: 'friendly-skill',
      skillKey: 'Friendly Skill',
      baseDir: '/tmp/openclaw/skills/friendly-skill',
    });

    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/clawhub/uninstall', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'friendly-skill',
        skillKey: 'Friendly Skill',
        baseDir: '/tmp/openclaw/skills/friendly-skill',
      }),
    });
  });

  it('refreshes the requested agent scope after uninstalling a skill', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    rpcMock.mockResolvedValueOnce({ skills: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: [], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await (useSkillsStore.getState().uninstallSkill as (
      target: {
        slug: string;
        skillKey: string;
        baseDir: string;
      },
      agentId?: string,
    ) => Promise<void>)({
      slug: 'friendly-skill',
      skillKey: 'Friendly Skill',
      baseDir: '/tmp/openclaw/skills/friendly-skill',
    }, 'writer');

    expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'writer' });
    expect(hostApiFetchMock.mock.calls[1]).toEqual(['/api/clawhub/list?agentId=writer']);
    expect(hostApiFetchMock.mock.calls[2]).toEqual(['/api/skills/configs?agentId=writer']);
    expect(hostApiFetchMock.mock.calls[3]).toEqual(['/api/skills/policy?agentId=writer']);
  });
});
