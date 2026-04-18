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

describe('skills store eligibility mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('marks gateway skills with missing requirements as unavailable', async () => {
    rpcMock.mockResolvedValueOnce({
      skills: [{
        skillKey: 'blucli',
        name: 'blucli',
        description: 'BluOS CLI',
        eligible: false,
        disabled: false,
        bundled: true,
        blockedByAllowlist: false,
        missing: {
          bins: ['blu'],
          anyBins: [],
          env: [],
          config: [],
          os: [],
        },
      }],
    });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, added: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: [], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().skills).toEqual([
      expect.objectContaining({
        id: 'blucli',
        enabled: false,
        configuredEnabled: true,
        eligible: false,
        missing: expect.objectContaining({
          bins: ['blu'],
        }),
      }),
    ]);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/skills/ensure-entries', expect.objectContaining({
      method: 'POST',
    }));
    expect(hostApiFetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({
        agentId: 'main',
        skills: [
          {
            skillKey: 'blucli',
            source: undefined,
          },
        ],
      }),
    }));
  });

  it('keeps manually-disabled skills available for manual re-enable', async () => {
    rpcMock.mockResolvedValueOnce({
      skills: [{
        skillKey: 'agent-browser',
        name: 'agent-browser',
        description: 'Browser automation',
        eligible: false,
        disabled: true,
        bundled: false,
        blockedByAllowlist: false,
        missing: {
          bins: [],
          anyBins: [],
          env: [],
          config: [],
          os: [],
        },
      }],
    });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, added: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: ['pdf'], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().skills).toEqual([
      expect.objectContaining({
        id: 'agent-browser',
        enabled: false,
        configuredEnabled: false,
        eligible: true,
      }),
    ]);
  });

  it('marks policy skills as core and blocks disabling from UI actions', async () => {
    rpcMock.mockResolvedValueOnce({
      skills: [{
        skillKey: 'pdf',
        name: 'pdf',
        description: 'PDF tools',
        eligible: true,
        disabled: false,
        bundled: false,
        blockedByAllowlist: false,
      }],
    });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, added: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: ['pdf'], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    const pdfSkill = useSkillsStore.getState().skills.find((skill) => skill.id === 'pdf');
    expect(pdfSkill).toEqual(expect.objectContaining({ isCore: true }));

    await expect(useSkillsStore.getState().disableSkill('pdf')).rejects.toThrow('Cannot disable core skill');
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('marks manifest-hidden skills so UI layers can suppress them by default', async () => {
    rpcMock.mockResolvedValueOnce({
      skills: [{
        skillKey: 'geeclaw-openclaw',
        name: 'GeeClaw OpenClaw',
        description: 'Internal bootstrap skill',
        eligible: true,
        disabled: false,
        bundled: false,
        blockedByAllowlist: false,
        source: 'openclaw-extra',
      }, {
        skillKey: 'visible-skill',
        name: 'Visible Skill',
        description: 'Visible skill',
        eligible: true,
        disabled: false,
        bundled: false,
        blockedByAllowlist: false,
        source: 'openclaw-extra',
      }],
    });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, added: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({
      alwaysEnabledSkillKeys: [],
      hiddenSkillKeys: ['geeclaw-openclaw'],
    });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().skills).toEqual([
      expect.objectContaining({
        id: 'geeclaw-openclaw',
        hidden: true,
      }),
      expect.objectContaining({
        id: 'visible-skill',
        hidden: false,
      }),
    ]);
  });

  it('fetches installed skills for the main agent by default', async () => {
    rpcMock.mockResolvedValueOnce({ skills: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, added: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: [], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'main' });
    expect(hostApiFetchMock.mock.calls[0]).toEqual(['/api/clawhub/list?agentId=main']);
    expect(hostApiFetchMock.mock.calls[1]).toEqual(['/api/skills/configs?agentId=main']);
    expect(hostApiFetchMock.mock.calls[2]).toEqual(['/api/skills/policy?agentId=main']);
  });

  it('fetches installed skills for an explicit agent id', async () => {
    rpcMock.mockResolvedValueOnce({
      skills: [{
        skillKey: 'writer-toolkit',
        name: 'Writer Toolkit',
        description: 'Agent-specific skill',
        eligible: true,
        disabled: false,
        bundled: false,
        blockedByAllowlist: false,
        source: 'agents-skills-project',
      }],
    });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, added: [] });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, results: [] });
    hostApiFetchMock.mockResolvedValueOnce({});
    hostApiFetchMock.mockResolvedValueOnce({ alwaysEnabledSkillKeys: [], hiddenSkillKeys: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills('writer');

    expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'writer' });
    expect(hostApiFetchMock.mock.calls[0]).toEqual([
      '/api/skills/ensure-entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          agentId: 'writer',
          skills: [{
            skillKey: 'writer-toolkit',
            source: 'agents-skills-project',
          }],
        }),
      }),
    ]);
    expect(hostApiFetchMock.mock.calls[1]).toEqual(['/api/clawhub/list?agentId=writer']);
    expect(hostApiFetchMock.mock.calls[2]).toEqual(['/api/skills/configs?agentId=writer']);
    expect(hostApiFetchMock.mock.calls[3]).toEqual(['/api/skills/policy?agentId=writer']);
  });
});
