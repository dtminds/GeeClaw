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

describe('skills store error mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('maps fetchSkills rate-limit error by AppError code', async () => {
    rpcMock.mockResolvedValueOnce({ skills: [] });
    hostApiFetchMock.mockRejectedValueOnce(new Error('rate limit exceeded'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().error).toBe('fetchRateLimitError');
  });

  it('surfaces marketplace catalog load errors on the marketplace error field', async () => {
    hostApiFetchMock.mockRejectedValueOnce(new Error('request timeout'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchMarketplaceCatalog(true);

    expect(useSkillsStore.getState().marketplaceError).toContain('request timeout');
  });

  it('maps installSkill timeout result into installTimeoutError', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: false, error: 'request timeout' });

    const { useSkillsStore } = await import('@/stores/skills');
    await expect(useSkillsStore.getState().installSkill('demo-skill')).rejects.toThrow('installTimeoutError');
  });

  it('refreshes the requested agent scope after installing a skill', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    rpcMock.mockResolvedValueOnce({ skills: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: [], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await (useSkillsStore.getState().installSkill as (
      slug: string,
      version?: string,
      agentId?: string,
    ) => Promise<void>)('demo-skill', undefined, 'writer');

    expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'writer' });
    expect(hostApiFetchMock.mock.calls[1]).toEqual(['/api/clawhub/list?agentId=writer']);
    expect(hostApiFetchMock.mock.calls[2]).toEqual(['/api/skills/configs?agentId=writer']);
    expect(hostApiFetchMock.mock.calls[3]).toEqual(['/api/skills/policy?agentId=writer']);
  });
});
