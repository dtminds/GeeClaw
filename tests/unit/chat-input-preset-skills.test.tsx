import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useSkillsStore } from '@/stores/skills';
import { ChatInput } from '@/pages/Chat/ChatInput';
import type { AgentSummary } from '@/types/agent';

const {
  fetchPresetAgentSkillsMock,
  fetchAgentScopedSkillsMock,
  hostApiFetchMock,
  buildSlashPickerItemsMock,
  isSlashCommandItemMock,
  editorInsertContentMock,
  editorChainFocusMock,
  editorRunMock,
  editorCommandsFocusMock,
  editorCommandsSetContentMock,
} = vi.hoisted(() => ({
  fetchPresetAgentSkillsMock: vi.fn(),
  fetchAgentScopedSkillsMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  buildSlashPickerItemsMock: vi.fn(({ presetAgentSkills = [], globalSkills = [] }: { presetAgentSkills?: unknown[]; globalSkills?: unknown[] }) => (
    [...presetAgentSkills, ...globalSkills]
  )),
  isSlashCommandItemMock: vi.fn((item: { type?: string }) => item?.type === 'command'),
  editorInsertContentMock: vi.fn(),
  editorChainFocusMock: vi.fn(),
  editorRunMock: vi.fn(),
  editorCommandsFocusMock: vi.fn(),
  editorCommandsSetContentMock: vi.fn(),
}));

vi.mock('@/pages/Chat/slash-picker', () => ({
  buildSlashPickerItems: buildSlashPickerItemsMock,
  fetchAgentScopedSkills: fetchAgentScopedSkillsMock,
  fetchPresetAgentSkills: fetchPresetAgentSkillsMock,
  getSlashCommandDescription: vi.fn(() => ''),
  getSlashCommandName: vi.fn(() => ''),
  getVisibleSlashItems: vi.fn(() => []),
  isSlashCommandItem: isSlashCommandItemMock,
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: hostApiFetchMock,
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
  toUserMessage: vi.fn((value: unknown) => String(value ?? '')),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, value?: string | { defaultValue?: string }) => {
        if (typeof value === 'string') {
          return value;
        }
        if (value && typeof value === 'object' && typeof value.defaultValue === 'string') {
          return value.defaultValue;
        }
        return key;
      },
    }),
  };
});

vi.mock('@tiptap/starter-kit', () => ({
  default: {
    configure: vi.fn(() => ({})),
  },
}));

vi.mock('@tiptap/react', () => ({
  EditorContent: () => React.createElement('div', { 'data-testid': 'editor-content' }),
  Node: {
    create: vi.fn(() => ({})),
  },
  NodeViewWrapper: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
  ReactNodeViewRenderer: vi.fn(() => () => null),
  mergeAttributes: (...items: Array<Record<string, unknown>>) => Object.assign({}, ...items),
  useEditor: vi.fn(() => {
    const chain = {
      focus: (...args: unknown[]) => {
        editorChainFocusMock(...args);
        return chain;
      },
      insertContent: (...args: unknown[]) => {
        editorInsertContentMock(...args);
        return chain;
      },
      run: (...args: unknown[]) => {
        editorRunMock(...args);
        return true;
      },
    };

    return {
      chain: () => chain,
      commands: {
        focus: editorCommandsFocusMock,
        setContent: editorCommandsSetContentMock,
      },
      setEditable: vi.fn(),
      getJSON: () => ({ type: 'doc', content: [] }),
      state: {
        selection: {
          empty: true,
          from: 0,
          $from: {
            parentOffset: 0,
            parent: {
              textBetween: () => '',
            },
          },
        },
      },
    };
  }),
}));

describe('ChatInput preset agent skills loading', () => {
  let agentsState: ReturnType<typeof useAgentsStore.getState>;
  let chatState: ReturnType<typeof useChatStore.getState>;
  let gatewayState: ReturnType<typeof useGatewayStore.getState>;
  let providerState: ReturnType<typeof useProviderStore.getState>;
  let skillsState: ReturnType<typeof useSkillsStore.getState>;

  const presetAgent: AgentSummary = {
    id: 'delivery-execution',
    name: '交付执行官',
    isDefault: false,
    modelDisplay: 'gemini',
    inheritedModel: true,
    workspace: '/Users/lsave/geeclaw/workspace-delivery-execution',
    agentDir: '/Users/lsave/geeclaw/workspace-delivery-execution/.agent',
    mainSessionKey: 'agent:delivery-execution:main',
    channelTypes: [],
    channelAccounts: [],
    source: 'preset',
    managed: true,
    presetId: 'delivery-execution',
    lockedFields: ['id', 'workspace', 'persona'],
    canUnmanage: true,
    managedFiles: ['AGENTS.md'],
    skillScope: {
      mode: 'specified',
      skills: ['dummy-dataset', 'job-stories'],
    },
    presetSkills: ['dummy-dataset', 'job-stories'],
    canUseDefaultSkillScope: false,
  };
  const customAgent: AgentSummary = {
    ...presetAgent,
    id: 'workspace-custom',
    name: 'Workspace Custom',
    mainSessionKey: 'agent:workspace-custom:main',
    workspace: '/Users/lsave/geeclaw/workspace-custom',
    agentDir: '/Users/lsave/geeclaw/workspace-custom/.agent',
    source: 'custom',
    managed: false,
    presetId: undefined,
    lockedFields: [],
    canUnmanage: false,
    managedFiles: [],
    skillScope: { mode: 'default' },
    presetSkills: [],
    canUseDefaultSkillScope: true,
  };

  beforeEach(() => {
    agentsState = useAgentsStore.getState();
    chatState = useChatStore.getState();
    gatewayState = useGatewayStore.getState();
    providerState = useProviderStore.getState();
    skillsState = useSkillsStore.getState();

    fetchPresetAgentSkillsMock.mockReset();
    fetchPresetAgentSkillsMock.mockResolvedValue([]);
    fetchAgentScopedSkillsMock.mockReset();
    fetchAgentScopedSkillsMock.mockResolvedValue([]);
    hostApiFetchMock.mockReset();
    buildSlashPickerItemsMock.mockClear();
    isSlashCommandItemMock.mockClear();
    editorInsertContentMock.mockReset();
    editorChainFocusMock.mockReset();
    editorRunMock.mockReset();
    editorCommandsFocusMock.mockReset();
    editorCommandsSetContentMock.mockReset();
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings/safety') {
        return {
          toolPermission: 'default',
          approvalPolicy: 'full',
        };
      }

      return {};
    });

    useAgentsStore.setState({
      ...agentsState,
      agents: [presetAgent],
      fetchAgents: vi.fn(async () => {}),
    });
    useChatStore.setState({
      ...chatState,
      currentAgentId: 'delivery-execution',
      currentSessionKey: 'agent:delivery-execution:main',
      pendingComposerSeed: null,
      consumePendingComposerSeed: vi.fn(() => {
        useChatStore.setState((state) => ({
          ...state,
          pendingComposerSeed: null,
        }));
      }),
    });
    useGatewayStore.setState({
      ...gatewayState,
      status: { ...gatewayState.status, state: 'starting' },
      rpc: vi.fn(),
    });
    useProviderStore.setState({
      ...providerState,
      accounts: [],
      statuses: [],
      vendors: [],
      defaultAccountId: null,
      loading: true,
      refreshProviderSnapshot: vi.fn(async () => {}),
    });
    useSkillsStore.setState({
      ...skillsState,
      skills: [{
        id: 'global-skill',
        slug: 'global-skill',
        name: 'Global Skill',
        description: 'Useful helper for repetitive tasks',
        enabled: true,
        source: 'openclaw-managed',
      }],
      loading: false,
      fetchSkills: vi.fn(async () => {}),
    });
  });

  afterEach(() => {
    cleanup();
    useAgentsStore.setState(agentsState);
    useChatStore.setState(chatState);
    useGatewayStore.setState(gatewayState);
    useProviderStore.setState(providerState);
    useSkillsStore.setState(skillsState);
  });

  it('waits for the gateway to be running before loading preset agent skills and retries once running', async () => {
    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    expect(fetchPresetAgentSkillsMock).not.toHaveBeenCalled();

    act(() => {
      useGatewayStore.setState((state) => ({
        ...state,
        status: { ...state.status, state: 'running' },
      }));
    });

    await waitFor(() => {
      expect(fetchPresetAgentSkillsMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchPresetAgentSkillsMock).toHaveBeenCalledWith('delivery-execution', expect.any(Function));
  });

  it('uses agent-scoped skills.status candidates instead of the global store snapshot for the toolbar menu', async () => {
    fetchAgentScopedSkillsMock.mockResolvedValue([
      {
        id: 'agent-skill',
        slug: 'agent-skill',
        name: 'Agent Skill',
        description: 'Scoped to the current agent',
        enabled: true,
        source: 'openclaw-managed',
      },
    ]);

    useGatewayStore.setState((state) => ({
      ...state,
      status: { ...state.status, state: 'running' },
    }));

    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(fetchAgentScopedSkillsMock).toHaveBeenCalledWith('delivery-execution', expect.any(Function));
    });

    const skillsButton = screen.getByRole('button', { name: 'composer.skillsMenuLabel' });
    fireEvent.pointerDown(skillsButton);

    expect(await screen.findByText('Agent Skill')).toBeInTheDocument();
    expect(screen.queryByText('Global Skill')).not.toBeInTheDocument();
  });

  it('refreshes agent-scoped skills when the skills store updates', async () => {
    fetchAgentScopedSkillsMock.mockResolvedValue([
      {
        id: 'agent-skill',
        slug: 'agent-skill',
        name: 'Agent Skill',
        description: 'Scoped to the current agent',
        enabled: true,
        source: 'openclaw-managed',
      },
    ]);

    useGatewayStore.setState((state) => ({
      ...state,
      status: { ...state.status, state: 'running' },
    }));

    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(fetchAgentScopedSkillsMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useSkillsStore.setState((state) => ({
        ...state,
        skills: [
          ...state.skills,
          {
            id: 'new-global-skill',
            slug: 'new-global-skill',
            name: 'New Global Skill',
            description: 'Newly updated skill',
            enabled: true,
            source: 'openclaw-managed',
          },
        ],
      }));
    });

    await waitFor(() => {
      expect(fetchAgentScopedSkillsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to preset skill slugs when scoped status data is empty for a preset agent', async () => {
    fetchAgentScopedSkillsMock.mockResolvedValue([]);
    fetchPresetAgentSkillsMock.mockResolvedValue([]);

    useGatewayStore.setState((state) => ({
      ...state,
      status: { ...state.status, state: 'running' },
    }));
    useSkillsStore.setState((state) => ({
      ...state,
      skills: [],
      loading: false,
      fetchSkills: vi.fn(async () => {}),
    }));

    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    const skillsButton = screen.getByRole('button', { name: 'composer.skillsMenuLabel' });
    fireEvent.pointerDown(skillsButton);

    expect(await screen.findByText('dummy-dataset')).toBeInTheDocument();
    expect(screen.getByText('job-stories')).toBeInTheDocument();
  });

  it('loads workspace skills for custom agents and passes them to the slash picker as priority items', async () => {
    const workspaceSkill = {
      id: 'workspace-skill',
      slug: 'workspace-skill',
      name: 'Workspace Skill',
      description: 'Only visible in the current workspace',
      enabled: true,
      source: 'preset-agent-workspace',
    };
    const scopedSkill = {
      id: 'scoped-skill',
      slug: 'scoped-skill',
      name: 'Scoped Skill',
      description: 'Regular agent-scoped skill',
      enabled: true,
      source: 'openclaw-managed',
    };

    fetchPresetAgentSkillsMock.mockResolvedValue([workspaceSkill]);
    fetchAgentScopedSkillsMock.mockResolvedValue([scopedSkill]);
    useAgentsStore.setState((state) => ({
      ...state,
      agents: [customAgent],
    }));
    useChatStore.setState((state) => ({
      ...state,
      currentAgentId: customAgent.id,
      currentSessionKey: customAgent.mainSessionKey,
    }));
    useGatewayStore.setState((state) => ({
      ...state,
      status: { ...state.status, state: 'running' },
    }));

    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(fetchPresetAgentSkillsMock).toHaveBeenCalledWith(customAgent.id, expect.any(Function));
    });

    await waitFor(() => {
      expect(buildSlashPickerItemsMock).toHaveBeenLastCalledWith(expect.objectContaining({
        presetAgentSkills: [workspaceSkill],
        globalSkills: [scopedSkill],
      }));
    });
  });

  it('opens the toolbar skill menu with descriptive skill items and inserts a skill token', async () => {
    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    const skillsButton = screen.getByRole('button', { name: 'composer.skillsMenuLabel' });
    fireEvent.pointerDown(skillsButton);

    expect(await screen.findByText('Global Skill')).toBeInTheDocument();
    expect(screen.getByText('Useful helper for repetitive tasks')).toBeInTheDocument();
    expect(screen.getByText('Managed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Global Skill').closest('[role="menuitem"]') as HTMLElement);

    expect(editorInsertContentMock).toHaveBeenCalledWith([
      {
        type: 'skillToken',
        attrs: {
          id: 'global-skill',
          label: 'Global Skill',
          slug: 'global-skill',
          skillPath: null,
        },
      },
      { type: 'text', text: ' ' },
    ]);
    expect(editorRunMock).toHaveBeenCalled();
  });

  it('shows split safety controls in the composer footer menu', async () => {
    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    const safetyButton = screen.getByRole('button', { name: /composer\.safety\./ });
    fireEvent.pointerDown(safetyButton);

    expect(await screen.findByText('composer.safety.toolPermission')).toBeInTheDocument();
    expect(screen.getByText('composer.safety.approvalPolicy')).toBeInTheDocument();
  });

  it('renders the disabled model setup call-to-action when provided', async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <ChatInput
            onSend={vi.fn()}
            disabled
            disabledHint="composer.modelSetupHint"
            disabledAction={{
              to: '/settings/model-providers',
              label: 'composer.openModelProviders',
            }}
          />
        </MemoryRouter>,
      );
    });

    expect(screen.getByText('composer.modelSetupHint')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.openModelProviders' })).toHaveAttribute(
      'href',
      '/settings/model-providers',
    );
  });

  it('forces pending composer seed slash skill refs into skill tokens before skills finish loading', async () => {
    useChatStore.setState((state) => ({
      ...state,
      pendingComposerSeed: {
        text: '/news-summary Summarize today',
        nonce: Date.now(),
      },
      consumePendingComposerSeed: vi.fn(() => {
        useChatStore.setState((inner) => ({
          ...inner,
          pendingComposerSeed: null,
        }));
      }),
    }));
    useSkillsStore.setState((state) => ({
      ...state,
      skills: [],
      loading: true,
      fetchSkills: vi.fn(async () => {}),
    }));

    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(editorCommandsSetContentMock).toHaveBeenCalledWith({
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            {
              type: 'skillToken',
              attrs: {
                id: 'news-summary',
                label: 'news-summary',
                slug: 'news-summary',
                skillPath: null,
              },
            },
            { type: 'text', text: ' Summarize today' },
          ],
        }],
      });
    });
  });

  it('parses Chinese slash skill refs from pending composer seed into skill tokens', async () => {
    useChatStore.setState((state) => ({
      ...state,
      pendingComposerSeed: {
        text: '/文件整理 帮我整理桌面',
        nonce: Date.now(),
      },
      consumePendingComposerSeed: vi.fn(() => {
        useChatStore.setState((inner) => ({
          ...inner,
          pendingComposerSeed: null,
        }));
      }),
    }));
    useSkillsStore.setState((state) => ({
      ...state,
      skills: [],
      loading: true,
      fetchSkills: vi.fn(async () => {}),
    }));

    await act(async () => {
      render(
        <ChatInput
          onSend={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(editorCommandsSetContentMock).toHaveBeenCalledWith({
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            {
              type: 'skillToken',
              attrs: {
                id: '文件整理',
                label: '文件整理',
                slug: '文件整理',
                skillPath: null,
              },
            },
            { type: 'text', text: ' 帮我整理桌面' },
          ],
        }],
      });
    });
  });
});
