import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const chatState = {
  refresh: vi.fn(),
  loading: false,
  showThinking: true,
  showToolCalls: false,
  toggleThinking: vi.fn(),
  toggleToolCalls: vi.fn(),
  currentAgentId: 'agent-1',
  currentSessionKey: 'session-1',
};

const settingsState = {
  chatSessionsPanelCollapsed: false,
  setChatSessionsPanelCollapsed: vi.fn(),
};

const agentsState = {
  agents: [{ id: 'agent-1', name: 'Agent One' }],
};

const translations: Record<string, string> = {
  'toolbar.sessionId': 'Session ID',
  'toolbar.refresh': 'Refresh chat',
  'toolbar.thinking': 'Thinking',
  'toolbar.toolCalls': 'Tool calls',
  'toolbar.visibilityOptions': 'Visibility options',
  'toolbar.showThinking': 'Show thinking',
  'toolbar.showToolCalls': 'Show tool calls',
  'toolbar.persona.button': 'Set Persona',
  'toolbar.agentSettings.open': 'Open agent settings',
  'agentSettingsDialog.title': 'Agent Settings',
  'sessionPanel.title': 'Sessions',
  'sessionPanel.expand': 'Expand session panel',
  'sessionPanel.collapse': 'Collapse session panel',
};

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/pages/Chat/AgentSettingsDialog', () => ({
  AgentSettingsDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Agent Settings" /> : null),
}));

describe('ChatToolbar visibility menu', () => {
  beforeEach(() => {
    chatState.refresh.mockReset();
    chatState.loading = false;
    chatState.showThinking = true;
    chatState.showToolCalls = false;
    chatState.toggleThinking.mockReset();
    chatState.toggleToolCalls.mockReset();
    settingsState.chatSessionsPanelCollapsed = false;
    settingsState.setChatSessionsPanelCollapsed.mockReset();

    if (!window.PointerEvent) {
      Object.defineProperty(window, 'PointerEvent', {
        value: MouseEvent,
        writable: true,
        configurable: true,
      });
    }
  });

  it('shows checked visibility items inside a dropdown menu', async () => {
    const { ChatToolbar } = await import('@/pages/Chat/ChatToolbar');

    render(
      <TooltipProvider>
        <ChatToolbar />
      </TooltipProvider>,
    );

    const visibilityButton = screen.getByRole('button', { name: 'Visibility options' });
    expect(visibilityButton).not.toHaveClass('w-7');
    expect(visibilityButton.querySelectorAll('svg')).toHaveLength(2);

    fireEvent.pointerDown(visibilityButton, { button: 0, ctrlKey: false });

    const thinkingItem = await screen.findByRole('menuitemcheckbox', { name: 'Show thinking' });
    const toolCallsItem = await screen.findByRole('menuitemcheckbox', { name: 'Show tool calls' });

    expect(thinkingItem).toHaveAttribute('aria-checked', 'true');
    expect(toolCallsItem).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toolCallsItem);

    expect(chatState.toggleToolCalls).toHaveBeenCalledTimes(1);
  });

  it('opens agent settings from the chat toolbar', async () => {
    const { ChatToolbar } = await import('@/pages/Chat/ChatToolbar');

    render(
      <TooltipProvider>
        <ChatToolbar />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open agent settings' }));

    expect(await screen.findByRole('dialog', { name: 'Agent Settings' })).toBeInTheDocument();
  });
});
