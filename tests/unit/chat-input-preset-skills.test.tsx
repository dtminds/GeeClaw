import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
} = vi.hoisted(() => ({
  fetchPresetAgentSkillsMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
}));

vi.mock('@/pages/Chat/slash-picker', () => ({
  buildSlashPickerItems: vi.fn(() => []),
  fetchPresetAgentSkills: fetchPresetAgentSkillsMock,
  getSlashCommandDescription: vi.fn(() => ''),
  getSlashCommandName: vi.fn(() => ''),
  getVisibleSlashItems: vi.fn(() => []),
  isSlashCommandItem: vi.fn(() => false),
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
      t: (key: string, fallback?: string) => fallback ?? key,
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
  useEditor: vi.fn(() => ({
    chain: () => ({
      focus: () => ({
        insertContent: () => ({
          run: () => true,
        }),
      }),
    }),
    commands: {
      focus: vi.fn(),
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
  })),
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
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings/safety') {
        return {
          workspaceOnly: false,
          securityPolicy: 'moderate',
          configDir: '/tmp/geeclaw-test',
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
        description: '',
        enabled: true,
      }],
      loading: false,
      fetchSkills: vi.fn(async () => {}),
    });
  });

  afterEach(() => {
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
});
