import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';

const initialAgentsState = useAgentsStore.getState();
const initialChatState = useChatStore.getState();

describe('chat store agent deletion fallback', () => {
  beforeEach(() => {
    useAgentsStore.setState(initialAgentsState, true);
    useChatStore.setState(initialChatState, true);
  });

  it('switches to a fallback agent when the current agent is deleted', async () => {
    useAgentsStore.setState({
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
      ],
      defaultAgentId: 'main',
    });

    const openAgentMainSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentAgentId: 'writer',
      currentSessionKey: 'agent:writer:main',
      openAgentMainSession,
    });

    const { handleAgentDeleted } = useChatStore.getState() as unknown as {
      handleAgentDeleted: (agentId: string) => Promise<void>;
    };

    await handleAgentDeleted('writer');

    expect(openAgentMainSession).toHaveBeenCalledWith('main');
  });

  it('does nothing when deleting a non-active agent', async () => {
    const openAgentMainSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentAgentId: 'main',
      currentSessionKey: 'agent:main:main',
      openAgentMainSession,
    });

    const { handleAgentDeleted } = useChatStore.getState() as unknown as {
      handleAgentDeleted: (agentId: string) => Promise<void>;
    };

    await handleAgentDeleted('writer');

    expect(openAgentMainSession).not.toHaveBeenCalled();
  });
});
