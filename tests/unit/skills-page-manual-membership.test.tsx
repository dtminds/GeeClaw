import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSkillsStore } from '@/stores/skills';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';

const invokeIpcMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => ({
      'filter.allSkills': 'Installed',
      'marketplace.title': 'Marketplace',
      'filter.all': 'All',
      'filter.enabled': 'Enabled',
      'filter.builtIn': 'Built In',
      'filter.openclawExtra': 'Extra',
      'filter.openclawManaged': 'Managed',
      'filter.personal': 'Global',
      'agentScope.label': 'Agent',
      'toast.enabled': 'Enabled',
      'toast.disabled': 'Disabled',
      'search': 'Search skills...',
      'gatewayWarning': 'Gateway not running',
      'noSkillsAvailable': 'No skills available',
      'noSkillsSearch': 'No matching skills',
    }[key] || options?.defaultValue || key),
  }),
}));

describe('skills page manual membership editing', () => {
  const initialSkillsState = useSkillsStore.getState();
  const initialAgentsState = useAgentsStore.getState();
  const initialGatewayState = useGatewayStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    invokeIpcMock.mockResolvedValue('~/.openclaw/skills');

    useGatewayStore.setState({
      ...initialGatewayState,
      status: {
        ...initialGatewayState.status,
        state: 'running',
      },
    });
  });

  afterEach(() => {
    useSkillsStore.setState(initialSkillsState);
    useAgentsStore.setState(initialAgentsState);
    useGatewayStore.setState(initialGatewayState);
  });

  it('renders the agent selector as a text-style dropdown without framed field chrome', async () => {
    useSkillsStore.setState({
      ...initialSkillsState,
      loading: false,
      error: null,
      skills: [],
      fetchSkills: vi.fn().mockResolvedValue(undefined),
      fetchMarketplaceCatalog: vi.fn().mockResolvedValue(undefined),
      fetchCategorySkills: vi.fn().mockResolvedValue(undefined),
      installSkill: vi.fn().mockResolvedValue(undefined),
      uninstallSkill: vi.fn().mockResolvedValue(undefined),
      enableSkill: vi.fn().mockResolvedValue(undefined),
      disableSkill: vi.fn().mockResolvedValue(undefined),
      setSkills: vi.fn(),
      updateSkill: vi.fn(),
      installing: {},
      marketplaceCatalog: null,
      marketplaceLoading: false,
      marketplaceError: null,
      categorySkills: [],
      categorySkillsTotal: 0,
      categorySkillsLoading: false,
    });
    useAgentsStore.setState({
      ...initialAgentsState,
      agents: [{
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5.4',
        inheritedModel: false,
        workspace: '~/geeclaw/workspace',
        agentDir: '~/.openclaw-geeclaw/agents/main/agent',
        mainSessionKey: 'main',
        channelTypes: [],
        channelAccounts: [],
        source: 'custom',
        managed: false,
        lockedFields: [],
        canUnmanage: false,
        managedFiles: [],
        skillScope: { mode: 'default' },
        presetSkills: [],
        canUseDefaultSkillScope: true,
        avatarPresetId: 'gradient-sunset',
        avatarSource: 'default',
      }],
      defaultAgentId: 'main',
      fetchAgents: vi.fn().mockResolvedValue(undefined),
    });

    const { Skills } = await import('@/pages/Skills/index');
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/skills?agentId=main']}>
          <Skills />
        </MemoryRouter>,
      );
    });

    const selector = screen.getByRole('combobox');
    expect(selector.className).toContain('bg-transparent');
    expect(selector.className).toContain('border-0');
    expect(selector.className).not.toContain('shadow');
  });

  it('bottom-aligns the secondary filter row so the active underline sits on the tab baseline', async () => {
    useSkillsStore.setState({
      ...initialSkillsState,
      loading: false,
      error: null,
      skills: [],
      fetchSkills: vi.fn().mockResolvedValue(undefined),
      fetchMarketplaceCatalog: vi.fn().mockResolvedValue(undefined),
      fetchCategorySkills: vi.fn().mockResolvedValue(undefined),
      installSkill: vi.fn().mockResolvedValue(undefined),
      uninstallSkill: vi.fn().mockResolvedValue(undefined),
      enableSkill: vi.fn().mockResolvedValue(undefined),
      disableSkill: vi.fn().mockResolvedValue(undefined),
      setSkills: vi.fn(),
      updateSkill: vi.fn(),
      installing: {},
      marketplaceCatalog: null,
      marketplaceLoading: false,
      marketplaceError: null,
      categorySkills: [],
      categorySkillsTotal: 0,
      categorySkillsLoading: false,
    });
    useAgentsStore.setState({
      ...initialAgentsState,
      agents: [{
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5.4',
        inheritedModel: false,
        workspace: '~/geeclaw/workspace',
        agentDir: '~/.openclaw-geeclaw/agents/main/agent',
        mainSessionKey: 'main',
        channelTypes: [],
        channelAccounts: [],
        source: 'custom',
        managed: false,
        lockedFields: [],
        canUnmanage: false,
        managedFiles: [],
        skillScope: { mode: 'default' },
        presetSkills: [],
        canUseDefaultSkillScope: true,
        avatarPresetId: 'gradient-sunset',
        avatarSource: 'default',
      }],
      defaultAgentId: 'main',
      fetchAgents: vi.fn().mockResolvedValue(undefined),
    });

    const { Skills } = await import('@/pages/Skills/index');
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/skills?agentId=main']}>
          <Skills />
        </MemoryRouter>,
      );
    });

    const subtabRow = screen.getByText('Agent').closest('div.border-b');
    expect(subtabRow).not.toBeNull();
    expect(subtabRow?.className).toContain('items-end');
    expect(subtabRow?.className).not.toContain('items-center');
  });

  it('does not fall back to legacy enabled skills when manualSkills is explicitly empty', async () => {
    const fetchSkills = vi.fn().mockResolvedValue(undefined);
    const updateAgentSettings = vi.fn().mockResolvedValue(undefined);

    useSkillsStore.setState({
      ...initialSkillsState,
      loading: false,
      error: null,
      skills: [
        {
          id: 'fresh-skill',
          slug: 'fresh-skill',
          name: 'Fresh Skill',
          description: 'Fresh skill',
          enabled: false,
          configuredEnabled: false,
          eligible: true,
          blockedByAllowlist: false,
          hidden: false,
          icon: '🧩',
          isBundled: false,
          isCore: false,
          source: 'agents-skills-personal',
        },
        {
          id: 'legacy-skill',
          slug: 'legacy-skill',
          name: 'Legacy Skill',
          description: 'Legacy skill',
          enabled: true,
          configuredEnabled: true,
          eligible: true,
          blockedByAllowlist: false,
          hidden: false,
          icon: '🧩',
          isBundled: false,
          isCore: false,
          source: 'agents-skills-personal',
        },
      ],
      fetchSkills,
      fetchMarketplaceCatalog: vi.fn().mockResolvedValue(undefined),
      fetchCategorySkills: vi.fn().mockResolvedValue(undefined),
      installSkill: vi.fn().mockResolvedValue(undefined),
      uninstallSkill: vi.fn().mockResolvedValue(undefined),
      enableSkill: vi.fn().mockResolvedValue(undefined),
      disableSkill: vi.fn().mockResolvedValue(undefined),
      setSkills: vi.fn(),
      updateSkill: vi.fn(),
      installing: {},
      marketplaceCatalog: null,
      marketplaceLoading: false,
      marketplaceError: null,
      categorySkills: [],
      categorySkillsTotal: 0,
      categorySkillsLoading: false,
    });

    useAgentsStore.setState({
      ...initialAgentsState,
      agents: [{
        id: 'writer',
        name: 'Writer',
        isDefault: false,
        modelDisplay: 'gpt-5.4',
        inheritedModel: false,
        workspace: '~/geeclaw/workspace-writer',
        agentDir: '~/.openclaw-geeclaw/agents/writer/agent',
        mainSessionKey: 'writer',
        channelTypes: [],
        channelAccounts: [],
        source: 'custom',
        managed: false,
        lockedFields: [],
        canUnmanage: false,
        managedFiles: [],
        skillScope: { mode: 'default' },
        manualSkills: [],
        presetSkills: [],
        canUseDefaultSkillScope: true,
        avatarPresetId: 'gradient-sunset',
        avatarSource: 'default',
      }],
      defaultAgentId: 'writer',
      fetchAgents: vi.fn().mockResolvedValue(undefined),
      updateAgentSettings,
    });

    const { Skills } = await import('@/pages/Skills/index');
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/skills?agentId=writer']}>
          <Skills />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('All').closest('button') as HTMLButtonElement);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('switch')[0]);
    });

    await waitFor(() => {
      expect(updateAgentSettings).toHaveBeenCalledWith('writer', {
        manualSkills: ['fresh-skill'],
      });
    });
    expect(fetchSkills).toHaveBeenCalledWith('writer');
  });
});
