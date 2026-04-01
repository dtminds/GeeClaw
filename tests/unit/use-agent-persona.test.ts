import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SOUL_TEMPLATES, useAgentPersona } from '@/pages/Chat/agent-settings/useAgentPersona';

const mockHostApiFetch = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => mockHostApiFetch(...args),
}));

const personaResponse = {
  agentId: 'test-agent',
  workspace: '/tmp/test-agent',
  editable: true,
  lockedFiles: [],
  files: {
    identity: { exists: true, content: 'identity' },
    master: { exists: true, content: 'master' },
    soul: { exists: true, content: 'soul' },
    memory: { exists: true, content: 'memory' },
  },
};

describe('useAgentPersona shared data', () => {
  beforeEach(() => {
    mockHostApiFetch.mockReset();
  });

  it('hydrates the draft and registers template selections', async () => {
    mockHostApiFetch.mockResolvedValueOnce(personaResponse);

    const { result } = renderHook(() => useAgentPersona('test-agent', true));
    await waitFor(() => result.current.snapshot !== null);

    const template = SOUL_TEMPLATES.find((entry) => entry.id === 'mentor');
    expect(template).toBeDefined();

    act(() => {
      result.current.selectSoulTemplate('mentor');
    });

    expect(result.current.soulTemplateId).toBe('mentor');
    expect(result.current.drafts.soul).toBe(template?.content);
  });
});
