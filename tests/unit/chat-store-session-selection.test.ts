import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import type { DesktopSessionSummary } from '@/stores/chat';

const initialAgentsState = useAgentsStore.getState();
const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();

const mainSession: DesktopSessionSummary = {
  id: 'desktop-main',
  gatewaySessionKey: 'agent:main:main',
  title: '',
  lastMessagePreview: '',
  createdAt: 1,
  updatedAt: 1,
};

const writerSession: DesktopSessionSummary = {
  id: 'desktop-writer',
  gatewaySessionKey: 'agent:writer:main',
  title: '',
  lastMessagePreview: '',
  createdAt: 2,
  updatedAt: 2,
};

describe('chat store session selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentsStore.setState(initialAgentsState, true);
    useChatStore.setState(initialChatState, true);
    useGatewayStore.setState({
      ...initialGatewayState,
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.list') {
          return { sessions: [] };
        }
        if (method === 'chat.history') {
          return { messages: [] };
        }
        return {};
      }),
    });

    useAgentsStore.setState({
      ...useAgentsStore.getState(),
      agents: [
        {
          id: 'main',
          name: 'Main',
          isDefault: true,
          modelDisplay: 'gpt-4.1',
          inheritedModel: false,
          workspace: '/tmp/main',
          agentDir: '/tmp/main/agent',
          mainSessionKey: 'agent:main:main',
          channelTypes: [],
          channelAccounts: [],
          source: 'custom',
          managed: false,
          presetId: undefined,
          lockedFields: [],
          canUnmanage: false,
          managedFiles: [],
          skillScope: { mode: 'default' },
          presetSkills: [],
          canUseDefaultSkillScope: true,
        },
        {
          id: 'writer',
          name: 'Writer',
          isDefault: false,
          modelDisplay: 'gpt-4.1',
          inheritedModel: false,
          workspace: '/tmp/writer',
          agentDir: '/tmp/writer/agent',
          mainSessionKey: 'agent:writer:main',
          channelTypes: [],
          channelAccounts: [],
          source: 'custom',
          managed: false,
          presetId: undefined,
          lockedFields: [],
          canUnmanage: false,
          managedFiles: [],
          skillScope: { mode: 'default' },
          presetSkills: [],
          canUseDefaultSkillScope: true,
        },
      ],
      defaultAgentId: 'main',
    });
  });

  it('keeps the targeted agent selected when session refresh does not include the newly created main session yet', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      session: writerSession,
    });

    await useChatStore.getState().openAgentMainSession('writer');

    expect(useChatStore.getState().currentAgentId).toBe('writer');
    expect(useChatStore.getState().currentSessionKey).toBe('agent:writer:main');

    hostApiFetchMock.mockResolvedValueOnce({
      sessions: [mainSession],
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentAgentId).toBe('writer');
    expect(useChatStore.getState().currentDesktopSessionId).toBe(writerSession.id);
    expect(useChatStore.getState().currentSessionKey).toBe(writerSession.gatewaySessionKey);
    expect(useChatStore.getState().desktopSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: writerSession.id,
          gatewaySessionKey: writerSession.gatewaySessionKey,
        }),
      ]),
    );
  });

  it('does not auto-delete an empty main session during cleanup', async () => {
    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [writerSession, mainSession],
      currentDesktopSessionId: writerSession.id,
      currentSessionKey: writerSession.gatewaySessionKey,
      currentAgentId: 'writer',
      isDraftSession: false,
      messages: [],
    });

    await useChatStore.getState().cleanupEmptySession();

    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().desktopSessions).toEqual([writerSession, mainSession]);
    expect(useChatStore.getState().currentSessionKey).toBe(writerSession.gatewaySessionKey);
  });

  it('loads desktop session summaries without forcing chat history', async () => {
    useChatStore.setState({
      ...useChatStore.getState(),
      desktopSessions: [],
      currentDesktopSessionId: '',
      currentSessionKey: '',
      currentAgentId: 'main',
      isDraftSession: false,
    });

    hostApiFetchMock.mockResolvedValueOnce({
      sessions: [writerSession, mainSession],
    });

    await useChatStore.getState().loadDesktopSessionSummaries();

    expect(useChatStore.getState().desktopSessions).toEqual([writerSession, mainSession]);
    expect(useChatStore.getState().currentSessionKey).toBe('');
    expect(useChatStore.getState().currentDesktopSessionId).toBe('');
    expect(useChatStore.getState().currentAgentId).toBe('main');
  });
});
