import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockHostApiFetch = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => mockHostApiFetch(...args),
}));

describe('AgentSettingsDialog persona loading', () => {
  beforeEach(() => {
    mockHostApiFetch.mockReset();
  });

  it('loads persona snapshot for the active agent', async () => {
    mockHostApiFetch.mockResolvedValueOnce({
      agentId: 'writer',
      workspace: '/tmp/writer',
      editable: true,
      lockedFiles: [],
      files: {
        identity: { exists: true, content: 'identity text' },
        master: { exists: true, content: 'owner text' },
        soul: { exists: true, content: 'soul text' },
        memory: { exists: false, content: '' },
      },
    });

    const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
    render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

    await screen.findByDisplayValue('identity text');
    expect(mockHostApiFetch).toHaveBeenCalledWith('/api/agents/writer/persona');
  });
});
