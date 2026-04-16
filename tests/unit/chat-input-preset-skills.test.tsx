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
  hostApiFetchMock,
  buildSlashPickerItemsMock,
  isSlashCommandItemMock,
  editorInsertContentMock,
  editorChainFocusMock,
  editorRunMock,
  editorCommandsFocusMock,
} = vi.hoisted(() => ({
  fetchPresetAgentSkillsMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  buildSlashPickerItemsMock: vi.fn(({ presetAgentSkills = [], globalSkills = [] }: { presetAgentSkills?: unknown[]; globalSkills?: unknown[] }) => (
    [...presetAgentSkills, ...globalSkills]
  )),
  isSlashCommandItemMock: vi.fn((item: { type?: string }) => item?.type === 'command'),
  editorInsertContentMock: vi.fn(),
  editorChainFocusMock: vi.fn(),
  editorRunMock: vi.fn(),
  editorCommandsFocusMock: vi.fn(),
}));

vi.mock('@/pages/Chat/slash-picker', () => ({
  buildSlashPickerItems: buildSlashPickerItemsMock,
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

  beforeEach(() => {
    agentsState = useAgentsStore.getState();
    chatState = useChatStore.getState();
    gatewayState = useGatewayStore.getState();
    providerState = useProviderStore.getState();
    skillsState = useSkillsStore.getState();

    fetchPresetAgentSkillsMock.mockReset();
    fetchPresetAgentSkillsMock.mockResolvedValue([]);
    hostApiFetchMock.mockReset();
    buildSlashPickerItemsMock.mockClear();
    isSlashCommandItemMock.mockClear();
    editorInsertContentMock.mockReset();
    editorChainFocusMock.mockReset();
    editorRunMock.mockReset();
    editorCommandsFocusMock.mockReset();
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
      consumePendingComposerSeed: vi.fn(),
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
});
